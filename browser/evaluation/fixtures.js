export function expandFixtures(fixtures) {
  return fixtures.map(item=>{
    const marked=item.marked+(item.repeatPrefix||'').repeat(item.repeatCount||0)+(item.suffix||'');
    let text='',cursor=0;const entities=[];
    for(const match of marked.matchAll(/⟦([A-Z_]+)\|([^⟧]+)⟧/gu)) {
      text+=marked.slice(cursor,match.index);
      entities.push({kind:match[1],start:text.length,end:text.length+match[2].length});
      text+=match[2];cursor=match.index+match[0].length;
    }
    text+=marked.slice(cursor);
    return {id:item.id,text,entities,clinical:item.clinical};
  });
}
