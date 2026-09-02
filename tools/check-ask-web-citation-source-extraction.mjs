import fs from 'node:fs';
const web=fs.readFileSync('supabase/functions/ask-collectish-web-research/index.ts','utf8');
for(const token of [
  'annotationRows',
  "type==='url_citation'",
  'source_origin',
  "source_origin:'url_citation'",
  'sourceDiagnostics',
  'url_citation_count',
  'raw_source_count',
  'retained_source_count',
  'CreatorIndex',
  'ask-web-source-diagnostics'
]) if(!web.includes(token)) throw new Error(`missing web citation extraction contract: ${token}`);
if(!/watchedh\\\.com/.test(web)||!/archidekt\\\.com/.test(web)||!/moxfield\\\.com/.test(web)) throw new Error('creator-index host coverage missing');
if(!/return \[\.\.\.callRows\(r\),\.\.\.annotationRows\(r\)\]/.test(web)) throw new Error('resultRows must merge web-search rows and URL citation annotations');
if(!/source_diagnostics:diag/.test(web)) throw new Error('research response must expose source diagnostics');
console.log('Ask web citation source extraction contract passed');
