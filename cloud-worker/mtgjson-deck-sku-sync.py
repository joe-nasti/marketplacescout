#!/usr/bin/env python3
import json, os, time, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timezone
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

SUPABASE_URL=os.environ.get('SUPABASE_URL','').rstrip('/')
SERVICE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
BASE=os.environ.get('MTGJSON_PARQUET_BASE_URL','https://mtgjson.com/api/v5/parquet').rstrip('/')
BATCH=300
PAGE=1000
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

def deck_uuids():
    out=set(); offset=0
    while True:
        rows=sb(f'mtgjson_deck_cards?select=card_uuid&limit={PAGE}&offset={offset}') or []
        out.update(str(r['card_uuid']) for r in rows if r.get('card_uuid'))
        if len(rows)<PAGE: break
        offset+=PAGE
    return out

def download():
    url=f'{BASE}/TcgplayerSkus.parquet'; dest='/tmp/TcgplayerSkus.parquet'
    req=urllib.request.Request(url,headers={'User-Agent':'Collectish-MTGJSON-Deck-SKU-Sync/1.0'})
    with urllib.request.urlopen(req,timeout=300) as r, open(dest,'wb') as out:
        while True:
            b=r.read(1024*1024)
            if not b: break
            out.write(b)
    return dest

def upsert(rows):
    count=0
    for i in range(0,len(rows),BATCH):
        part=rows[i:i+BATCH]
        sb('mtgjson_tcgplayer_skus?on_conflict=sku_id','POST',part,'resolution=merge-duplicates,return=minimal')
        count+=len(part)
        if count%5000<BATCH: print(f'deck SKU mappings: {count}/{len(rows)}',flush=True)
    return count

def main():
    targets=deck_uuids()
    print(f'deterministic deck printing UUIDs: {len(targets)}',flush=True)
    table=pq.read_table(download())
    uuid_type=table.schema.field('uuid').type
    target_arr=pa.array(sorted(targets),type=uuid_type)
    mask=pc.and_(
        pc.is_in(table['uuid'],value_set=target_arr),
        pc.and_(pc.equal(table['condition'],'NEAR MINT'),pc.equal(table['language'],'ENGLISH'))
    )
    filtered=table.filter(mask)
    print(f'TcgplayerSkus deck NM English filter: {table.num_rows} -> {filtered.num_rows}',flush=True)
    stamp=now(); rows=[]
    for r in filtered.to_pylist():
        if r.get('skuId') is None or r.get('productId') is None or not r.get('uuid'): continue
        rows.append({'sku_id':str(r['skuId']),'uuid':str(r['uuid']),'product_id':str(r['productId']),
                     'condition':str(r.get('condition') or ''),'finish':r.get('finish'),
                     'language':str(r.get('language') or ''),'printing':r.get('printing'),'source_updated_at':stamp})
    # sku_id is globally unique; dedupe defensively.
    rows=list({r['sku_id']:r for r in rows}.values())
    n=upsert(rows)
    print(json.dumps({'deckUuidUniverse':len(targets),'deckNmEnglishSkuMappings':n}),flush=True)

if __name__=='__main__': main()
