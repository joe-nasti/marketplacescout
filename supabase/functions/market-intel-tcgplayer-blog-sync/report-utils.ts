import {dec,safeDownload,text} from './parser.ts';

export type ReportLink={url:string,label:string};

export function topSelling(title:string){return /top[- ]?selling|best[- ]?selling|copies sold/i.test(String(title||''))}

export function csvLinks(html:string,url:string):ReportLink[]{
 const out:ReportLink[]=[];
 for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  const label=text(m[2]).trim(),href=dec(m[1]);let u='';
  try{u=safeDownload(href,url)}catch{continue}
  if(!/csv|download|report|top selling|price trends?/i.test(label)&&!/\.csv(?:$|\?)/i.test(u)&&!/bit\.ly/i.test(u))continue;
  if(!out.some(x=>x.url===u))out.push({url:u,label});
 }
 return out;
}

function parseCsv(raw:string){const rows:string[][]=[];let row:string[]=[],field='',q=false;for(let i=0;i<raw.length;i++){const c=raw[i];if(q){if(c==='"'&&raw[i+1]==='"'){field+='"';i++}else if(c==='"')q=false;else field+=c}else if(c==='"')q=true;else if(c===','){row.push(field);field=''}else if(c==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field=''}else field+=c}if(field.length||row.length){row.push(field.replace(/\r$/,''));rows.push(row)}return rows.filter(r=>r.some(x=>x.trim()))}
function key(s:string){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function first(o:any,names:string[]){for(const n of names){const v=o[key(n)];if(v!==undefined&&String(v).trim())return String(v).trim()}return''}
function num(v:string){const cleaned=String(v??'').trim();if(!cleaned)return null;const n=Number(cleaned.replace(/[$,%\s]/g,'').replace(/,/g,''));return Number.isFinite(n)?n:null}

export function salesReportRows(raw:string){
 const rows=parseCsv(raw);if(rows.length<2)return[];const h=rows[0].map(key);
 return rows.slice(1).map((vals,rowIndex)=>Object.fromEntries(h.map((x,i)=>[x,String(vals[i]??'').trim()])))
  .map((r:any,rowIndex)=>({
   rank:num(first(r,['rank','ranking','sales rank']))??rowIndex+1,
   card:first(r,['product name','card name','name']),
   set:first(r,['set name','set']),
   product_id:first(r,['product id','tcgplayer product id'])||null,
   average_sale_price:num(first(r,['average sale price','avg sale price','average price','avg price'])),
   copies_sold:num(first(r,['copies sold','total copies sold','units sold','quantity sold','total quantity sold','sales','number of sales','sale count','total sales'])),
   raw:r,
  })).filter((r:any)=>r.card)
}

export function priceBucket(label:string,url:string){
 const s=`${label} ${decodeURIComponent(url)}`.toLowerCase();
 if(/\$?50\s*(?:\+|or more|and up)|50%2b/.test(s))return'$50+';
 if(/\$?1(?:\.00)?\s*(?:-|to)\s*\$?50|\$?1(?:\.00)?\s*(?:-|to)\s*\$?49\.99|1-\$?50/.test(s))return'$1-$49.99';
 return null;
}
