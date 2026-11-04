// Offset-preserving WordPiece for the pinned cased BERT tokenizer.
// Never reconstruct positions by searching decoded model output.
const punctuation = c => /\p{P}/u.test(c) || /[!-/:-@\[-`{-~]/u.test(c);
const chinese = cp => (cp>=0x4e00&&cp<=0x9fff)||(cp>=0x3400&&cp<=0x4dbf)||(cp>=0x20000&&cp<=0x2a6df)||(cp>=0x2a700&&cp<=0x2b73f)||(cp>=0x2b740&&cp<=0x2b81f)||(cp>=0x2b820&&cp<=0x2ceaf)||(cp>=0xf900&&cp<=0xfaff)||(cp>=0x2f800&&cp<=0x2fa1f);
export function createTokenizer(spec) {
  const n = spec.normalizer;
  if (n.type !== 'BertNormalizer' || !n.clean_text || !n.handle_chinese_chars || n.lowercase || n.strip_accents || spec.pre_tokenizer.type !== 'BertPreTokenizer' || spec.model.type !== 'WordPiece') throw new Error('Unsupported tokenizer.');
  const { vocab, max_input_chars_per_word: maxWord, continuing_subword_prefix: prefix, unk_token: unknown } = spec.model;
  const special = spec.added_tokens.map(t => t.content).sort((a,b)=>b.length-a.length);
  return function tokenize(text) {
    const words = []; let word = [];
    const flush = () => { if (word.length) { words.push(word); word = []; } };
    for (let start = 0; start < text.length;) {
      const token = special.find(t => text.startsWith(t, start));
      if (token) { flush(); words.push([{ value: token, start, end: start + token.length, special: true }]); start += token.length; continue; }
      const cp = text.codePointAt(start), value = String.fromCodePoint(cp), end = start + value.length;
      if (cp === 0 || cp === 0xfffd || (/\p{C}/u.test(value) && !/[\t\r\n]/.test(value))) { start=end; continue; }
      if (/\s/u.test(value)) flush();
      else if (punctuation(value) || chinese(cp)) { flush(); words.push([{ value, start, end }]); }
      else word.push({ value, start, end });
      start=end;
    }
    flush();
    const output=[];
    for (const chars of words) {
      if (chars[0].special) { output.push({ id:vocab[chars[0].value],start:chars[0].start,end:chars[0].end }); continue; }
      let pieces=[], cursor=0;
      if (chars.length <= maxWord) {
        while (cursor < chars.length) {
          let end=chars.length, id;
          for (; end>cursor; end--) {
            const piece=(cursor ? prefix : '')+chars.slice(cursor,end).map(c=>c.value).join('');
            if (Object.hasOwn(vocab,piece)) { id=vocab[piece]; break; }
          }
          if (id===undefined) { pieces=[]; break; }
          pieces.push({id,start:chars[cursor].start,end:chars[end-1].end,continuation:cursor>0}); cursor=end;
        }
      }
      output.push(...(pieces.length ? pieces : [{id:vocab[unknown],start:chars[0].start,end:chars.at(-1).end}]));
    }
    return output;
  };
}
export function windows(tokens, size=384, overlap=64) {
  if (size <= overlap || overlap < 0) throw new Error('Invalid window.');
  const result=[];
  for(let start=0; start<tokens.length;) {
    const end=Math.min(start+size,tokens.length);
    result.push({start,end,tokens:tokens.slice(start,end)});
    if(end===tokens.length) break;
    start=end-overlap;
  }
  return result;
}
export function entitySpans(tokens, predictions) {
  // A word can contain conflicting subtoken labels. Keep its first detected label
  // and whole original extent so a partial name is never left behind.
  const words=[];
  for(let i=0;i<tokens.length;i++) {
    const token=tokens[i];
    if(token.continuation && words.length) {
      const word=words.at(-1);word.end=token.end;
      if(word.label==='O' && predictions[i]!=='O')word.label=predictions[i];
    } else words.push({start:token.start,end:token.end,label:predictions[i]});
  }
  const kinds={PER:'PERSON',LOC:'LOCATION',ORG:'ORGANIZATION'};
  const result=[];let active=null;
  for(const word of words) {
    const [prefix,tag]=word.label.split('-'),kind=kinds[tag];
    if(!kind){active=null;continue;}
    if(prefix==='I' && active?.kind===kind)active.end=word.end;
    else {active={start:word.start,end:word.end,kind,priority:10};result.push(active);}
  }
  return result;
}
