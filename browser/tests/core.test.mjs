import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ruleSpans,resolve,transform} from '../src/detection.js';
import {createTokenizer,windows,entitySpans} from '../src/tokenization.js';
import {ReviewSession} from '../src/session.js';
import {WorkerClient} from '../src/client.js';
import {expandFixtures} from '../evaluation/fixtures.js';
const rules=text=>transform(text,ruleSpans(text));
test('German contacts, dates, ages, addresses and identifiers',()=>{
  for(const [text,value,kind] of [
    ['Frau Jutta Müller hat Asthma.','Jutta Müller','PERSON'],['Mail: jutta@example.org','jutta@example.org','EMAIL'],
    ['Telefon +49 30 12345678.','+49 30 12345678','PHONE'],['Geboren 12.03.1980.','12.03.1980','DATE'],
    ['Termin 2026-10-23.','2026-10-23','DATE'],['Termin 3. März 2025.','3. März 2025','DATE'],
    ['Sie ist 46 Jahre alt.','46 Jahre alt','AGE'],['Musterstraße 12, 12345 Berlin','Musterstraße 12, 12345 Berlin','ADDRESS'],
    ['Wohnort 12345 Berlin','12345 Berlin','LOCATION'],['IBAN DE89 3704 0044 0532 0130 00','DE89 3704 0044 0532 0130 00','IBAN'],
    ['Patienten-ID: AB-123','AB-123','IDENTIFIER'],['Versichertennummer: A123456789','A123456789','IDENTIFIER'],['Aktenzeichen: VC/123','VC/123','IDENTIFIER']
  ]) assert.ok(rules(text).mapping.some(e=>e.original===value&&e.type===kind),kind);
});
test('German/English signatures with particles, initials and Unicode',()=>{
  for(const [closing,separator,name] of [
    ['Best regards',' ','Jutta Müller'],['Kind regards,','\n','Jutta Müller'],['Best regards,','\n\n','Dr. Jutta Müller'],
    ['Mit freundlichen Grüßen','\r\n','Jutta Müller'],['mit freundlichen Gruessen','\n','Jutta Müller'],
    ['Viele Grüße','\n','Anna-Lena von der Heide'],['Liebe Grüße,','\n','J. Müller'],['Herzliche Grüße','\n','Élodie O’Connor'],['Best wishes','\n','Nguyễn Thị Hồng']
  ]) assert.equal(rules('Asthma, Salbutamol 100 µg.\n\n'+closing+separator+name).draft,'Asthma, Salbutamol 100 µg.\n\n'+closing+separator+'[PERSON_1]');
  for(const text of ['Best regards','Best regards\n','Best regards\nIch habe Asthma','Wir besprechen Best regards Jutta Müller morgen.','Best regards\nDr.'])assert.equal(rules(text).draft,text);
  const result=rules('Best regards\nJutta Müller\nTelefon: +49 30 12345678\n\nViele Grüße\nJutta Müller');
  assert.equal(result.draft.match(/\[PERSON_1\]/g).length,2);assert.ok(result.draft.includes('Telefon: [TELEFON_1]'));
});
test('postal layouts, numeric boundaries and leading zeros',()=>{
  for(const text of ['Wohnort 10115 Berlin','Wohnort Berlin 10115','Wohnort Berlin (10115)','Wohnort Berlin,10115.','PLZ: 10115','Wohnort 01067 Dresden','D-01067 Dresden','10115'])assert.doesNotMatch(rules(text).draft,/10115|01067/);
  for(const text of ['Kennung A10115B','Nummer 123456789','Messwert 0.12345 mg','Messwert 12345,67 mg'])assert.equal(rules(text).draft,text);
});
test('deterministic overlaps, repeats, per-request maps and clinical preservation',()=>{
  const spans=[{start:0,end:8,kind:'ADDRESS',priority:10},{start:0,end:4,kind:'PERSON',priority:0}];
  assert.deepEqual(resolve(spans),[spans[0]]);
  assert.equal(resolve([{start:0,end:4,kind:'PERSON',priority:2},{start:0,end:4,kind:'LOCATION',priority:1}])[0].kind,'LOCATION');
  const text='🙂 jutta@example.org: Asthma, Salbutamol 100 µg. jutta@example.org';
  const result=rules(text);assert.equal(result.mapping.length,1);assert.equal(result.mapping[0].occurrences.length,2);
  assert.equal(result.draft,'🙂 [E_MAIL_1]: Asthma, Salbutamol 100 µg. [E_MAIL_1]');
  assert.deepEqual(rules(text),result);assert.equal(rules('a@example.org').mapping[0].placeholder,'[E_MAIL_1]');
  assert.equal(rules('[E_MAIL_1] a@example.org').draft,'[E_MAIL_1] [E_MAIL_2]');
  assert.ok(!JSON.stringify(result.findings).includes('example.org'));
});
test('approval is bound to exact draft, review and session; export excludes mapping',async()=>{
  const session=new ReviewSession();
  await assert.rejects(()=>session.export('draft'));
  session.prepared(rules('a@example.org'));
  await assert.rejects(()=>session.approve('[E_MAIL_1]',false));
  await session.approve('[E_MAIL_1]',true);assert.equal(await session.export('[E_MAIL_1]'),'[E_MAIL_1]');
  await assert.rejects(()=>session.export('[E_MAIL_1] '));
  session.changed();await assert.rejects(()=>session.export('[E_MAIL_1]'));
  await session.approve('Reviewed',true);session.clear();assert.equal(session.current,null);await assert.rejects(()=>session.export('Reviewed'));
});
test('approval hash race and independent tabs',async()=>{
  const first=new ReviewSession(),second=new ReviewSession();first.prepared(rules('a@example.org'));second.prepared(rules('b@example.org'));
  let finish;first.hash=()=>new Promise(resolve=>{finish=resolve;});
  const approval=first.approve('draft',true);first.clear();finish('hash');await assert.rejects(()=>approval);
  assert.ok(second.current);assert.equal(second.approval,null);
});
test('worker cancellation ignores stale results and supports retry; errors are codes',async()=>{
  const workers=[];const client=new WorkerClient(()=>{const worker={postMessage(data){this.sent=data;},terminate(){this.terminated=true;}};workers.push(worker);return worker;});
  const result=client.prepare('synthetic','http://localhost/',()=>{});const old=workers[0];client.cancel();await assert.rejects(()=>result,/cancelled/);assert.ok(old.terminated);
  const next=client.prepare('next','http://localhost/',()=>{});old.onmessage({data:{id:old.sent.id,result:'stale'}});
  workers[1].onmessage({data:{id:workers[1].sent.id,result:'new'}});assert.equal(await next,'new');
  const fail=client.prepare('next','http://localhost/',()=>{});workers[1].onmessage({data:{id:workers[1].sent.id,error:'model'}});await assert.rejects(()=>fail,/model/);assert.equal(client.worker,null);
});
test('overlapping windows cover all tokens; BIO spans cross window boundaries',()=>{
  const tokens=Array.from({length:1000},(_,i)=>({id:i,start:i*3,end:i*3+2}));
  const chunks=windows(tokens);assert.equal(chunks.at(-1).end,1000);
  for(let i=0;i<1000;i++)assert.ok(chunks.some(c=>c.start<=i&&c.end>i));
  const prediction=tokens.map(()=> 'O');prediction[383]='B-PER';prediction[384]='I-PER';
  assert.deepEqual(entitySpans(tokens,prediction),[{start:1149,end:1154,kind:'PERSON',priority:10}]);
  prediction[384]='B-PER';assert.equal(entitySpans(tokens,prediction).length,2);
});
test('pinned offset tokenizer agrees with library IDs, including Unicode and control characters',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../model-manifest.json',import.meta.url)));
  const base=new URL(`../public/models/${manifest.revision}/`,import.meta.url);
  const spec=JSON.parse(await readFile(new URL('tokenizer.json',base)));
  const tokenize=createTokenizer(spec);
  const {AutoTokenizer,env}=await import('@huggingface/transformers');env.allowRemoteModels=false;env.useFSCache=false;
  const tokenizer=await AutoTokenizer.from_pretrained(base.pathname,{local_files_only:true});
  const fixtures=expandFixtures(JSON.parse(await readFile(new URL('../evaluation/fixtures.json',import.meta.url))));
  for(const text of [...fixtures.map(f=>f.text),'🙂 Ju\u0308rgen Müller\t\r\n Berlin','👩‍⚕️ Weiß\u0000 Müller\u200bBerlin','[CLS] [MASK] [UNK] [SEP]','中文，名字。','a'.repeat(101),'\u00a0\u2003Müller\u2028Berlin','Élodie O’Connor — Nguyễn Thị Hồng']) {
    const tokens=tokenize(text);
    assert.deepEqual(tokens.map(t=>t.id),tokenizer.encode(text,{add_special_tokens:false}));
    for(const token of tokens) {assert.ok(token.end>token.start);assert.ok(text.slice(token.start,token.end));}
  }
});

test('WordPiece continuation stays inside its word even when the model emits B twice',()=>{
  assert.deepEqual(entitySpans([{id:1,start:0,end:2},{id:2,start:2,end:5,continuation:true},{id:3,start:6,end:12}],['B-PER','B-PER','I-PER']),[{start:0,end:12,kind:'PERSON',priority:10}]);
});

test('missing model fails without network or rules-only fallback',async()=>{
  const {createDetector}=await import('../src/model.js');
  const manifest=JSON.parse(await readFile(new URL('../model-manifest.json',import.meta.url)));
  const spec=JSON.parse(await readFile(new URL(`../public/models/${manifest.revision}/tokenizer.json`,import.meta.url)));
  const originalFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error('Network prohibited.');};
  try {await assert.rejects(()=>createDetector({modelPath:'/nonexistent-vcare-test-model/',tokenizerSpec:spec,device:'cpu'}));}
  finally {globalThis.fetch=originalFetch;}
});

test('a detection on a continuation token replaces the complete source word',()=>{
  assert.deepEqual(entitySpans([{id:1,start:3,end:5},{id:2,start:5,end:8,continuation:true}],['O','B-PER']),[{start:3,end:8,kind:'PERSON',priority:10}]);
});
