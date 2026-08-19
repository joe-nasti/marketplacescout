import { loadResource } from '../state/resources.js';
import store from '../state/store.js';

const nativeFetch=window.fetch.bind(window);
let bridgeInstalled=false;

function trackedHost(url){
  try{
    const host=new URL(String(url),location.href).hostname.toLowerCase();
    return host==='api.scryfall.com'||host.endsWith('.tcgplayer.com')||host==='www.tcgplayer.com'||host==='mpgateway.tcgplayer.com';
  }catch{return false}
}
function keyFor(url){return `external:${String(url)}`}
function write(key,patch){const resources=store.get().resources||{},current=resources[key]||{};store.update('resources',{[key]:{...current,...patch}})}

export function installExternalFetchBridge(){
  if(bridgeInstalled)return;
  bridgeInstalled=true;
  window.fetch=async(input,init={})=>{
    const method=String(init?.method||'GET').toUpperCase();
    const url=typeof input==='string'?input:input?.url||String(input);
    const tracked=method==='GET'&&trackedHost(url),key=keyFor(url);
    if(tracked)write(key,{status:'loading',error:null,requestedAt:Date.now(),url});
    try{
      const response=await nativeFetch(input,init);
      if(tracked){
        const clone=response.clone();
        const text=await clone.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
        write(key,{status:response.ok?'ready':'error',data:response.ok?data:null,error:response.ok?null:(data?.message||data?.error||`HTTP ${response.status}`),fetchedAt:Date.now(),url,statusCode:response.status});
      }
      return response;
    }catch(error){
      if(tracked)write(key,{status:'error',error:String(error?.message||error),failedAt:Date.now(),url});
      throw error;
    }
  };
  window.CollectishNativeFetch=nativeFetch;
}

export async function externalJson(key,url,{force=false,ttl=5*60*1000,init={}}={}){
  return loadResource(`external:${key}`,async()=>{
    const response=await window.fetch(url,{...init,cache:'no-store'});
    const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!response.ok)throw new Error(data?.message||data?.error||`HTTP ${response.status}`);
    return data;
  },{force,ttl});
}

export function scryfallCard(key,url,options={}){return externalJson(`scryfall:${key}`,url,{ttl:30*60*1000,...options})}
export function tcgplayerJson(key,url,options={}){return externalJson(`tcgplayer:${key}`,url,{ttl:5*60*1000,...options})}
