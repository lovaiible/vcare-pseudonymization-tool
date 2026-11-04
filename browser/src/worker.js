import { createDetector } from './model.js';
import { transform, MAX_CHARACTERS } from './detection.js';
import manifest from '../model-manifest.json';
import { runtimeVersion } from './runtime-version.js';
let detector;
self.onmessage = async ({data}) => {
  const {id,source,baseURL,type}=data;
  if(type!=='initialize' && (typeof source!=='string' || Array.from(source).length>MAX_CHARACTERS)) { self.postMessage({id,error:'limit'}); return; }
  let ready=false;
  try {
    if(!detector) {
      const modelPath=new URL(`models/${manifest.revision}/`,baseURL).href;
      const response=await fetch(new URL('tokenizer.json',modelPath));
      if(!response.ok) throw new Error('Asset missing.');
      detector=await createDetector({modelPath:new URL(modelPath).pathname,runtimePath:new URL(`runtime/${runtimeVersion}/`,baseURL).href,tokenizerSpec:await response.json(),progress:progress=>self.postMessage({id,progress})});
    }
    if(type==='initialize') {self.postMessage({id,result:true});return;}
    ready=true;
    const spans=await detector.detect(source,progress=>self.postMessage({id,progress}));
    self.postMessage({id,result:transform(source,spans)});
  } catch {
    detector=undefined;
    self.postMessage({id,error:ready?'processing':'model'});
  }
};
