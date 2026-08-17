#!/usr/bin/env python3
import concurrent.futures, gzip, json, os, re, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

SUPABASE_URL=os.environ.get('SUPABASE_URL','').rstrip('/')
SERVICE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
BASE=os.environ.get('MTGJSON_BASE_URL','https://mtgjson.com/api/v5').rstrip('/')
WORKERS=max(1,min(8,int(os.environ.get('MTGJSON_SET_WORKERS','4'))))
BATCH=max(25,min(300,int(os.environ.get('MTGJSON_BATCH_SIZE','150'))))
if not SUPABASE_URL or not SERVICE_KEY: raise RuntimeError('Supabase credentials required')

def now(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def sb(path,method='GET',body=None,prefer=None):
    url=f'{SUPABASE_URL}/rest/v1/{path}'
    data=None if body is None else json.dumps(body,separators=(',',':')).encode()
    headers={'apikey':SERVICE_KEY,'Authorization':f'Bearer {SERVICE_KEY}','Content-Type':'application/json'}
    if prefer: headers['Prefer']=prefer
    last=None
    for attempt in range(5):
        try:
            req=urllib.request.Request(url,data=data,headers=headers,method=method)
            with urllib.request.urlopen(req,timeout=120) as r:
                raw=r.read(); return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw=e.read().decode('utf-8','replace'); last=RuntimeError(f'Supabase HTTP {e.code}: {raw[:500]}')
            if e.code not in (429,500,502,503,504): raise last
        except Exception as e: last=e
        time.sleep(.5*(2**attempt))
    raise last

def upsert(rows):
    if not rows:return 0
    seen={str(r['uuid']):r for r in rows}; rows=list(seen.values())
    for i in range(0,len(rows),BATCH):
        sb('mtgjson_sealed_products?on_conflict=uuid','POST',rows[i:i+BATCH],'resolution=merge-duplicates,return=minimal')
    return len(rows)

def parse_tcg_from_url(url):
    if not url:return None
    s=str(url)
    for pat in (r'/product/(\d+)',r'[?&]productId=(\d+)',r'[?&]productid=(\d+)'):
        m=re.search(pat,s,re.I)
        if m:return m.group(1)
    return None

def identifier(ids,*keys):
    if not isinstance(ids,dict):return None
    low={str(k).lower():v for k,v in ids.items()}
    for k in keys:
        v=ids.get(k,low.get(k.lower()))
        if v not in (None,''):return str(v)
    return None

def purchase_url(urls,*keys):
    if not isinstance(urls,dict):return None
    low={str(k).lower():v for k,v in urls.items()}
    for k in keys:
        v=urls.get(k,low.get(k.lower()))
        if v not in (None,''):return str(v)
    return None

def fetch_set(code):
    url=f'{BASE}/{urllib.parse.quote(code.upper())}.json.gz'
    last=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Collectish-MTGJSON-Set-Sealed/1.0','Accept-Encoding':'gzip'})
            with urllib.request.urlopen(req,timeout=180) as r: raw=r.read()
            try: raw=gzip.decompress(raw)
            except OSError: pass
            doc=json.loads(raw)
            data=doc.get('data') or {}
            sealed=data.get('sealedProduct') or data.get('sealedProducts') or []
            return code,[x for x in sealed if isinstance(x,dict)],None
        except urllib.error.HTTPError as e:
            if e.code==404:return code,[],f'404 {url}'
            last=e
        except Exception as e:last=e
        time.sleep(.8*(2**attempt))
    return code,[],repr(last)

def row_from_product(code,p):
    uid=str(p.get('uuid') or '').strip()
    if len(uid)!=36:return None
    ids=p.get('identifiers') if isinstance(p.get('identifiers'),dict) else {}
    urls=p.get('purchaseUrls') if isinstance(p.get('purchaseUrls'),dict) else {}
    tcg=identifier(ids,'tcgplayerProductId') or parse_tcg_from_url(purchase_url(urls,'tcgplayer'))
    contents=p.get('contents')
    # Native set JSON is authoritative. Keep structured contents structured.
    if isinstance(contents,str):
        try: contents=json.loads(contents)
        except: pass
    return {
      'uuid':uid,
      'set_code':str(p.get('setCode') or code or '').upper() or None,
      'name':str(p.get('name') or '').strip() or '(unknown)',
      'category':p.get('category'),
      'subtype':p.get('subtype'),
      'release_date':str(p.get('releaseDate') or '')[:10] or None,
      'card_count':p.get('cardCount'),
      'product_size':p.get('productSize'),
      'tcgplayer_product_id':tcg,
      'cardkingdom_id':identifier(ids,'cardKingdomId'),
      'csi_id':identifier(ids,'csiId'),
      'cardmarket_id':identifier(ids,'mcmId'),
      'identifiers':ids,
      'purchase_urls':urls,
      'contents':contents,
      'source_updated_at':now()
    }

def main():
    started=now()
    sb('mtgjson_sync_state?on_conflict=feed','POST',[{'feed':'set_sealed_catalog','last_started_at':started,'status':'running','detail':{'source':'individual-set-json','workers':WORKERS}}],'resolution=merge-duplicates,return=minimal')
    try:
        # Fetch only set codes that actually have sealed records, but enrich every one of them.
        codes=set(); offset=0
        while True:
            rows=sb(f'mtgjson_sealed_products?select=set_code&set_code=not.is.null&limit=1000&offset={offset}') or []
            for r in rows:
                if r.get('set_code'): codes.add(str(r['set_code']).upper())
            if len(rows)<1000:break
            offset+=1000
        codes=sorted(codes)
        print(f'Enriching {len(codes)} MTGJSON sealed set files',flush=True)
        enriched=[]; failures=[]; set_counts={}
        with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futs={ex.submit(fetch_set,c):c for c in codes}
            for fut in concurrent.futures.as_completed(futs):
                code,products,error=fut.result()
                if error: failures.append({'setCode':code,'error':error})
                set_counts[code]=len(products)
                for p in products:
                    r=row_from_product(code,p)
                    if r:enriched.append(r)
                if len(set_counts)%25==0:print(f'Sets {len(set_counts)}/{len(codes)}; sealed rows {len(enriched)}',flush=True)
        written=upsert(enriched)
        exact_ids=sum(1 for r in enriched if r.get('tcgplayer_product_id'))
        structured=sum(1 for r in enriched if isinstance(r.get('contents'),(dict,list)))
        purchase_tcg=sum(1 for r in enriched if purchase_url(r.get('purchase_urls'),'tcgplayer'))
        detail={'source':'individual-set-json','setsRequested':len(codes),'setsLoaded':len(codes)-len(failures),'sealedRows':written,'tcgplayerIds':exact_ids,'tcgPurchaseUrls':purchase_tcg,'structuredContents':structured,'failures':failures[:30]}
        sb('mtgjson_sync_state?on_conflict=feed','POST',[{'feed':'set_sealed_catalog','last_started_at':started,'last_completed_at':now(),'status':'complete' if not failures else 'complete_with_warnings','row_count':written,'detail':detail}],'resolution=merge-duplicates,return=minimal')
        print(json.dumps(detail),flush=True)
    except Exception as e:
        sb('mtgjson_sync_state?on_conflict=feed','POST',[{'feed':'set_sealed_catalog','last_started_at':started,'status':'failed','detail':{'error':repr(e),'source':'individual-set-json'}}],'resolution=merge-duplicates,return=minimal')
        raise

if __name__=='__main__':main()
