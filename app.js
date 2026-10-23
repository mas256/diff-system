import {parsePatch,changes,stats,copy,textLines,linesText,filePath,contextFor,validateOriginal,selectedLines,splitChange,serialize,restore,exportPatch} from './core.js';
const $=id=>document.getElementById(id);
const LABEL={pending:'未判断',accepted:'承認',rejected:'否認',edited:'編集して承認'};
let project=null,saved=null,fileId=null,focused=null,filter='all',context=5,limit=60,undoStack=[],redoStack=[],editing=null,splitting=null,noticeTimer,saveTimer,queue=Promise.resolve(),output='';
const hasStorage=!!globalThis.chrome?.storage?.local;
const storage={
  async get(){return hasStorage?(await chrome.storage.local.get('session')).session:localStorage.getItem('diff-review-session');},
  async set(value){if(hasStorage)await chrome.storage.local.set({session:value});else localStorage.setItem('diff-review-session',value);}
};
function node(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function notify(message,error=false){clearTimeout(noticeTimer);$('notice').textContent=message;$('notice').className=error?'error':'';$('notice').hidden=false;noticeTimer=setTimeout(()=>$('notice').hidden=true,error?12000:4500);}
function safe(fn){return async(...args)=>{try{await fn(...args);}catch(e){notify(e.message||String(e),true);}};}
function persist(debounce=false){
  clearTimeout(saveTimer);if(!project)return;
  $('save-state').textContent='保存中…';
  const run=()=>{
    const snapshot=serialize(project);
    queue=queue.catch(()=>{}).then(()=>storage.set(snapshot)).then(()=>{
      saved=snapshot;$('save-state').textContent='この端末に保存済み';
    }).catch(e=>{$('save-state').textContent='自動保存できません';notify('自動保存できません。作業ファイルをダウンロードして保存してください。 '+e.message,true);});
  };
  if(debounce)saveTimer=setTimeout(run,350);else run();
}
function checkpoint(){undoStack.push(copy(project));if(undoStack.length>30)undoStack.shift();redoStack=[];}
function mutate(fn){checkpoint();try{fn();}catch(e){undoStack.pop();throw e;}persist();render();}
function adopt(next){project=next;fileId=next.files[0].id;focused=null;filter='all';limit=60;undoStack=[];redoStack=[];persist();render();}
function confirmation(){return !project||confirm('現在の作業を切り替えます。必要なら先に「作業ファイルを保存」で保存してください。切り替えますか？');}
async function readText(file,max=8*1024*1024){
  if(file.size>max)throw new Error('ファイルが大きすぎます。8 MB以下に分けてください。');
  const bytes=await file.arrayBuffer();
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error(file.name+'：UTF-8のファイルを指定してください。');}
}
async function loadDiff(file){if(!file)return;const next=parsePatch(await readText(file),file.name);if(confirmation())adopt(next);}
async function loadProject(file){if(!file)return;const next=restore(await readText(file,24*1024*1024));if(confirmation()){adopt(next);notify('作業を再開しました。');}}
function download(text,name,type='text/plain;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type}));
  const link=node('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function saveProject(){if(project)download(serialize(project),project.name.replace(/\.(diff|patch)$/i,'')+'.diffreview.json','application/json');}
function currentFile(){return project?.files.find(f=>f.id===fileId);}
function visibleChanges(){return changes(project).filter(c=>c.file.id===fileId&&(filter!=='pending'||c.part.status==='pending'));}
function render(){
  $('welcome').hidden=!!project;$('workspace').hidden=!project;if(!project)return;
  const s=stats(project),done=s.total-s.pending;
  $('project-name').textContent=project.name;$('file-count').textContent=project.files.length+' ファイル';
  $('current-path').textContent=filePath(currentFile());
  $('progress-fill').style.width=(done/s.total*100)+'%';
  document.querySelector('[role=progressbar]').setAttribute('aria-valuenow',String(Math.round(done/s.total*100)));
  $('progress-label').textContent=done+' / '+s.total+' 件を判断';
  $('all-count').textContent=s.total;$('pending-count').textContent=s.pending;
  $('filter-all').classList.toggle('active',filter==='all');$('filter-pending').classList.toggle('active',filter==='pending');
  $('filter-all').setAttribute('aria-pressed',String(filter==='all'));$('filter-pending').setAttribute('aria-pressed',String(filter==='pending'));
  $('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;$('reject-pending').disabled=!s.pending;
  const originals=Object.keys(project.originals).length;
  $('original-count').textContent=originals?originals+' ファイルを照合済み':'元ファイルは未読込';
  const verified=project.originals[fileId]!==undefined;
  $('context-note').textContent=verified?'✓ 元ファイルと一致を確認済み。文脈は変更前の内容です。':'文脈は変更前の内容です。diffに前後'+context+'行がない場合は、元ファイルを追加すると広げられます。';
  renderFiles();renderCards();
}
function renderFiles(){
  const all=changes(project),query=$('file-search').value.toLowerCase(),list=$('file-list');list.replaceChildren();
  for(const f of project.files){
    const name=filePath(f);if(!name.toLowerCase().includes(query))continue;
    const items=all.filter(c=>c.file.id===f.id),pending=items.filter(c=>c.part.status==='pending').length;
    const button=node('button','file-button'+(f.id===fileId?' selected':''));
    button.append(node('strong','',name),node('small','',(f.kind==='add'?'新規 · ':f.kind==='delete'?'削除 · ':'')+items.length+' 変更 · '+(pending?'未判断 '+pending:'すべて判断済み')));
    button.setAttribute('aria-current',f.id===fileId?'page':'false');
    button.onclick=()=>{fileId=f.id;focused=null;limit=60;render();window.scrollTo({top:0});};
    list.append(button);
  }
  if(!list.childElementCount)list.append(node('p','muted','一致するファイルがありません。'));
}
function codeRow(l,type,old='',newer=''){
  const row=node('div','code-row '+type);
  row.append(node('span','num',String(old)),node('span','num',String(newer)),node('span','sign',type==='del'?'−':type==='add'?'+':''),node('span','content',l.text));
  return row;
}
function appendLines(container,lines,type,oldStart=null,newStart=null){
  lines.forEach((l,i)=>{
    container.append(codeRow(l,type,oldStart===null?'':oldStart+i,newStart===null?'':newStart+i));
    if(l.noNL)container.append(codeRow({text:'末尾に改行なし'},'note'));
  });
}
function actionButton(text,className,fn){const b=node('button',className,text);b.onclick=safe(fn);return b;}
function decide(id,status){
  const item=changes(project).find(c=>c.part.id===id);if(!item)return;
  focused=id;mutate(()=>{item.part.status=status;});
}
function renderCards(){
  const list=$('changes');list.replaceChildren();
  const items=visibleChanges();if(!items.some(c=>c.part.id===focused))focused=items[0]?.part.id??null;
  if(!items.length){list.append(node('div','empty',filter==='pending'?'このファイルの未判断はありません。ほかのファイルか、結果の確認へ進めます。':'表示する変更がありません。'));return;}
  for(const item of items.slice(0,limit)){
    const {part:p,file}=item,card=node('article','change-card'+(focused===p.id?' focused':''));
    card.dataset.id=p.id;card.tabIndex=0;card.setAttribute('aria-label','変更 '+item.number+' '+LABEL[p.status]);
    card.addEventListener('click',()=>focusChange(p.id,false));
    card.addEventListener('focus',()=>focusChange(p.id,false));
    const head=node('div','card-head'),title=node('div','change-title');
    title.append(node('strong','','変更 '+String(item.number).padStart(2,'0')),node('span','location',p.old.length?'元 '+(item.oldLine+1)+' 行目から':'元 '+item.oldLine+' 行目の後'),node('span','badge '+p.status,LABEL[p.status]));
    head.append(title);
    if(file.kind==='modify'&&p.old.length+p.proposed.length>1){
      const split=actionButton('分割','',()=>openSplit(p.id));split.disabled=p.status==='edited';split.title=split.disabled?'保留に戻すと分割できます':'';head.append(split);
    }
    card.append(head);
    const c=contextFor(project,item,context);
    const view=node('div','code-view'+($('wrap').checked?' wrap':''));
    if(c.before.length){view.append(node('div','context-caption','変更前の文脈'));for(const l of c.before)view.append(codeRow(l,'context',l.old));}
    appendLines(view,p.old,'del',item.oldLine+1);
    appendLines(view,p.proposed,'add',null,item.newLine+1);
    if(!p.old.length&&!p.proposed.length)view.append(node('p','muted','空の変更'));
    if(c.after.length){view.append(node('div','context-caption','変更前の文脈'));for(const l of c.after)view.append(codeRow(l,'context',l.old));}
    card.append(view);
    if(p.status==='edited'){
      card.append(node('div','edited-label','編集後に採用する内容'));
      const edited=node('div','code-view'+($('wrap').checked?' wrap':''));
      const ls=selectedLines(p);if(ls.length)appendLines(edited,ls,'add');else edited.append(node('p','muted','この箇所を削除します。'));card.append(edited);
    }
    const actions=node('div','card-actions');
    actions.append(actionButton('✓ 承認','accept'+(p.status==='accepted'?' selected-action':''),()=>decide(p.id,'accepted')),actionButton('× 否認','reject'+(p.status==='rejected'?' selected-action':''),()=>decide(p.id,'rejected')));
    const edit=actionButton('編集して承認','edit'+(p.status==='edited'?' selected-action':''),()=>openEdit(p.id));
    edit.disabled=file.kind==='delete';if(edit.disabled)edit.title='ファイルの削除は承認・否認で判断します。';actions.append(edit,actionButton('保留','pending',()=>decide(p.id,'pending')));
    card.append(actions);list.append(card);
  }
  if(items.length>limit)list.append(actionButton('さらに60件表示（残り '+(items.length-limit)+' 件）','wide',()=>{limit+=60;renderCards();}));
}
function focusChange(id,scroll=true){
  focused=id;document.querySelectorAll('.change-card').forEach(card=>{card.classList.toggle('focused',card.dataset.id===id);if(scroll&&card.dataset.id===id)card.scrollIntoView({behavior:'smooth',block:'center'});});
}
function move(step){
  const all=changes(project).filter(c=>filter!=='pending'||c.part.status==='pending');
  const at=all.findIndex(c=>c.part.id===focused),next=all[Math.max(0,Math.min(all.length-1,at+step))];
  if(!next)return;fileId=next.file.id;focused=next.part.id;
  const ix=all.filter(c=>c.file.id===fileId).findIndex(c=>c.part.id===focused);limit=Math.max(limit,ix+1);render();focusChange(focused);
}
function editorText(){
  const value=$('edit-text').value.replace(/\r\n/g,'\n');
  return value+($('edit-newline').checked&&value&&!value.endsWith('\n')?'\n':'');
}
function openEdit(id){
  const item=changes(project).find(c=>c.part.id===id);if(!item||item.file.kind==='delete')return;
  editing=id;focusChange(id,false);
  const draft=project.draft?.id===id?project.draft:null;
  const value=draft?draft.text:item.part.edited??linesText(item.part.proposed);
  const ended=value.endsWith('\n');
  $('edit-text').value=ended?value.slice(0,-1):value;
  $('edit-newline').checked=draft?draft.newline:ended;
  $('edit-path').textContent=filePath(item.file)+' · 変更 '+item.number;
  updateComparison(false);$('edit-dialog').showModal();$('edit-text').focus();
}
function updateComparison(save=true){
  const item=changes(project).find(c=>c.part.id===editing);if(!item)return;
  const view=$('edit-comparison');view.classList.add('wrap');view.replaceChildren();appendLines(view,item.part.old,'del');appendLines(view,textLines(editorText()),'add');
  if(save){project.draft={id:editing,text:$('edit-text').value,newline:$('edit-newline').checked};persist(true);}
}
function confirmEdit(){
  const item=changes(project).find(c=>c.part.id===editing);
  const edited=editorText();if(edited.includes('\0'))throw new Error('NUL文字は入力できません。');
  if(item.file.kind==='add'&&!edited)throw new Error('空ファイルの新規作成には対応していません。否認すると作成を取り消せます。');
  mutate(()=>{item.part.edited=edited;item.part.status='edited';delete project.draft;});
  $('edit-dialog').close();editing=null;
}
function openSplit(id){
  const item=changes(project).find(c=>c.part.id===id);splitting=id;
  const p=item.part;
  $('split-old').max=String(p.old.length);$('split-new').max=String(p.proposed.length);
  $('split-old').value=String(Math.ceil(p.old.length/2));$('split-new').value=String(Math.floor(p.proposed.length/2));
  if(+$('split-old').value+ +$('split-new').value===0)$('split-new').value='1';
  $('split-old-preview').textContent=p.old.map((l,i)=>(i+1)+': '+l.text).join('\n')||'（なし）';
  $('split-new-preview').textContent=p.proposed.map((l,i)=>(i+1)+': '+l.text).join('\n')||'（なし）';
  $('split-dialog').showModal();
}
function preview(){
  const s=stats(project),warn=$('export-warning');
  $('summary').textContent=s.total+' 件中：承認 '+s.accepted+' · 編集して承認 '+s.edited+' · 否認 '+s.rejected+' · 未判断 '+s.pending;
  const list=$('decision-list');list.replaceChildren();
  for(const item of changes(project)){
    const row=node('div','decision-row');row.append(node('span','',filePath(item.file)+' · 変更 '+item.number),node('span','badge '+item.part.status,LABEL[item.part.status]));list.append(row);
  }
  output='';warn.hidden=true;
  try{output=exportPatch(project);if(!output){warn.textContent='採用による変更がありません。出力するdiffは空です。';warn.hidden=false;}}
  catch(e){warn.textContent=e.message;warn.hidden=false;}
  $('download-diff').disabled=!output;
  const view=$('patch-preview');view.replaceChildren();
  if(output)for(const line of output.split('\n'))view.append(node('div',line.startsWith('@@')?'hunk':line.startsWith('+')?'plus':line.startsWith('-')?'minus':'',line||' '));
  else view.textContent=s.pending?'未判断を解消すると、ここに出力するdiffを表示します。':'出力する変更はありません。';
  $('preview-dialog').showModal();
}
async function addOriginals(files){
  if(!project||!files.length)return;
  let bytes=0;for(const f of files)bytes+=f.size;
  if(bytes>24*1024*1024)throw new Error('選択したファイルの合計が24 MBを超えています。対象の元ファイルだけを選んでください。');
  const candidates=Array.from(files).map(f=>({file:f,path:(f.webkitRelativePath||f.name).replace(/\\/g,'/')}));
  const imported={},errors=[];let matched=0;
  for(const f of project.files){
    if(f.kind==='add')continue;
    const expected=f.oldPath.replace(/^a\//,'');
    let matches=candidates.filter(c=>c.path===expected||c.path.endsWith('/'+expected));
    if(!matches.length&&files.length===1&&project.files.filter(f=>f.kind!=='add').length===1)matches=candidates;
    if(matches.length!==1){if(matches.length>1)errors.push(filePath(f)+'：同じパスが複数あります。');continue;}
    matched++;
    try{const text=await readText(matches[0].file);validateOriginal(f,text);imported[f.id]=text;}catch(e){errors.push(e.message);}
  }
  if(Object.keys(imported).length)mutate(()=>Object.assign(project.originals,imported));
  if(errors.length)notify(errors.join('\n'),true);
  else if(!matched)notify('対応するパスがありません。元のディレクトリ構成を含むフォルダ、または対象ファイルを選択してください。',true);
  else notify(Object.keys(imported).length+' ファイルを照合しました。');
}
async function demo(){
  const sample='diff --git a/chapter.tex b/chapter.tex\nindex 1111111..2222222 100644\n--- a/chapter.tex\n+++ b/chapter.tex\n@@ -1,18 +1,19 @@\n \\section{等差数列}\n 本節では、等差数列の一般項を求めます。\n 初項を$a_1$、公差を$d$とします。\n \n \\subsection{一般項}\n-数列の差は一定です。\n+隣り合う項の差は一定です。\n すなわち、$a_{n+1}-a_n=d$です。\n この関係を繰り返し使うと、\n $a_n=a_1+(n-1)d$を得ます。\n \n \\subsection{例題}\n-初項1、公差2の等差数列を考えます。\n-一般項は$a_n=2n$です。\n+初項1、公差2の等差数列を考えましょう。\n+一般項は$a_n=2n-1$です。\n+初項を代入して確かめてください。\n \n \\subsection{まとめ}\n 公差に注目すると、一般項を求められます。\n 次節では、等比数列を扱います。\n ここまでの式変形を振り返りましょう。\n';
  const next=parsePatch(sample,'sample-textbook.diff');if(confirmation())adopt(next);
}
function undo(redo=false){
  const from=redo?redoStack:undoStack,to=redo?undoStack:redoStack;if(!from.length)return;
  to.push(copy(project));project=from.pop();if(!project.files.some(f=>f.id===fileId))fileId=project.files[0].id;persist();render();
}
$('open-diff').onclick=()=>$('diff-input').click();$('open-project').onclick=()=>$('project-input').click();
$('diff-input').onchange=safe(async e=>{await loadDiff(e.target.files[0]);e.target.value='';});
$('project-input').onchange=safe(async e=>{await loadProject(e.target.files[0]);e.target.value='';});
$('add-original').onclick=()=>$('original-input').click();$('add-folder').onclick=()=>$('folder-input').click();
for(const id of ['original-input','folder-input'])$(id).onchange=safe(async e=>{await addOriginals(e.target.files);e.target.value='';});
$('drop-zone').onclick=()=>$('diff-input').click();$('drop-zone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('diff-input').click();}};
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();$('drop-zone').classList.add('drag');}});
document.addEventListener('dragleave',e=>{if(!e.relatedTarget)$('drop-zone').classList.remove('drag');});
document.addEventListener('drop',safe(async e=>{
  e.preventDefault();$('drop-zone').classList.remove('drag');
  const file=e.dataTransfer.files[0];if(!file)return;
  if(e.dataTransfer.files.length!==1)throw new Error('diffまたは作業ファイルを一つずつドロップしてください。');
  if(/\.(json|diffreview)$/i.test(file.name))await loadProject(file);else await loadDiff(file);
}));
$('help').onclick=()=>$('help-dialog').showModal();$('demo').onclick=safe(demo);
$('resume').onclick=safe(()=>{if(saved)adopt(restore(saved));if(project.draft)notify('入力途中の編集があります。対象の「編集して承認」から再開できます。');});
$('file-search').oninput=()=>project&&renderFiles();
$('filter-all').onclick=()=>{filter='all';render();};$('filter-pending').onclick=()=>{filter='pending';render();};
$('context-size').onchange=e=>{context=+e.target.value;render();};$('wrap').onchange=()=>renderCards();
$('save-project').onclick=safe(saveProject);$('preview').onclick=safe(preview);
$('undo').onclick=()=>undo();$('redo').onclick=()=>undo(true);
$('edit-text').oninput=()=>updateComparison();$('edit-newline').onchange=()=>updateComparison();
$('confirm-edit').onclick=safe(confirmEdit);
$('edit-dialog').addEventListener('close',()=>{editing=null;});
$('confirm-split').onclick=safe(()=>{
  const id=splitting;mutate(()=>splitChange(project,id,+$('split-old').value,+$('split-new').value));$('split-dialog').close();splitting=null;notify('二つに分割しました。それぞれの採否を選んでください。');
});
$('reject-pending').onclick=()=>{const n=stats(project).pending;if(n&&confirm('全ファイルの未判断 '+n+' 件を否認しますか？'))mutate(()=>{for(const {part} of changes(project))if(part.status==='pending')part.status='rejected';});};
$('download-diff').onclick=safe(()=>{output=exportPatch(project);if(output)download(output,project.name.replace(/\.(diff|patch)$/i,'')+'.reviewed.diff');});
document.querySelector('.brand').onclick=e=>{e.preventDefault();if(project)notify('作業の切り替えは「diffを開く」または「作業を開く」から行えます。');};
document.addEventListener('keydown',safe(e=>{
  if(document.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){if(project){e.preventDefault();saveProject();}return;}
  if(!project||e.ctrlKey||e.metaKey||e.altKey)return;
  switch(e.key.toLowerCase()){
    case 'j':e.preventDefault();move(1);break;
    case 'k':e.preventDefault();move(-1);break;
    case 'a':e.preventDefault();if(focused)decide(focused,'accepted');break;
    case 'r':e.preventDefault();if(focused)decide(focused,'rejected');break;
    case 'p':e.preventDefault();if(focused)decide(focused,'pending');break;
    case 'e':e.preventDefault();if(focused)openEdit(focused);break;
  }
}));
window.addEventListener('pagehide',()=>{if(saveTimer)persist();});
async function init(){
  try{saved=await storage.get();if(saved){restore(saved);$('resume').hidden=false;}}catch(e){notify('保存した作業を読み込めません。作業ファイルがあれば「作業を開く」から復元してください。',true);}
}
// One editing tab prevents one window from overwriting another window's decisions.
if(navigator.locks){
  navigator.locks.request('diff-review-session',{ifAvailable:true},async lock=>{
    if(!lock){document.querySelectorAll('button,input').forEach(e=>e.disabled=true);$('drop-zone').onclick=null;notify('別のタブでDiff Reviewを開いています。そのタブで続けるか、閉じてからこのページを再読み込みしてください。',true);return;}
    await init();await new Promise(()=>{});
  });
}else init();
