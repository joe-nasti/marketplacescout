#!/usr/bin/env python3
import concurrent.futures, gzip, json, os, re, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

SUPABASE_URL=os.environ.get('SUPABASE_URL','').rstrip('/')
SERVICE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
BASE=os.environ.get('MTGJSON_BASE_URL','https://mtgjson.com/api/v5').rstrip('/')
WORKERS=max(1,min(8,int(os.environ.get('MTGJSON_SET_WORKERS','4'))))
BATCH=max(25,min(300,int(os.environ.get('MTGJSON_BATCH_SIZE','150'))))
TARGET_CODES=[x.strip().upper() for x in os.environ.get('MTGJSON_SET_CODES','').split(',') if x.strip()]
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
        except Exception as e:last=e
        time.sleep(.5*(2**attempt))
    raise last

def batched_upsert(table,rows,key='uuid'):
    if not rows:return 0
    if key:
        rows=list({str(r[key]):r for r in rows if r.get(key)}.values())
    for i in range(0,len(rows),BATCH):
        sb(f'{table}?on_conflict={key}' if key else table,'POST',rows[i:i+BATCH],'resolution=merge-duplicates,return=minimal')
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
    url=f'{BASE}/{urllib.parse.quote(code.upper())}.json.gz'; last=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Collectish-MTGJSON-Set-Structure/2.0','Accept-Encoding':'gzip'})
            with urllib.request.urlopen(req,timeout=180) as r: raw=r.read()
            try: raw=gzip.decompress(raw)
            except OSError: pass
            data=(json.loads(raw).get('data') or {})
            sealed=data.get('sealedProduct') or data.get('sealedProducts') or []
            cards=data.get('cards') or []
            booster=data.get('booster') if isinstance(data.get('booster'),dict) else {}
            return code,[x for x in sealed if isinstance(x,dict)],[x for x in cards if isinstance(x,dict)],booster,None
        except urllib.error.HTTPError as e:
            if e.code==404:return code,[],[],{},f'404 {url}'
            last=e
        except Exception as e:last=e
        time.sleep(.8*(2**attempt))
    return code,[],[],{},repr(last)

def row_from_product(code,p):
    uid=str(p.get('uuid') or '').strip()
    if len(uid)!=36:return None
    ids=p.get('identifiers') if isinstance(p.get('identifiers'),dict) else {}
    urls=p.get('purchaseUrls') if isinstance(p.get('purchaseUrls'),dict) else {}
    contents=p.get('contents')
    if isinstance(contents,str):
        try: contents=json.loads(contents)
        except: pass
    return {'uuid':uid,'set_code':str(p.get('setCode') or code).upper(),'name':str(p.get('name') or '').strip() or '(unknown)','category':p.get('category'),'subtype':p.get('subtype'),'release_date':str(p.get('releaseDate') or '')[:10] or None,'card_count':p.get('cardCount'),'product_size':p.get('productSize'),'tcgplayer_product_id':identifier(ids,'tcgplayerProductId') or parse_tcg_from_url(purchase_url(urls,'tcgplayer')),'cardkingdom_id':identifier(ids,'cardKingdomId'),'csi_id':identifier(ids,'csiId'),'cardmarket_id':identifier(ids,'mcmId'),'identifiers':ids,'purchase_urls':urls,'contents':contents,'source_updated_at':now()}

def row_from_card(code,c):
    uid=str(c.get('uuid') or '').strip()
    if len(uid)!=36:return None
    return {'uuid':uid,'name':str(c.get('name') or '').strip() or '(unknown)','set_code':str(c.get('setCode') or code).upper(),'type_line':c.get('type'),'supertypes':c.get('supertypes') or [],'types':c.get('types') or [],'subtypes':c.get('subtypes') or [],'frame_effects':c.get('frameEffects') or [],'border_color':c.get('borderColor'),'promo_types':c.get('promoTypes') or [],'is_full_art':c.get('isFullArt'),'is_textless':c.get('isTextless'),'source_updated_at':now()}

def booster_rows(code,booster):
    return [{'set_code':code.upper(),'booster_code':str(k),'booster_config':v,'source_updated_at':now()} for k,v in booster.items() if isinstance(v,dict)]

def resolve_codes():
    if TARGET_CODES:return sorted(set(TARGET_CODES))
    codes=set(); offset=0
    while True:
        rows=sb(f'mtgjson_sealed_products?select=set_code&set_code=not.is.null&limit=1000&offset={offset}') or []
        for r in rows:
            if r.get('set_code'):codes.add(str(r['set_code']).upper())
        if len(rows)<1000:break
        offset+=1000
    return sorted(codes)

def main():
    started=now(); feed='set_structure_catalog'
    sb('mtgjson_sync_state?on_conflict=feed','POST',[{'feed':feed,'last_started_at':started,'status':'running','detail':{'source':'individual-set-json','workers':WORKERS,'targetCodes':TARGET_CODES}}],'resolution=merge-duplicates,return=minimal')
    try:
        codes=resolve_codes(); sealed_rows=[]; card_rows=[]; b_rows=[]; failures=[]; set_counts={}
        print(f'Enriching {len(codes)} MTGJSON set files',flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futs={ex.submit(fetch_set,c):c for c in codes}
            for fut in concurrent.futures.as_completed(futs):
                code,products,cards,booster,error=fut.result()
                if error:failures.append({'setCode':code,'error':error})
                set_counts[code]={'sealed':len(products),'cards':len(cards),'boosters':len(booster)}
                sealed_rows.extend(r for p in products if (r:=row_from_product(code,p)))
                card_rows.extend(r for c in cards if (r:=row_from_card(code,c)))
                b_rows.extend(booster_rows(code,booster))
        sealed_written=batched_upsert('mtgjson_sealed_products',sealed_rows)
        cards_written=batched_upsert('mtgjson_cards',card_rows)
        # Composite key is declared as (set_code,booster_code); PostgREST accepts comma-separated on_conflict.
        if b_rows:
            for i in range(0,len(b_rows),BATCH):sb('mtgjson_set_booster_configs?on_conflict=set_code,booster_code','POST',b_rows[i:i+BATCH],'resolution=merge-duplicates,return=minimal')
        detail={'source':'individual-set-json','setsRequested':len(codes),'setsLoaded':len(codes)-len(failures),'sealedRows':sealed_written,'cardStructureRows':cards_written,'boosterConfigs':len(b_rows),'setCounts':set_counts,'failures':failures[:30]}
        sb('mtgjson_sync_state?on_conflict=feed','POST',[{'feed':feed,'last_started_at':started,'last_completed_at':now(),'status':'complete' if not failures else 'complete_with_warnings','row_count':sealed_written+cards_written+len(b_rows),'detail':detail}],'resolution=merge-duplicates,return=minimal')
        print(json.dumps(detail),flush=True)
    except Exception as e:
        sb('mtgjson_sync_state?on_conflict=feed','POST',[{'feed':feed,'last_started_at':started,'status':'failed','detail':{'error':repr(e),'source':'individual-set-json','targetCodes':TARGET_CODES}}],'resolution=merge-duplicates,return=minimal')
        raise

if __name__=='__main__':main()
