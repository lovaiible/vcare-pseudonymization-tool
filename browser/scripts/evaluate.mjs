import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createDetector} from '../src/model.js';
import {transform} from '../src/detection.js';
import {expandFixtures} from '../evaluation/fixtures.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const raw=await readFile(new URL('../evaluation/fixtures.json',import.meta.url));
const holdout=await readFile(new URL('../evaluation/holdout.json',import.meta.url));
const fixtures=expandFixtures([...JSON.parse(raw),...JSON.parse(holdout)]);
const manifest=JSON.parse(await readFile(new URL('../model-manifest.json',import.meta.url)));
const modelPath=fileURLToPath(new URL(`../public/models/${manifest.revision}/`,import.meta.url));
const python=process.env.VCARE_PYTHON || `${root}.venv/bin/python`;
const baseline=spawnSync(python,[`${root}browser/scripts/python-baseline.py`],{input:JSON.stringify(fixtures),encoding:'utf8',maxBuffer:10*1024*1024});
if(baseline.status!==0)throw new Error('Python baseline unavailable. Run make setup or set VCARE_PYTHON.');
const pythonResult=JSON.parse(baseline.stdout);
const browserIndex=process.argv.indexOf('--browser-report');
let results, initializationMs, browserChecks;
if(browserIndex!==-1) {
  const report=JSON.parse(await readFile(process.argv[browserIndex+1]));
  if(!Array.isArray(report.results) || report.results.length!==fixtures.length || !fixtures.every(f=>report.results.filter(r=>r.id===f.id).length===1)) throw new Error('Browser report does not match the fixture set.');
  if(report.networkAttemptsAfterLoad!==0 || !report.boundary?.namesCovered || !report.limit?.lastNameCovered) throw new Error('Browser operational checks failed.');
  results=report.results;initializationMs=report.initializationMs;
  browserChecks={requests:report.requests,boundary:report.boundary,limit:report.limit,networkAttemptsAfterLoad:report.networkAttemptsAfterLoad};
} else {
  const start=performance.now();
  const detector=await createDetector({modelPath,tokenizerSpec:JSON.parse(await readFile(modelPath+'tokenizer.json')),device:'cpu'});
  initializationMs=performance.now()-start;
  // Model and tokenizer are loaded: any subsequent fetch is a test failure.
  globalThis.fetch=()=>{throw new Error('Network prohibited during evaluation.');};
  results=[];
  try {
    for(const fixture of fixtures){const start=performance.now();const spans=await detector.detect(fixture.text);results.push({id:fixture.id,spans,ms:performance.now()-start});}
  } finally {await detector.dispose();}
}
function measure(results) {
  const counts={},issues=[],clinicalChanges=[];
  for(const fixture of fixtures){
    const predicted=results.find(r=>r.id===fixture.id).spans, gold=fixture.entities;
    const key=s=>JSON.stringify([s.kind,s.start,s.end]);
    const actual=new Set(predicted.map(key)),expected=new Set(gold.map(key));
    for(const s of gold){const c=counts[s.kind]||={tp:0,fp:0,fn:0};if(actual.has(key(s)))c.tp++;else{c.fn++;issues.push({fixture:fixture.id,kind:s.kind,error:'miss',start:s.start,end:s.end});}}
    for(const s of predicted)if(!expected.has(key(s))){(counts[s.kind]||={tp:0,fp:0,fn:0}).fp++;issues.push({fixture:fixture.id,kind:s.kind,error:'false-positive',start:s.start,end:s.end});}
    // Check every clinical occurrence, including repeated passages, for overlap.
    for(const phrase of fixture.clinical)for(const match of fixture.text.matchAll(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gu'))){
      if(predicted.some(s=>s.start<match.index+phrase.length&&match.index<s.end))clinicalChanges.push({fixture:fixture.id,phrase,start:match.index});
    }
  }
  const total={tp:0,fp:0,fn:0};for(const c of Object.values(counts))for(const k of Object.keys(total))total[k]+=c[k];
  const metric=c=>({...c,precision:c.tp+c.fp?c.tp/(c.tp+c.fp):1,recall:c.tp+c.fn?c.tp/(c.tp+c.fn):1});
  return {types:Object.fromEntries(Object.entries(counts).map(([k,c])=>[k,metric(c)])),total:metric(total),issues,clinicalChanges};
}
const original=measure(pythonResult.results),browser=measure(results);
const gate=['PERSON','LOCATION','ORGANIZATION'].every(type=>browser.types[type].recall>=original.types[type].recall)&&browser.total.precision>=original.total.precision;
const report={fixtureSha256:createHash('sha256').update(raw).digest('hex'),holdoutSha256:createHash('sha256').update(holdout).digest('hex'),model:manifest.model,revision:manifest.revision,pythonVersions:pythonResult.versions,runtime:browserChecks?'Browser WASM':'Node CPU',browserChecks,initializationMs,caseTimings:results.map(({id,ms})=>({id,ms})),python:original,browser,gate};
await mkdir(`${root}browser/evaluation/results`,{recursive:true});
await writeFile(`${root}browser/evaluation/results/${browserChecks?'browser-comparison':'comparison'}.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({gate,python:original.total,browser:browser.total,clinicalChanges:{python:original.clinicalChanges,browser:browser.clinicalChanges},initializationMs},null,2));

if(!gate)process.exitCode=1;
