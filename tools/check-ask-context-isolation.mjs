import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync('src/modules/ask/endpoint-proxy.js','utf8');
const calls=[];
const nativeFetch=async (url,init={})=>{
  calls.push({url:String(url),init});
  return new Response(JSON.stringify({surface_schema:'collectish.ask.surface.v10',surfaces:[]}),{status:200,headers:{'content-type':'application/json'}});
};

const sandbox={
  console,
  URL,
  Request,
  Response,
  location:{href:'https://collectish.example/scout'},
  document:{getElementById:()=>null},
  window:{
    fetch:nativeFetch,
    __CollectishAskSurfaceQueue:[],
    CollectishContext:{
      legacy:()=>({
        screen:'scout',
        sku_id:'9999999',
        product_id:'999999',
        product_name_hint:'Magda, the Hoardmaster',
        set_name:'Outlaws of Thunder Junction',
        entity:{type:'mtg_sku',sku_id:'9999999',product_id:'999999',product_name:'Magda, the Hoardmaster'},
        view:{tab:'Scout'},
      }),
    },
  },
};
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'endpoint-proxy.js'});

const endpoint='https://project.supabase.co/functions/v1/ask-collectish';
await sandbox.window.fetch(endpoint,{method:'POST',body:JSON.stringify({action:'chat',message:'show me the foil price history for Optimus Prime, Hero BOT #13'})});
let sent=JSON.parse(calls.at(-1).init.body);
assert.match(calls.at(-1).url,/\/functions\/v1\/ask-collectish-api$/);
assert.equal(sent.context.entity,null,'explicit printing must not inherit the open Scout entity');
assert.equal(sent.context.sku_id,null);
assert.equal(sent.context.product_id,null);
assert.equal(sent.context.product_name_hint,null);
assert.equal(sent.context.entity_context_mode,'fallback_suppressed_explicit_target');
assert.equal(sent.context.screen,'scout');
assert.deepEqual(sent.context.view,{tab:'Scout'});

await sandbox.window.fetch(endpoint,{method:'POST',body:JSON.stringify({action:'chat',message:'why this score?'})});
sent=JSON.parse(calls.at(-1).init.body);
assert.equal(sent.context.entity.product_name,'Magda, the Hoardmaster','context-dependent Ask must keep the current Scout entity');
assert.equal(sent.context.sku_id,'9999999');
assert.equal(sent.context.product_id,'999999');

console.log('Ask explicit-target context isolation: ok');
