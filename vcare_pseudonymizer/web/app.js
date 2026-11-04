'use strict';
class UIError extends Error {}
const $ = id => document.getElementById(id);
let current = null, approved = false, busy = false;
const labels = {PERSON:'Person',EMAIL:'E-Mail',PHONE:'Telefon',LOCATION:'Ort',POSTAL_CODE:'Postleitzahl',ORGANIZATION:'Einrichtung',DATE:'Datum',AGE:'Alter',ADDRESS:'Adresse',IDENTIFIER:'Kennnummer',IBAN:'IBAN'};
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function gate() {
  $('prepare').disabled = busy || !$('source').value.trim();
  $('approve').disabled = busy || !current || !$('reviewed').checked || !$('draft').value.trim() || approved;
  $('download').disabled = busy || !current || !approved;
  $('reviewed').disabled = busy || !current;
  for (const id of ['source','draft','demo','clear']) $(id).disabled = busy;
  for (let i = 1; i <= 3; i++) { const n = current ? (approved ? 3 : 2) : 1; $('step'+i).className = i === n ? 'current' : i < n ? 'done' : ''; }
}
function resetResult() {
  current = null; approved = false; $('reviewed').checked = false; $('draft').value = '';
  $('result').hidden = true; $('empty-output').hidden = false; $('review-state').textContent = 'Noch kein Entwurf'; gate();
}
function sourceChanged() { resetResult(); $('source-count').textContent = $('source').value.length.toLocaleString('de-DE') + ' Zeichen'; status('Anfrage geändert. Bitte Angaben neu erkennen.'); }
function draftChanged() { approved = false; $('reviewed').checked = false; $('review-state').textContent = 'Prüfung erforderlich'; status('Entwurf geändert. Bitte erneut prüfen und freigeben.'); gate(); }
async function api(path, payload) {
  let response;
  try { response = await fetch(path, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json','X-Vcare-Request':'1'}, body:JSON.stringify(payload)}); }
  catch { throw new UIError('Lokaler Server nicht erreichbar. Bitte Server starten und Verbindung prüfen.'); }
  if (!response.ok) { let message = 'Die lokale Verarbeitung ist nicht erreichbar. Bitte Server und Sitzung prüfen.'; try { const data = await response.json(); if (data.error) message = data.error; } catch {} throw new UIError(message); }
  return response;
}
async function run(action) { if (busy) return; busy = true; gate(); try { await action(); } catch (error) { status(error instanceof UIError ? error.message : 'Verarbeitung fehlgeschlagen. Bitte Eingabe und lokalen Server prüfen.', true); } finally { busy = false; gate(); } }
$('source').addEventListener('input', sourceChanged);
$('draft').addEventListener('input', draftChanged);
$('reviewed').addEventListener('change', () => { approved = false; $('review-state').textContent = 'Prüfung erforderlich'; gate(); });
$('demo').onclick = () => {
  if ($('source').value && !confirm('Aktuelle Eingabe durch ein fiktives Beispiel ersetzen?')) return;
  $('source').value = 'Fiktives Beispiel: Frau Jutta Müller ist 76 Jahre alt und wohnt in Berlin, Musterstraße 12. Ihre Tochter bittet um Beratung zum Pflegegrad. Sie hat Asthma und nimmt Salbutamol. Kontakt: jutta@example.org, +49 30 12345678. Termin: 23.10.2026. Patienten-ID: VC-1234.';
  sourceChanged(); status('Fiktives Beispiel eingesetzt. Es enthält keine echten Falldaten.');
};
$('prepare').onclick = () => run(async () => {
  status('Angaben werden lokal erkannt. Beim ersten Mal wird das Sprachmodell geladen …');
  const response = await api('/api/prepare', {source:$('source').value, format:'text'});
  const data = await response.json(); current = data; approved = false; $('reviewed').checked = false;
  $('draft').value = data.draft; $('result').hidden = false; $('empty-output').hidden = true;
  $('review-state').textContent = 'Prüfung erforderlich'; $('counts').replaceChildren();
  const total = Object.values(data.counts).reduce((sum, n) => sum + n, 0);
  $('findings-total').textContent = total ? total + ' Angaben ersetzt' : 'Keine Angaben erkannt – bitte besonders sorgfältig prüfen.';
  for (const [type, count] of Object.entries(data.counts)) { const tag = document.createElement('span'); tag.textContent = (labels[type] || type) + ' · ' + count; $('counts').append(tag); }
  status('Entwurf erstellt. Bitte vollständig mit dem Original vergleichen.');
});
$('approve').onclick = () => run(async () => {
  if (!current || !$('reviewed').checked) return;
  await api('/api/approve', {case:current.case, draft:$('draft').value, reviewed:true});
  approved = true; $('review-state').textContent = 'Freigegeben'; status('Geprüfte Fassung freigegeben. Der Download enthält keine Zuordnung.');
});
$('download').onclick = () => run(async () => {
  if (!current || !approved) return;
  const response = await api('/api/export', {case:current.case, draft:$('draft').value});
  const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'vcare-anfrage.txt';
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('Download bereitgestellt. Gesundheitsangaben bleiben sensibel.');
});
$('clear').onclick = () => run(async () => {
  if (($('source').value || current) && !confirm('Eingaben und lokale Sitzungsdateien löschen? Bereits heruntergeladene Dateien bleiben bestehen.')) return;
  await api('/api/clear', {}); $('source').value = ''; sourceChanged();
  status('Sitzung geleert. Bereits erstellte Downloads bleiben bestehen.');
});
window.addEventListener('pageshow', event => { if (event.persisted) { $('source').value = ''; resetResult(); } });
gate();
