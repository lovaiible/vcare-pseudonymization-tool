import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {WorkerClient} from '../src/client.js';
import {ReviewSession} from '../src/session.js';

function fakeWorkers() {
  const workers=[];
  class Worker {
    constructor(){this.sent=[];workers.push(this);}
    postMessage(data){this.sent.push(data);}
    terminate(){this.terminated=true;}
    reply(data){this.onmessage({data:{id:this.sent.at(-1).id,...data}});}
  }
  return {workers,Worker};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('initialization contains no source, deduplicates calls and reuses its worker',async()=>{
  const {workers,Worker}=fakeWorkers();const client=new WorkerClient(()=>new Worker());
  const first=client.initialize('http://localhost/');
  assert.equal(client.initialize('http://localhost/'),first);
  assert.equal(workers.length,1);assert.equal(workers[0].sent.length,1);
  assert.equal(workers[0].sent[0].type,'initialize');assert.ok(!('source' in workers[0].sent[0]));
  workers[0].reply({result:true});await first;
  const prepared=client.prepare('synthetic','http://localhost/');
  assert.equal(workers.length,1);workers[0].reply({result:'draft'});assert.equal(await prepared,'draft');
});
test('startup, typing, failed load, retry, clear, cancellation and restoration',async()=>{
  const {workers,Worker}=fakeWorkers();const elements=new Map(),events={};
  const element=()=>({value:'',textContent:'',hidden:false,checked:false,disabled:false,classList:{toggle(){}},removeAttribute(name){delete this[name];},addEventListener(name,fn){this[name]=fn;},replaceChildren(){},append(){}});
  const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const document={getElementById:$,baseURI:'http://localhost/',createElement:element};
  const source=(await readFile(new URL('../src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',JSON.stringify('http://localhost/app.js')).replaceAll('import.meta.env.BASE_URL',JSON.stringify('/'));
  vm.runInNewContext(source,{document,window:{addEventListener:(name,fn)=>events[name]=fn},URL,Worker,WorkerClient,ReviewSession,MAX_CHARACTERS:20000,confirm:()=>true,setTimeout});
  assert.equal(workers.length,1);assert.equal(workers[0].sent[0].type,'initialize');
  assert.equal($('source').disabled,false);assert.equal($('prepare').disabled,true);
  $('source').value='Synthetic request';$('source').input();assert.equal($('prepare').disabled,true);
  workers[0].reply({progress:{phase:'loading',percent:50}});assert.match($('model-status').textContent,/50/);assert.equal($('model-progress').value,50);
  workers[0].reply({progress:{phase:'initializing'}});assert.match($('model-status').textContent,/initialisiert/);assert.equal($('model-progress').value,undefined);assert.equal($('prepare').disabled,true);
  workers[0].reply({error:'model'});await flush();assert.equal($('retry-model').hidden,false);assert.equal($('model-progress').hidden,true);
  $('retry-model').onclick();assert.equal($('source').value,'Synthetic request');
  workers[1].reply({result:true});await flush();assert.equal($('prepare').disabled,false);assert.equal($('model-status').textContent,'Sprachmodell bereit');assert.equal($('model-progress').value,100);assert.equal($('model-progress').hidden,false);
  const processing=$('prepare').onclick();assert.equal(workers[1].sent.at(-1).type,'prepare');
  $('cancel').onclick();await processing;assert.equal(workers.length,3);assert.equal($('source').value,'Synthetic request');
  workers[1].reply({result:{draft:'stale'}});assert.equal($('draft').value,'');
  $('clear').onclick();assert.equal(workers.length,4);assert.equal($('source').value,'');
  workers[2].reply({result:true});await flush();assert.equal($('prepare').disabled,true);
  events.pagehide();assert.ok(workers[3].terminated);assert.equal(workers.length,4);
  workers[3].reply({result:true});await flush();assert.notEqual($('model-status').textContent,'Sprachmodell bereit');
  events.pageshow({persisted:true});assert.equal(workers.length,5);
  workers[4].reply({result:true});await flush();assert.equal($('model-status').textContent,'Sprachmodell bereit');assert.equal($('model-progress').value,100);assert.equal($('model-progress').hidden,false);
  assert.equal($('prepare').disabled,true);assert.equal($('download').disabled,true);
});
