#!/usr/bin/env python3
import gzip, json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone
import ijson

SUPABASE_URL=os.environ.get('SUPABASE_URL','').rstrip('/')
SERVICE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
BASE=os.environ.get('MTGJSON_BASE_URL','https://mtgjson.com/api/v5').rstrip('/')
BATCH=max(25,min(500,int(os.environ.get('MTGJSON_BATCH_SIZE','200'))))
if not SUPABASE_URL or not SERVICE_KEY:
    raise RuntimeError('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')

def now(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def is_uuid(v):
    if not isinstance(v,str) or len(v)!=36: return False
    try:
        import uuid; uuid.UUID(v); return True
    except: return False

def request_json(path, method='GET', body=None, prefer=None):
    url=f'{SUPABASE_URL}/rest/v1/{path}'
    data=None if body is None else json.dumps(body,separators=(',',':')).encode()
    headers={'apikey':SERVICE_KEY,'Authorization':f'Bearer {SERVICE_KEY}','Content-Type':'application/json'}
    if prefer: headers['Prefer']=prefer
    last=None
    for attempt in range(5):
        try:
            req=urllib.request.Request(url,data=data,headers=headers,method=method)
            with urllib.request.urlopen(req,timeout=120) as r:
                raw=r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw=e.read().decode('utf-8','replace')
            last=RuntimeError(f'Supabase HTTP {e.code}: {raw[:300]}')
            if e.code not in (429,500,502,503,504): raise last
        except Exception as e: last=e
        time.sleep(.5*(2**attempt))
    raise last

def sync_state(status, **extra):
    row={'feed':'identity','status':status,**extra}
    request_json('mtgjson_sync_state?on_conflict=feed','POST',[row],'resolution=merge-duplicates,return=minimal')

def download(file_name):
    url=f'{BASE}/{file_name}.json.gz'
    dest=f'/tmp/{file_name}.json.gz'
    print('Downloading',url,flush=True)
    req=urllib.request.Request(url,headers={'User-Agent':'Collectish-MTGJSON-Sync/1.0'})
    with urllib.request.urlopen(req,timeout=300) as r, open(dest,'wb') as out:
        total=0
        while True:
            chunk=r.read(1024*1024)
            if not chunk: break
            out.write(chunk); total+=len(chunk)
            if total%(25*1024*1024)<1024*1024: print(f'{file_name}: {total/1024/1024:.0f} MiB downloaded',flush=True)
    print(f'{file_name}: {total/1024/1024:.1f} MiB compressed',flush=True)
    return dest

def flush(table, rows, conflict):
    if not rows: return
    request_json(f'{table}?on_conflict={urllib.parse.quote(conflict)}','POST',rows,'resolution=merge-duplicates,return=minimal')
    rows.clear()

def card_row(uid,c):
    if not is_uuid(uid): return None
    x=c.get('identifiers') or {}
    def uidv(k):
        v=x.get(k); return v if is_uuid(v) else None
    def text(v): return None if v is None else str(v)
    rel=c.get('releaseDate') or c.get('originalReleaseDate')
    if rel and len(str(rel))>=10: rel=str(rel)[:10]
    else: rel=None
    return {
      'uuid':uid,'name':str(c.get('name') or '').strip() or '(unknown)',
      'set_code':str(c.get('setCode') or '').strip(),'collector_number':text(c.get('number')),
      'language':text(c.get('language')),'rarity':text(c.get('rarity')),'release_date':rel,
      'finishes':c.get('finishes') if isinstance(c.get('finishes'),list) else [],
      'availability':c.get('availability') if isinstance(c.get('availability'),list) else [],
      'scryfall_id':uidv('scryfallId'),'scryfall_oracle_id':uidv('scryfallOracleId'),
      'tcgplayer_product_id':text(x.get('tcgplayerProductId')),
      'tcgplayer_etched_product_id':text(x.get('tcgplayerEtchedProductId')),
      'tcgplayer_alt_foil_product_id':text(x.get('tcgplayerAlternativeFoilProductId')),
      'cardkingdom_id':text(x.get('cardKingdomId')),'cardkingdom_foil_id':text(x.get('cardKingdomFoilId')),
      'cardkingdom_etched_id':text(x.get('cardKingdomEtchedId')),'csi_id':text(x.get('csiId')),
      'cardmarket_id':text(x.get('mcmId')),'cardmarket_meta_id':text(x.get('mcmMetaId')),
      'scg_id':text(x.get('scgId')),'identifiers':x,'source_updated_at':now()
    }

def import_cards(path):
    rows=[]; count=0
    with gzip.open(path,'rb') as f:
        for uid,c in ijson.kvitems(f,'data'):
            r=card_row(uid,c)
            if not r: continue
            rows.append(r); count+=1
            if len(rows)>=BATCH: flush('mtgjson_cards',rows,'uuid')
            if count%5000==0: print('mtgjson_cards:',count,flush=True)
    flush('mtgjson_cards',rows,'uuid')
    return count

def import_skus(path):
    rows=[]; count=0
    with gzip.open(path,'rb') as f:
        for uid,items in ijson.kvitems(f,'data'):
            if not is_uuid(uid) or not isinstance(items,list): continue
            for s in items:
                if not s.get('skuId') or not s.get('productId'): continue
                rows.append({'sku_id':str(s['skuId']),'uuid':uid,'product_id':str(s['productId']),
                  'condition':str(s.get('condition') or ''),'finish':None if s.get('finish') is None else str(s.get('finish')),
                  'language':str(s.get('language') or ''),'printing':None if s.get('printing') is None else str(s.get('printing')),
                  'source_updated_at':now()})
                count+=1
                if len(rows)>=BATCH: flush('mtgjson_tcgplayer_skus',rows,'sku_id')
                if count%25000==0: print('mtgjson_tcgplayer_skus:',count,flush=True)
    flush('mtgjson_tcgplayer_skus',rows,'sku_id')
    return count

def main():
    started=now(); sync_state('running',last_started_at=started,detail={'mode':'identity-stream'})
    try:
        cards_path=download('AllIdentifiers')
        cards=import_cards(cards_path)
        sku_path=download('TcgplayerSkus')
        skus=import_skus(sku_path)
        sync_state('complete',last_started_at=started,last_completed_at=now(),row_count=cards,detail={'cards':cards,'tcgplayerSkus':skus,'streaming':True})
        print(json.dumps({'ok':True,'cards':cards,'tcgplayerSkus':skus}),flush=True)
    except Exception as e:
        sync_state('failed',last_started_at=started,detail={'error':repr(e),'streaming':True})
        raise

if __name__=='__main__': main()
