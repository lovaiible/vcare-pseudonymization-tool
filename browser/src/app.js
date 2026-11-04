import '../../vcare_pseudonymizer/web/style.css';
import './loading.css';
import { MAX_CHARACTERS } from './detection.js';
import { ReviewSession } from './session.js';
import { WorkerClient } from './client.js';
const $=id=>document.getElementById(id);
const session=new ReviewSession();
const client=new WorkerClient(()=>new Worker(new URL('./worker.js',import.meta.url),{type:'module'}));
const baseURL=new URL(import.meta.env.BASE_URL,document.baseURI).href;
let busy=false, generation=0, modelGeneration=0, modelReady=false;
const labels={PERSON:'Person',EMAIL:'E-Mail',PHONE:'Telefon',LOCATION:'Ort',POSTAL_CODE:'Postleitzahl',ORGANIZATION:'Einrichtung',DATE:'Datum',AGE:'Alter',ADDRESS:'Adresse',IDENTIFIER:'Kennnummer',IBAN:'IBAN'};
const messages={model:'Das Sprachmodell konnte nicht geladen werden. Bitte Verbindung und bereitgestellte Modelldateien prüfen und erneut versuchen.',processing:'Verarbeitung fehlgeschlagen. Bitte erneut versuchen oder die Anfrage kürzen.',cancelled:'Verarbeitung abgebrochen. Die Eingabe bleibt erhalten.',limit:'Die Anfrage ist zu lang. Bitte auf höchstens 20.000 Zeichen kürzen.'};
const length=()=>Array.from($('source').value).length;
function status(text,error=false) { $('action-status').textContent=text; $('status').classList.toggle('error',error); }
function gate() {
  $('prepare').disabled=!modelReady || busy || !$('source').value.trim() || length()>MAX_CHARACTERS;
  $('approve').disabled=busy || !session.current || !$('reviewed').checked || !$('draft').value.trim() || !!session.approval;
  $('download').disabled=busy || !session.current || !session.approval;
  $('reviewed').disabled=busy || !session.current;
  for(const id of ['source','draft','demo']) $(id).disabled=busy;
  $('cancel').hidden=!busy;
  for(let i=1;i<=3;i++) {const n=session.current?(session.approval?3:2):1;$('step'+i).className=i===n?'current':i<n?'done':'';}
}
function modelStatus(text, percent=null, error=false) {
  $('model-status').textContent=text;
  $('model-loader').classList.toggle('error',error);
  $('model-progress').hidden=error;
  if(percent===null) $('model-progress').removeAttribute('value');
  else $('model-progress').value=percent;
}
async function loadModel() {
  const turn=++modelGeneration;
  modelReady=false;$('retry-model').hidden=true;
  modelStatus('Sprachmodell wird vorbereitet …');
  gate();
  try {
    await client.initialize(baseURL,progress=>{
      if(turn!==modelGeneration)return;
      if(progress.phase==='loading' && Number.isFinite(progress.percent)) {
        const percent=Math.max(0,Math.min(100,progress.percent));
        modelStatus(`Modelldatei wird geladen: ${percent} %`,percent);
      } else if(progress.phase==='initializing') {
        modelStatus('Sprachmodell wird initialisiert …');
      }
    });
    if(turn!==modelGeneration)return;
    modelReady=true;modelStatus('Sprachmodell bereit',100);
  } catch {
    if(turn!==modelGeneration)return;
    modelStatus(messages.model,null,true);$('retry-model').hidden=false;
  } finally {if(turn===modelGeneration)gate();}
}
function stopWorker() {modelGeneration++;modelReady=false;client.cancel();}
$('retry-model').onclick=()=>loadModel();
function resetResult() {
  session.clear();$('reviewed').checked=false;$('draft').value='';$('counts').replaceChildren();$('findings-total').textContent='';
  $('result').hidden=true;$('empty-output').hidden=false;$('review-state').textContent='Noch kein Entwurf';gate();
}
function sourceChanged() {
  resetResult();$('source-count').textContent=length().toLocaleString('de-DE')+' / 20.000 Zeichen';
  status(length()>MAX_CHARACTERS?messages.limit:'Anfrage geändert. Bitte Angaben neu erkennen.',length()>MAX_CHARACTERS);
}
function draftChanged() {
  session.changed();$('reviewed').checked=false;$('review-state').textContent='Prüfung erforderlich';
  status('Entwurf geändert. Bitte erneut prüfen und freigeben.');gate();
}
async function run(action) {
  if(busy)return;
  busy=true;const turn=++generation;gate();
  try {await action(turn);} catch(error) {if(turn===generation){status(messages[error.message]||'Aktion fehlgeschlagen. Bitte die Fassung erneut prüfen und freigeben.',true);if(!client.worker){modelReady=false;modelStatus(messages.model,null,true);$('retry-model').hidden=false;}}}
  finally {if(turn===generation){busy=false;gate();}}
}
$('source').addEventListener('input',sourceChanged);
$('draft').addEventListener('input',draftChanged);
$('reviewed').addEventListener('change',()=>{session.changed();$('review-state').textContent='Prüfung erforderlich';gate();});
$('demo').onclick=()=>{
  if($('source').value && !confirm('Aktuelle Eingabe durch ein fiktives Beispiel ersetzen?'))return;
  $('source').value='Fiktives Beispiel: Frau Jutta Müller ist 76 Jahre alt und wohnt in Berlin, Musterstraße 12. Ihre Tochter bittet um Beratung zum Pflegegrad. Sie hat Asthma und nimmt Salbutamol. Kontakt: jutta@example.org, +49 30 12345678. Termin: 23.10.2026. Patienten-ID: VC-1234.';
  sourceChanged();status('Fiktives Beispiel eingesetzt. Es enthält keine echten Falldaten.');
};
$('prepare').onclick=()=>{if(!modelReady)return;return run(async turn=>{
  resetResult();
  if(length()>MAX_CHARACTERS)throw new Error('limit');
  status('Angaben werden auf diesem Gerät erkannt.');
  const result=await client.prepare($('source').value,baseURL,progress=>{
    if(turn!==generation)return;
    if(progress.phase==='loading')status(`Sprachmodell wird geladen: ${progress.percent} %. Der Originaltext bleibt auf diesem Gerät.`);
    else status(`Angaben werden auf diesem Gerät erkannt: Abschnitt ${progress.completed} von ${progress.total}.`);
  });
  if(turn!==generation)return;
  session.prepared(result);$('draft').value=result.draft;$('result').hidden=false;$('empty-output').hidden=true;$('review-state').textContent='Prüfung erforderlich';
  const total=Object.values(result.counts).reduce((a,b)=>a+b,0);
  $('findings-total').textContent=total?`${total} Angaben ersetzt`:'Keine Angaben erkannt – bitte besonders sorgfältig prüfen.';
  for(const [type,count] of Object.entries(result.counts)){const tag=document.createElement('span');tag.textContent=`${labels[type]||type} · ${count}`;$('counts').append(tag);}
  status('Entwurf erstellt. Bitte vollständig mit dem Original vergleichen.');
});};
$('approve').onclick=()=>run(async()=>{
  await session.approve($('draft').value,$('reviewed').checked);
  $('review-state').textContent='Freigegeben';status('Geprüfte Fassung freigegeben. Der Download enthält keine Zuordnung.');
});
$('download').onclick=()=>run(async turn=>{
  const text=await session.export($('draft').value);
  if(turn!==generation)return;
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),anchor=document.createElement('a');
  anchor.href=url;anchor.download='vcare-anfrage.txt';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  status('Download bereitgestellt. Gesundheitsangaben bleiben sensibel.');
});
$('cancel').onclick=()=>{generation++;stopWorker();busy=false;resetResult();status(messages.cancelled);void loadModel();};
function clear() {
  generation++;stopWorker();busy=false;$('source').value='';resetResult();$('source-count').textContent='0 / 20.000 Zeichen';
}
$('clear').onclick=()=>{
  if(($('source').value||session.current)&&!confirm('Eingaben und Zuordnung in diesem Tab verwerfen? Bereits heruntergeladene Dateien bleiben bestehen.'))return;
  clear();status('Sitzung geleert. Bereits erstellte Downloads bleiben bestehen.');void loadModel();
};
window.addEventListener('pagehide',clear);
window.addEventListener('pageshow',event=>{if(event.persisted){clear();status('Sitzung geleert.');void loadModel();}});
$('source-count').textContent='0 / 20.000 Zeichen';gate();void loadModel();
