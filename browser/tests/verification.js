let report;
const output=document.getElementById('output');
document.getElementById('run').onclick=()=>{
  document.getElementById('run').disabled=true;
  const worker=new Worker(new URL('./verification-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    if(data.progress){output.textContent=data.progress;return;}
    report=data;output.textContent=JSON.stringify(data,null,2);document.getElementById('save').disabled=false;worker.terminate();
  };
  worker.onerror=()=>{output.textContent='Verification worker failed.';worker.terminate();};
  worker.postMessage({baseURL:new URL('../',document.baseURI).href});
};
document.getElementById('save').onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='vcare-synthetic-browser-verification.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
