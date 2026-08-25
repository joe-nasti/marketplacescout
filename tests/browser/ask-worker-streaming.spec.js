import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const workerUrl=pathToFileURL(path.join(process.cwd(),'cloud-worker/ask-collectish-http-worker.mjs')).href;

async function worker(){return import(`${workerUrl}?t=${Date.now()}-${Math.random()}`)}

test('Ask worker compresses card context and keeps only two conversation turns',async()=>{
  const {compressRequest}=await worker();
  const body={
    context:{cards:[{name:'Test Card',low:10,directLow:15,directMultiplier:1.5,ckBuylist:8,listings:Array.from({length:100},(_,i)=>({price:i}))}],listings:Array.from({length:80},()=>({seller:'x'})),note:'compact me'},
    conversation:[
      {role:'user',content:'old user'},
      {role:'assistant',content:'old assistant'},
      {role:'user',content:'latest user'},
      {role:'assistant',content:'latest assistant'},
    ]
  };
  const compressed=compressRequest(body);
  expect(compressed.cards).toEqual([{name:'Test Card',low:10,direct:15,spread:1.5,ckBuylist:8}]);
  expect(compressed.conversation.map(x=>x.content)).toEqual(['latest user','latest assistant']);
  expect(JSON.stringify(compressed)).not.toContain('seller');
  expect(compressed.context.listingsCount).toBe(80);
});

test('Ask worker uses low-latency GPT-5 mini streaming parameters',async()=>{
  const {buildOpenAIRequest}=await worker();
  const payload=buildOpenAIRequest({message:'Is this a buy?',cardId:'123',questionType:'buy'});
  expect(payload.model).toBe('gpt-5-mini');
  expect(payload.stream).toBe(true);
  expect(payload.max_completion_tokens).toBe(350);
  expect(payload.reasoning_effort).toBe('minimal');
  expect(payload).not.toHaveProperty('temperature');
  expect(payload.messages.at(-1).content).toContain('Compact market context');
});

test('Ask worker cache key is stable for user + card + question type',async()=>{
  const {queryCacheKey}=await worker();
  const body={userId:'u1',cardId:'card-22',questionType:'exit',message:'What is the exit?'};
  const a=await queryCacheKey(body),b=await queryCacheKey({...body,message:'worded differently'});
  expect(a).toBe(b);
  expect(a).toMatch(/^ask:v1:[a-f0-9]{64}$/);
  const other=await queryCacheKey({...body,questionType:'buy'});
  expect(other).not.toBe(a);
});

test('Ask worker streams cached response immediately without OpenAI configuration',async()=>{
  const {handleAskCollectish}=await worker();
  const kv=new Map();
  const env={ASK_CACHE:{
    async get(key,{type}={}){const raw=kv.get(key);return type==='json'&&raw?JSON.parse(raw):raw||null},
    async put(key,value){kv.set(key,value)}
  }};
  const body={userId:'u1',cardId:'p1',questionType:'buy',message:'Buy it?'};
  const req=()=>new Request('https://collectish.test/api/ask-collectish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const {queryCacheKey}=await worker();const key=await queryCacheKey(body);
  kv.set(key,JSON.stringify({createdAt:Date.now(),text:'Cached buy answer'}));
  const response=await handleAskCollectish(req(),env,{});
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toContain('text/event-stream');
  expect(response.headers.get('Cache-Control')).toBe('no-cache');
  const text=await response.text();
  expect(text).toContain('event: meta');
  expect(text).toContain('"cached":true');
  expect(text).toContain('event: delta');
  expect(text).toContain('Cached buy answer');
  expect(text).toContain('event: done');
});
