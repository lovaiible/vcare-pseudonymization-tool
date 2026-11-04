// Build only in verification mode; runs the same detector on synthetic fixtures.
import {createDetector} from '../src/model.js';
import {runtimeVersion} from '../src/runtime-version.js';
import {expandFixtures} from '../evaluation/fixtures.js';
import {createTokenizer,windows} from '../src/tokenization.js';
import fixturesJSON from '../evaluation/fixtures.json';
import manifest from '../model-manifest.json';
import holdoutJSON from '../evaluation/holdout.json';
self.onmessage=async({data:{baseURL}})=>{
  const requests=[];const originalFetch=self.fetch.bind(self);let blocked=false,attempts=0;
  self.fetch=async(input,options)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,self.location.href);
    if(blocked){attempts++;throw new Error('Network blocked after model load.');}
    if(url.origin!==self.location.origin || (options?.method||'GET')!=='GET' || options?.body)throw new Error('Unexpected network request.');
    requests.push(url.pathname);
    return originalFetch(input,options);
  };
  let detector;
  try {
    const modelPath=new URL(`models/${manifest.revision}/`,baseURL);
    const spec=await(await fetch(new URL('tokenizer.json',modelPath))).json();
    const started=performance.now();
    detector=await createDetector({modelPath:modelPath.pathname,runtimePath:new URL(`runtime/${runtimeVersion}/`,baseURL).href,tokenizerSpec:spec,progress:()=>self.postMessage({progress:'Loading local model…'})});
    const initializationMs=performance.now()-started;blocked=true;
    const results=[];
    for(const fixture of expandFixtures([...fixturesJSON,...holdoutJSON])){
      self.postMessage({progress:`Testing ${fixture.id} with network blocked…`});
      const started=performance.now(),spans=await detector.detect(fixture.text);
      results.push({id:fixture.id,spans,ms:performance.now()-started});
    }
    // Exercise actual model windows at, across and beyond the 384-token boundary.
    const tokenize=createTokenizer(spec),stem='Die Pflege hilft. ';
    let prefix='';while(tokenize(prefix).length<382)prefix+=stem;
    const boundary=prefix+'Jutta Müller lebt in Berlin. '+stem.repeat(50)+' Anna Schmidt wohnt in Hamburg.';
    const boundarySpans=await detector.detect(boundary);
    const covered=value=>{const start=boundary.indexOf(value);return boundarySpans.some(s=>s.start<=start&&s.end>=start+value.length);};
    const long='Die Pflege hilft. '.repeat(1175).slice(0,19970)+' Jutta Müller.';
    const startedLong=performance.now(),longSpans=await detector.detect(long);
    const longMs=performance.now()-startedLong;
    const longCovered=longSpans.some(s=>s.start<=long.lastIndexOf('Jutta Müller')&&s.end>=long.lastIndexOf('Jutta Müller')+12);
    self.postMessage({initializationMs,requests,networkAttemptsAfterLoad:attempts,results,boundary:{tokens:tokenize(boundary).length,windows:windows(tokenize(boundary)).length,namesCovered:['Jutta Müller','Anna Schmidt'].every(covered)},limit:{characters:Array.from(long).length,ms:longMs,lastNameCovered:longCovered}});
  }catch(error){self.postMessage({error:String(error.message),requests});}
  finally{await detector?.dispose();}
};
