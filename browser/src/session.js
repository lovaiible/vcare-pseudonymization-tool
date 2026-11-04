export class ReviewSession {
  constructor() { this.clear(); }
  clear() { this.revision=(this.revision||0)+1; this.current=null; this.approval=null; }
  prepared(result) { this.clear(); this.current=result; }
  changed() { this.revision++; this.approval=null; }
  async hash(text) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  }
  async approve(draft,reviewed) {
    if(!this.current || !reviewed || !draft.trim()) throw new Error('Review required.');
    const revision=this.revision, hash=await this.hash(draft);
    if(revision!==this.revision) throw new Error('Draft changed.');
    this.approval=hash;
  }
  async export(draft) {
    const revision=this.revision;
    if(!this.current || !this.approval || await this.hash(draft)!==this.approval || revision!==this.revision) throw new Error('Review required.');
    return draft;
  }
}
