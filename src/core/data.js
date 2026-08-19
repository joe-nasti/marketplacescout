import { loadResource } from '../state/resources.js';

export async function externalJson(key,url,{force=false,ttl=5*60*1000,init={}}={}){
  return loadResource(`external:${key}`,async()=>{
    const response=await fetch(url,{...init,cache:'no-store'});
    const text=await response.text();
    let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!response.ok)throw new Error(data?.message||data?.error||`HTTP ${response.status}`);
    return data;
  },{force,ttl});
}

export function scryfallCard(key,url,options={}){
  return externalJson(`scryfall:${key}`,url,{ttl:30*60*1000,...options});
}

export function tcgplayerJson(key,url,options={}){
  return externalJson(`tcgplayer:${key}`,url,{ttl:5*60*1000,...options});
}
