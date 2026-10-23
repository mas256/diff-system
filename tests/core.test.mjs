import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parsePatch,changes,stats,copy,exportPatch,textLines,linesText,validateOriginal,contextFor,splitChange,serialize,restore,filePath} from '../core.js';
const simple='--- a/book.tex\n+++ b/book.tex\n@@ -1,5 +1,6 @@\n first\n-old\n+new\n+extra\n middle\n-last\n+end\n tail\n';
const decide=(p,s='accepted')=>{for(const c of changes(p))c.part.status=s;return p;};
async function repo(files){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'diff-review-test-'));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['pipe','pipe','pipe']});

  for(const [name,text]of Object.entries(files)){await fs.mkdir(path.dirname(path.join(dir,name)),{recursive:true});await fs.writeFile(path.join(dir,name),text);}

  return {dir,git};
}
function apply(r,patch){execFileSync('git',['-c','core.autocrlf=false','apply','--check','-'],{cwd:r.dir,input:patch,encoding:'utf8',stdio:['pipe','pipe','pipe']});execFileSync('git',['-c','core.autocrlf=false','apply','-'],{cwd:r.dir,input:patch,encoding:'utf8',stdio:['pipe','pipe','pipe']});}

test('parses continuous changes separately with line coordinates',()=>{
  const p=parsePatch(simple);
  assert.equal(changes(p).length,2);assert.deepEqual(changes(p).map(c=>c.oldLine),[1,3]);
  assert.deepEqual(changes(p).map(c=>c.newLine),[1,4]);assert.equal(stats(p).pending,2);
});
test('blocks output with unresolved decisions',()=>assert.throws(()=>exportPatch(parsePatch(simple)),/未判断/));
test('rejecting every change produces no patch',()=>assert.equal(exportPatch(decide(parsePatch(simple),'rejected')),''));
test('mixed approval and edited approval apply cleanly with Git',async()=>{
  const r=await repo({'book.tex':'first\nold\nmiddle\nlast\ntail\n'});
  const p=decide(parsePatch(simple),'rejected');
  const c=changes(p);c[1].part.status='edited';c[1].part.edited='corrected\nanother\n';
  const patch=exportPatch(p);apply(r,patch);assert.equal(await fs.readFile(path.join(r.dir,'book.tex'),'utf8'),'first\nold\nmiddle\ncorrected\nanother\ntail\n');
});
test('text lines preserve empty lines and EOF newline',()=>{
  for(const text of ['','\n','abc','abc\n','abc\n\n','\n\n','あ\nい'])assert.equal(linesText(textLines(text)),text);
});
test('validates original including EOF state; context can expand',()=>{
  const p=parsePatch(simple),f=p.files[0],text='first\nold\nmiddle\nlast\ntail\n';
  validateOriginal(f,text);validateOriginal(f,text+'bad\n'); // Unpatched trailing lines are valid.
  assert.throws(()=>validateOriginal(f,'WRONG\nold\nmiddle\nlast\ntail\n'),/一致/);
});
test('splitting keeps independent decisions and survives project restore',()=>{
  const p=parsePatch(simple),id=changes(p)[0].part.id;
  splitChange(p,id,1,1);assert.equal(changes(p).length,3);
  changes(p)[0].part.status='rejected';changes(p)[1].part.status='accepted';changes(p)[2].part.status='accepted';
  assert.deepEqual(restore(serialize(p)),p);
});
test('malformed, binary, rename and mode changes fail explicitly',()=>{
  const inputs=['nothing','--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n','GIT binary patch\n','diff --git a/a b/a\nold mode 100644\nnew mode 100755\n','--- a/old\n+++ b/new\n@@ -1 +1 @@\n-x\n+y\n','--- a/a\n+++ b/a\n@@ -0 +1 @@\n-x\n+y\n'];
  for(const input of inputs)assert.throws(()=>parsePatch(input));
});
test('rejects trailing unrecognized or mode-only files instead of silently omitting',()=>{
  assert.throws(()=>parsePatch(simple+'diff --git a/empty b/empty\nnew file mode 100644\nindex 0000000..e69de29\n'));
  assert.throws(()=>parsePatch(simple+'garbage\n'));
});
test('Git octal paths and CRLF patch transport are decoded',()=>{
  const p=parsePatch('--- "a/\\346\\225\\260.tex"\n+++ "b/\\346\\225\\260.tex"\n@@ -1 +1 @@\n-旧\n+新\n'.replace(/\n/g,'\r\n'));
  assert.equal(filePath(p.files[0]),'数.tex');
});
test('restore rejects tampered statuses, coordinates and text',()=>{
  const p=parsePatch(simple);let d=JSON.parse(serialize(p));d.project.files[0].hunks[0].parts[1].status='oops';assert.throws(()=>restore(JSON.stringify(d)));
  d=JSON.parse(serialize(p));d.project.files[0].hunks[0].oldCount=999;assert.throws(()=>restore(JSON.stringify(d)));
  d=JSON.parse(serialize(p));d.project.files[0].oldHeader+='\\nmalicious';assert.throws(()=>restore(JSON.stringify(d)));
});
test('no newline EOF markers survive approval and rejection',()=>{
  const patch='--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n';
  assert.equal(exportPatch(decide(parsePatch(patch))),patch.replace('@@ -1 +1 @@','@@ -1,1 +1,1 @@'));
  assert.equal(exportPatch(decide(parsePatch(patch),'rejected')),'');
});
test('edits removing newline before context cannot be exported',()=>{
  const p=decide(parsePatch(simple));const c=changes(p)[0];c.part.status='edited';c.part.edited='bad';
  assert.throws(()=>exportPatch(p),/末尾改行/);
});
test('script-like content is treated as literal patch payload',()=>{
  const p=decide(parsePatch('--- a/a\n+++ b/a\n@@ -1 +1 @@\n-<script>old</script>\n+<img src=x onerror=alert(1)>\n'));
  assert.match(exportPatch(p),/\+<img src=x onerror=alert\(1\)>/);
});
