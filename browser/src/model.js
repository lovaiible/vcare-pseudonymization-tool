import { AutoModelForTokenClassification, Tensor, env } from '@huggingface/transformers';
import { createTokenizer, windows, entitySpans } from './tokenization.js';
import { resolve, ruleSpans } from './detection.js';
// Adapter shared by the browser worker and the reproducible Node evaluation.
export async function createDetector({ modelPath, runtimePath, tokenizerSpec, progress = () => {}, device = 'wasm' }) {
  env.logLevel = 50;
  env.backends.onnx.logLevel = 'fatal';
  env.fetch = (...args) => globalThis.fetch(...args);
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  if (runtimePath) env.backends.onnx.wasm.wasmPaths = { mjs: runtimePath + 'ort-wasm-simd-threaded.mjs', wasm: runtimePath + 'ort-wasm-simd-threaded.wasm' };
  const tokenize = createTokenizer(tokenizerSpec);
  const model = await AutoModelForTokenClassification.from_pretrained(modelPath, {
    device, dtype: 'q8', local_files_only: true,
    progress_callback: event => {
      // Percentages describe one file, not initialization of the inference runtime.
      if (!event.file?.endsWith('.onnx')) return;
      if (event.status === 'progress' && Number.isFinite(event.progress)) {
        progress(event.progress>=100 ? {phase:'initializing'} : {phase:'loading',percent:Math.floor(event.progress)});
      } else if (event.status === 'done') progress({phase:'initializing'});
    },
  });
  return {
    async detect(text, onProgress=()=>{}) {
      const tokens=tokenize(text), chunks=windows(tokens);
      // Pick each token's prediction from the window with the most surrounding context.
      const predictions=new Array(tokens.length), margins=new Array(tokens.length).fill(-1);
      for (let chunkIndex=0;chunkIndex<chunks.length;chunkIndex++) {
        const chunk=chunks[chunkIndex];
        const ids=[101,...chunk.tokens.map(t=>t.id),102];
        const tensor=values=>new Tensor('int64',BigInt64Array.from(values.map(BigInt)),[1,values.length]);
        const inputs={ input_ids:tensor(ids), attention_mask:tensor(ids.map(()=>1)), token_type_ids:tensor(ids.map(()=>0)) };
        let outputs;
        try {
          outputs=await model(inputs);
          const logits=outputs.logits, classes=logits.dims[2];
          for(let i=0;i<chunk.tokens.length;i++) {
            const margin=Math.min(i,chunk.tokens.length-1-i);
            if(margin<=margins[chunk.start+i]) continue;
            let best=0; const offset=(i+1)*classes;
            for(let c=1;c<classes;c++) if(logits.data[offset+c]>logits.data[offset+best]) best=c;
            predictions[chunk.start+i]=model.config.id2label[best]; margins[chunk.start+i]=margin;
          }
        } finally {
          for(const tensor of Object.values(inputs)) tensor.dispose();
          if(outputs) for(const tensor of Object.values(outputs)) tensor.dispose?.();
        }
        onProgress({phase:'processing',completed:chunkIndex+1,total:chunks.length});
      }
      return resolve([...ruleSpans(text),...entitySpans(tokens,predictions)]);
    },
    dispose:()=>model.dispose(),
  };
}
