import fs from 'node:fs';
const web=fs.readFileSync('supabase/functions/ask-collectish-web-research/index.ts','utf8');
for(const token of [
  'creatorInstructions',
  'creatorInput',
  'Promise.all([openai',
  'mergeSearchResults',
  'WatchEDH',
  'Archidekt',
  'Moxfield',
  'creator_search_used:true',
  'search_passes:2',
  'dedicated creator/video pass'
]) if(!web.includes(token)) throw new Error(`missing two-pass creator retrieval token: ${token}`);
if(!/const \[general,creator\]=await Promise\.all/.test(web)) throw new Error('general and creator searches must run independently in parallel');
if(!/src=sources\(merged,card\)/.test(web)) throw new Error('source retention must rank the merged result set');
console.log('Ask two-pass creator retrieval contract passed');
