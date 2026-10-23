
// Unified diff parser and selective patch writer. No external dependencies.
export const VERSION = 1;
export const copy = value => structuredClone(value);
const same = (a,b) => a.length === b.length && a.every((v,i) => v.text === b[i].text && !!v.noNL === !!b[i].noNL);
const fail = message => { throw new Error(message); };
export function textLines(text) {
  if (!text) return [];
  const parts = text.replace(/\r\n/g,'\n').split('\n');
  const ended = parts.at(-1) === '';
  if (ended) parts.pop();
  return parts.map((text,i) => ({text,noNL:!ended && i===parts.length-1}));
}
export const linesText = lines => lines.map(l=>l.text+(l.noNL?'':'\n')).join('');
export function pathName(raw) {
  raw=raw.split('\t')[0].trim();
  if (!raw.startsWith('"')) return raw;
  const bytes=[];
  for(let i=1;i<raw.length-1;i++) {
    if(raw[i]==='\\') {
      const oct=raw.slice(i+1).match(/^[0-7]{1,3}/);
      if(oct){bytes.push(parseInt(oct[0],8));i+=oct[0].length;}
      else {i++;bytes.push(...new TextEncoder().encode(({t:'\t',n:'\n',r:'\r'})[raw[i]]??raw[i]));}
    } else {
      const ch=String.fromCodePoint(raw.codePointAt(i));
      bytes.push(...new TextEncoder().encode(ch));i+=ch.length-1;
    }
  }
  return new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes));
}
export const filePath = f => (f.newPath==='/dev/null'?f.oldPath:f.newPath).replace(/^[ab]\//,'');
export function parsePatch(input,name='changes.diff') {
  if(typeof input!=='string'||input.includes('\0'))fail('テキスト形式のdiffを指定してください。');
  const rows=input.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n');
  if(rows.at(-1)==='')rows.pop();
  const files=[]; let headers=[],current=null,i=0,serial=0;
  const error=m=>fail(m+'（diff '+(i+1)+' 行目）');
  const finish=()=>{
    if(!current)return;
    if(!current.hunks.length)error('内容変更のないファイル・空ファイルの作成には対応していません。');
    const f=current;
    if(f.oldPath!=='/dev/null'&&f.newPath!=='/dev/null'&&f.oldPath.replace(/^a\//,'')!==f.newPath.replace(/^b\//,''))error('名前変更には対応していません。');
    if(f.oldPath==='/dev/null'&&f.newPath==='/dev/null')error('パスが不正です。');
    f.kind=f.oldPath==='/dev/null'?'add':f.newPath==='/dev/null'?'delete':'modify';
    const blocks=f.hunks.flatMap(h=>h.parts.filter(p=>p.type==='change'));
    if(!blocks.length)error('変更行がありません。');
    const h=f.hunks[0];
    if(f.kind!=='modify'&&(f.hunks.length!==1||blocks.length!==1||h.parts.length!==1||(f.kind==='add'?h.oldCount!==0||h.newBase!==0:h.newCount!==0||h.oldBase!==0)))error('新規・削除ファイルの内容が完全ではありません。');
    files.push(f);current=null;
  };
  while(i<rows.length) {
    const row=rows[i];
    if(/^(GIT binary patch|Binary files |diff --(?:cc|combined)|@@@|rename |copy |similarity index |dissimilarity index |old mode |new mode )/.test(row))error('バイナリ・名前変更・コピー・モード変更・マージ形式は未対応です。テキストのunified diffを使ってください。');
    if(row.startsWith('diff --git ')){
      finish();if(headers.length)error('内容変更のないGitファイルがあります。');
      headers=[row];i++;continue;
    }
    if(/^(index |new file mode |deleted file mode )/.test(row)){headers.push(row);i++;continue;}
    if(row.startsWith('--- ')&&rows[i+1]?.startsWith('+++ ')){
      finish();
      current={id:'f'+files.length,oldHeader:row,newHeader:rows[i+1],oldPath:pathName(row.slice(4)),newPath:pathName(rows[i+1].slice(4)),headers,hunks:[]};
      if(headers.some(h=>/(?:file mode |^index .* )120000$/.test(h)))error('シンボリックリンクは未対応です。');
      if(!current.oldPath||!current.newPath)error('ファイル名が空です。');
      headers=[];i+=2;continue;
    }
    const m=row.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if(m){
      if(!current)error('ファイルヘッダーがありません。');
      const oldCount=Number(m[2]??1),newCount=Number(m[4]??1);
      const oldBase=Number(m[1])-(oldCount?1:0),newBase=Number(m[3])-(newCount?1:0);
      if(oldBase<0||newBase<0||![oldCount,newCount,oldBase,newBase].every(Number.isSafeInteger))error('行番号が不正です。');
      const prev=current.hunks.at(-1);
      if(prev&&(oldBase<prev.oldBase+prev.oldCount||newBase<prev.newBase+prev.newCount||newBase-prev.newBase-prev.newCount!==oldBase-prev.oldBase-prev.oldCount))error('変更範囲の重複、または行番号の対応が不正です。');
      if(!prev&&oldBase!==newBase)error('最初の変更範囲の行番号が不正です。');
      if(prev?.oldEnded||prev?.newEnded)error('末尾改行のない範囲の後に変更があります。');
      const h={oldBase,newBase,oldCount,newCount,heading:m[5],parts:[]};
      let oc=0,nc=0,last=null;i++;
      while(i<rows.length&&(oc<oldCount||nc<newCount||rows[i]==='\\ No newline at end of file')){
        const body=rows[i];
        if(body==='\\ No newline at end of file'){
          if(!last||last.noNL)error('末尾改行マーカーが不正です。');
          last.noNL=true;i++;continue;
        }
        const prefix=body[0];
        if(![' ','+','-'].includes(prefix))error('変更範囲の行数が一致しません。');
        const line={text:body.slice(1),noNL:false};
        let part=h.parts.at(-1);
        if(prefix===' '){
          if(part?.type!=='context'){part={type:'context',lines:[]};h.parts.push(part);}
          part.lines.push(line);oc++;nc++;
        }else{
          if(part?.type!=='change'){part={type:'change',id:'c'+serial++,old:[],proposed:[],status:'pending',edited:null};h.parts.push(part);}
          if(prefix==='-'&&part.proposed.length)error('削除行を追加行より前に並べてください。');
          part[prefix==='-'?'old':'proposed'].push(line);
          if(prefix==='-')oc++;else nc++;
        }
        if(oc>oldCount||nc>newCount)error('変更範囲の行数が一致しません。');
        last=line;i++;
      }
      if(oc!==oldCount||nc!==newCount)error('変更範囲が途中で切れています。');
      let oldEnded=false,newEnded=false;
      for(const p of h.parts){
        for(const l of p.type==='context'?p.lines:p.old){if(oldEnded)error('末尾改行のない行の後に行があります。');oldEnded=!!l.noNL;}
        for(const l of p.type==='context'?p.lines:p.proposed){if(newEnded)error('末尾改行のない行の後に行があります。');newEnded=!!l.noNL;}
      }
      h.oldEnded=oldEnded;h.newEnded=newEnded;current.hunks.push(h);continue;
    }
    if(row==='-- '&&current){finish();break;}
    if(current&&row!=='')error('対応していない内容、または余分な変更行があります。');
    if(headers.length&&row!=='')error('Gitヘッダーを解釈できません。');
    if(files.length&&row!=='')error('diff末尾に対応していない内容があります。');
    i++; // Mail preambles are allowed only before the first file.
  }
  finish();
  if(headers.length)error('内容変更のないファイルが含まれています。');
  if(!files.length)fail('変更が見つかりません。unified diff形式の .diff / .patch を指定してください。');
  if(new Set(files.map(filePath)).size!==files.length)fail('同一ファイルに複数のdiffがあります。コミット間のdiffを一つにまとめてください。');
  return {version:VERSION,name,files,originals:{},created:new Date().toISOString()};
}
export function changes(project) {
  return project.files.flatMap(file=>{
    let number=0;
    return file.hunks.flatMap((hunk,hi)=>{
      let oldLine=hunk.oldBase,newLine=hunk.newBase;
      return hunk.parts.flatMap((part,pi)=>{
        if(part.type==='context'){oldLine+=part.lines.length;newLine+=part.lines.length;return [];}
        const item={file,hunk,hi,pi,part,oldLine,newLine,number:++number};
        oldLine+=part.old.length;newLine+=part.proposed.length;return [item];
      });
    });
  });
}
export function stats(project){
  const s={total:0,pending:0,accepted:0,rejected:0,edited:0};
  for(const {part} of changes(project)){s.total++;s[part.status]++;}
  return s;
}
export const selectedLines=p=>p.status==='accepted'?p.proposed:p.status==='edited'?textLines(p.edited):p.old;
const range=(base,count)=>String(base+(count?1:0))+','+count;
const emit=(prefix,l)=>prefix+l.text+'\n'+(l.noNL?'\\ No newline at end of file\n':'');
export function exportPatch(project){
  if(stats(project).pending)fail('未判断の変更があります。すべて判断してから出力してください。');
  let output='';
  for(const file of project.files){
    let delta=0,body='';
    for(const h of file.hunks){
      let oc=0,nc=0,changed=false,chunk='',oe=false,ne=false;
      const line=(l,side)=>{
        if((side!=='+'&&oe)||(side!=='-'&&ne))fail(filePath(file)+'：末尾改行のない行の後に行があります。関連する変更の採否か編集内容を見直してください。');
        if(side!=='+')oe=!!l.noNL;if(side!=='-')ne=!!l.noNL;
        chunk+=emit(side,l);
      };
      for(const p of h.parts){
        if(p.type==='context'){for(const l of p.lines)line(l,' ');oc+=p.lines.length;nc+=p.lines.length;}
        else{
          const after=selectedLines(p);oc+=p.old.length;nc+=after.length;
          if(same(p.old,after)){for(const l of p.old)line(l,' ');}
          else{changed=true;for(const l of p.old)line(l,'-');for(const l of after)line(l,'+');}
        }
      }
      if(changed)body+='@@ -'+range(h.oldBase,oc)+' +'+range(h.oldBase+delta,nc)+' @@'+h.heading+'\n'+chunk;
      delta+=nc-oc;
    }
    if(body){
      const headers=file.headers.filter(h=>!h.startsWith('index '));
      output+=(headers.length?headers.join('\n')+'\n':'')+file.oldHeader+'\n'+file.newHeader+'\n'+body;
    }
  }
  return output;
}
export function validateOriginal(file,text){
  if(file.kind==='add')fail('新規ファイルに変更前の内容はありません。');
  const lines=textLines(text);
  for(const h of file.hunks){
    const expected=h.parts.flatMap(p=>p.type==='context'?p.lines:p.old);
    if(!same(lines.slice(h.oldBase,h.oldBase+h.oldCount),expected))fail(filePath(file)+'：diffと元ファイルが一致しません（'+(h.oldBase+1)+' 行目付近）。');
  }
  if(file.kind==='delete'&&file.hunks[0].oldCount!==lines.length)fail('削除ファイルの長さが一致しません。');
  return lines;
}
export function contextFor(project,item,count=5){
  const {file,part,oldLine}=item,available=new Map(),original=project.originals[file.id];
  if(original!==undefined)textLines(original).forEach((l,i)=>available.set(i,l));
  else for(const h of file.hunks){let at=h.oldBase;for(const p of h.parts)for(const l of p.type==='context'?p.lines:p.old)available.set(at++,l);}
  const before=[],after=[];
  for(let at=oldLine-1;at>=0&&before.length<count&&available.has(at);at--)before.unshift({...available.get(at),old:at+1});
  for(let at=oldLine+part.old.length;after.length<count&&available.has(at);at++)after.push({...available.get(at),old:at+1});
  return {before,after,hasOriginal:original!==undefined};
}
export function splitChange(project,id,oldCut,newCut){
  const item=changes(project).find(c=>c.part.id===id);
  if(!item||item.file.kind!=='modify')fail('新規・削除ファイルはまとめて判断してください。');
  const {part,hunk,pi}=item;
  if(![oldCut,newCut].every(Number.isInteger)||oldCut<0||newCut<0||oldCut>part.old.length||newCut>part.proposed.length||oldCut+newCut===0||oldCut+newCut===part.old.length+part.proposed.length)fail('前半と後半の両方に行を残してください。');
  if(part.status==='edited')fail('編集済みの変更は、保留に戻してから分割してください。');
  const make=(suffix,old,proposed)=>({...copy(part),id:part.id+suffix,old,proposed,status:'pending',edited:null});
  hunk.parts.splice(pi,1,make('a',part.old.slice(0,oldCut),part.proposed.slice(0,newCut)),make('b',part.old.slice(oldCut),part.proposed.slice(newCut)));
}
export const serialize=p=>JSON.stringify({format:'diff-review',version:VERSION,project:p},null,2);
export function restore(text){
  let d;try{d=JSON.parse(text);}catch{fail('作業ファイルのJSONが不正です。');}
  if(d?.format!=='diff-review'||d.version!==VERSION||d.project?.version!==VERSION)fail('対応する作業ファイルではありません。');
  const p=d.project;
  if(!Array.isArray(p.files)||!p.files.length||!p.originals||typeof p.originals!=='object'||Array.isArray(p.originals)||typeof p.name!=='string')fail('作業ファイルが不正です。');
  let raw='';const ids=[];
  for(const f of p.files){
    if(!Array.isArray(f.headers)||f.headers.some(h=>typeof h!=='string'||/[\r\n]/.test(h))||typeof f.oldHeader!=='string'||typeof f.newHeader!=='string'||/[\r\n]/.test(f.oldHeader+f.newHeader)||!f.oldHeader.startsWith('--- ')||!f.newHeader.startsWith('+++ '))fail('ヘッダーが不正です。');
    raw+=(f.headers.length?f.headers.join('\n')+'\n':'')+f.oldHeader+'\n'+f.newHeader+'\n';
    if(!Array.isArray(f.hunks))fail('変更範囲が不正です。');
    for(const h of f.hunks){
      if(![h.oldBase,h.newBase,h.oldCount,h.newCount].every(v=>Number.isSafeInteger(v)&&v>=0)||typeof h.heading!=='string'||/[\r\n]/.test(h.heading)||!Array.isArray(h.parts))fail('行番号が不正です。');
      raw+='@@ -'+range(h.oldBase,h.oldCount)+' +'+range(h.newBase,h.newCount)+' @@'+h.heading+'\n';
      let pending=[];
      const flush=()=>{for(const q of pending)for(const l of q.old)raw+=emit('-',l);for(const q of pending)for(const l of q.proposed)raw+=emit('+',l);pending=[];};
      for(const part of h.parts){
        const groups=part.type==='context'?[part.lines]:[part.old,part.proposed];
        if(!['context','change'].includes(part.type)||groups.some(g=>!Array.isArray(g)||g.some(l=>typeof l?.text!=='string'||/[\r\n\0]/.test(l.text)||typeof l.noNL!=='boolean')))fail('行データが不正です。');
        if(part.type==='context'){flush();for(const l of part.lines)raw+=emit(' ',l);}
        else{
          if(!['pending','accepted','rejected','edited'].includes(part.status)||typeof part.id!=='string'||(part.edited!==null&&typeof part.edited!=='string')||(part.status==='edited'&&typeof part.edited!=='string')||part.edited?.includes('\0')||!part.old.length&&!part.proposed.length)fail('判断データが不正です。');
          ids.push(part.id);pending.push(part);
        }
      }
      flush();
    }
  }
  const parsed=parsePatch(raw,p.name);
  if(new Set(ids).size!==ids.length)fail('変更IDが重複しています。');
  for(let i=0;i<p.files.length;i++){
    const f=p.files[i],v=parsed.files[i];
    if(!v||f.id!==v.id||f.oldPath!==v.oldPath||f.newPath!==v.newPath||f.kind!==v.kind)fail('パスが一致しません。');
    if(f.kind!=='modify'&&f.hunks.flatMap(h=>h.parts.filter(p=>p.type==='change')).length!==1)fail('新規・削除ファイルは分割できません。');
    if(f.kind==='delete'&&f.hunks[0].parts.some(p=>p.status==='edited'))fail('ファイルの削除は編集できません。');
    if(p.originals[f.id]!==undefined){if(typeof p.originals[f.id]!=='string')fail('元ファイルが不正です。');validateOriginal(v,p.originals[f.id]);}
  }
  return copy(p);
}
