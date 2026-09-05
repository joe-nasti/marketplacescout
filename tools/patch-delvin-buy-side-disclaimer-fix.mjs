import fs from 'node:fs';
const p='supabase/functions/ask-collectish-delvin-supply-present/index.ts';
let s=fs.readFileSync(p,'utf8');
const re=/if\(oppText\)sections\.push\(\{heading:'Buy-side watch',kind:'text',text:`\$\{oppText\}[\s\S]*?Research signal only — demand is shown per printing; pull odds appear only where explicitly sourced\.`\}\);/;
if(!re.test(s)) throw new Error('Buy-side disclaimer block not found');
s=s.replace(re,"if(oppText)sections.push({heading:'Buy-side watch',kind:'text',text:oppText});");
fs.writeFileSync(p,s);
console.log('Removed duplicate Buy-side disclaimer');
