// Terminating the worker also cancels inference and drops its request references.
export class WorkerClient {
  constructor(factory) { this.factory=factory; this.sequence=0; this.worker=null; this.pending=null; }
  initialize(baseURL,onProgress) {
    if(this.initializing) return this.initializing;
    const promise=this.request({type:'initialize',baseURL},onProgress);
    this.initializing=promise;
    const release=()=>{if(this.initializing===promise)this.initializing=null;};
    promise.then(release,release);
    return promise;
  }
  prepare(source,baseURL,onProgress) {
    return this.request({type:'prepare',source,baseURL},onProgress);
  }
  request(message,onProgress=()=>{}) {
    if(this.pending) throw new Error('Already processing.');
    this.worker ||= this.factory();
    const worker=this.worker, id=++this.sequence;
    return new Promise((resolve,reject)=>{
      this.pending={reject};
      worker.onmessage=({data})=>{
        if(data.id!==id || this.worker!==worker || !this.pending) return;
        if(data.progress) {onProgress(data.progress);return;}
        this.pending=null;
        if(data.error) { this.cancel(); reject(new Error(data.error)); }
        else resolve(data.result);
      };
      worker.onerror=event=>{event.preventDefault?.();if(this.worker!==worker)return;this.pending=null;this.cancel();reject(new Error('model'));};
      worker.postMessage({id,...message});
    });
  }
  cancel() {
    this.worker?.terminate(); this.worker=null; this.initializing=null;
    const pending=this.pending;this.pending=null;pending?.reject(new Error('cancelled'));
  }
}
