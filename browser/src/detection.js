// All offsets are UTF-16 indices into the unmodified JavaScript source string.
export const MAX_CHARACTERS = 20_000;
const W = String.raw`[\p{L}\p{N}_]`;
const begin = `(?<!${W})`, end = `(?!${W})`;
const rules = [
  ['EMAIL', String.raw`(?<![\p{L}\p{N}_.+-])[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_.-]+\.[A-Za-z]{2,}`, 0],
  ['IBAN', String.raw`${begin}DE\d{2}(?:[ ]?\d){18}${end}`, 0],
  ['PHONE', String.raw`${begin}(?:\+49[ ()/-]*|0049[ ()/-]*|0\d{2,5}[ /()-]+)\d(?:[ ()/-]*\d){5,13}${end}`, 1],
  ['DATE', String.raw`${begin}(?:\d{1,2}\.\s*\d{1,2}\.\s*\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\.\s*(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)(?:\s+\d{4})?)${end}`, 2, true],
  ['AGE', String.raw`${begin}\d{1,3}\s*(?:Jahre?\s*alt|Jahre?|Monate?\s*alt|Wochen\s*alt|[- ]?jährig${W}*)${end}`, 2, true],
  ['ADDRESS', String.raw`${begin}[A-ZÄÖÜ][\p{L}\p{N}_-]*(?:straße|strasse|str\.|weg|platz|allee|gasse)\s*\d+[a-zA-Z]?(?:\s*,?\s*\d{5}\s+[A-ZÄÖÜ][\p{L}\p{N}_-]*)?`, 1],
  ['POSTAL_CODE', String.raw`${begin}(?<![0-9][.,])[0-9]{5}(?![\p{L}\p{N}_]|[.,][0-9])`, 2],
  ['LOCATION', String.raw`${begin}\d{5}\s+[A-ZÄÖÜ][\p{L}\p{N}_-]+${end}`, 3],
  ['PERSON', String.raw`${begin}(?:Herrn?|Frau)\s+([A-ZÄÖÜ][\p{L}\p{N}_-]+(?:\s+[A-ZÄÖÜ][\p{L}\p{N}_-]+){0,2})`, 3, false, 1],
  ['IDENTIFIER', String.raw`${begin}(?:Patient(?:en)?(?:nummer|[- ]?ID)|Versicherungsnummer|Versichertennummer|Aktenzeichen|Referenz(?:nummer)?|Fallnummer)\s*[:#=-]?\s*([A-Za-z0-9][A-Za-z0-9/-]*)`, 0, true, 1],
].map(([kind, pattern, priority, insensitive, group = 0]) => ({ kind, priority, group, regex: new RegExp(pattern, `dgu${insensitive ? 'i' : ''}`) }));
const signoff = /^(?:best regards|kind regards|warm regards|regards|best wishes|mit freundlichen gr(?:ü|ue|u)(?:ß|ss)en|freundliche gr(?:ü|ue|u)(?:ß|ss)e|viele gr(?:ü|ue|u)(?:ß|ss)e|liebe gr(?:ü|ue|u)(?:ß|ss)e|herzliche gr(?:ü|ue|u)(?:ß|ss)e)[ \t]*[,!:]?[ \t]*/iu;
const name = /^[\p{L}][\p{L}.'’ʼ-]*(?:[ \t]+[\p{L}][\p{L}.'’ʼ-]*){0,7}$/u;
const particles = new Set(['von','van','der','den','de','del','di','da','dos','du','zu','zur','zum','dr.','prof.','med.']);
export function ruleSpans(text) {
  const spans = [];
  for (const { kind, priority, group, regex } of rules) {
    for (const match of text.matchAll(regex)) {
      const [start, end] = match.indices[group];
      spans.push({ start, end, kind, priority });
    }
  }
  const lines = [...text.matchAll(/[^\r\n]*(?:\r?\n|$)/g)].filter(m => m[0]);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i][0].replace(/\r?\n$/, '');
    const leading = line.match(/^[ \t]*/)[0].length;
    const match = line.slice(leading).match(signoff);
    if (!match) continue;
    let start = lines[i].index + leading + match[0].length;
    let value = line.slice(leading + match[0].length).trimEnd();
    for (let next = i + 1; !value && next <= i + 2 && next < lines.length; next++) {
      const raw = lines[next][0].replace(/\r?\n$/, '');
      start = lines[next].index + raw.match(/^[ \t]*/)[0].length;
      value = raw.trim();
    }
    const words = value.split(/[ \t]+/).filter(w => !particles.has(w.toLowerCase()));
    if (name.test(value) && words.length && words.every(w => /^\p{Lu}/u.test(w))) {
      spans.push({ start, end: start + value.length, kind: 'PERSON', priority: 1 });
    }
  }
  return spans;
}
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function resolve(spans) {
  const chosen = [];
  for (const span of [...spans].sort((a,b) => (b.end-b.start)-(a.end-a.start) || a.priority-b.priority || a.start-b.start || compare(a.kind,b.kind))) {
    if (!chosen.some(other => span.start < other.end && other.start < span.end)) chosen.push(span);
  }
  return chosen.sort((a,b) => a.start-b.start);
}
export const labels = { PERSON:'PERSON', EMAIL:'E_MAIL', PHONE:'TELEFON', LOCATION:'ORT', POSTAL_CODE:'PLZ', ORGANIZATION:'EINRICHTUNG', DATE:'DATUM', AGE:'ALTER', ADDRESS:'ADRESSE', IDENTIFIER:'KENNNUMMER', IBAN:'IBAN' };
export function transform(text, spans) {
  const lookup = new Map(), counters = {}, counts = {}, findings = [], mapping = [];
  let draft = '', offset = 0;
  for (const span of resolve(spans)) {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < offset || span.end > text.length || span.end <= span.start || !labels[span.kind]) throw new Error('Invalid detection span.');
    const original = text.slice(span.start, span.end);
    const key = JSON.stringify([span.kind, original]);
    let entry = lookup.get(key);
    if (!entry) {
      const label = labels[span.kind];
      // Avoid confusing a generated placeholder with text already in the input.
      let placeholder;
      do { counters[label] = (counters[label] || 0) + 1; placeholder = `[${label}_${counters[label]}]`; } while (text.includes(placeholder));
      entry = { placeholder, type: span.kind, original, occurrences: [] };
      lookup.set(key, entry); mapping.push(entry);
    }
    entry.occurrences.push({ start: span.start, end: span.end });
    findings.push({ type: span.kind, start: span.start, end: span.end });
    counts[span.kind] = (counts[span.kind] || 0) + 1;
    draft += text.slice(offset, span.start) + entry.placeholder;
    offset = span.end;
  }
  return { draft: draft + text.slice(offset), counts, findings, mapping };
}
