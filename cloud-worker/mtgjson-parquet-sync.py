#!/usr/bin/env python3
import hashlib, json, os, time, urllib.request, urllib.error, urllib.parse
from datetime import date, datetime, timezone
from decimal import Decimal
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

SUPABASE_URL=os.environ.get('SUPABASE_URL','').rstrip('/')
SERVICE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
BASE=os.environ.get('MTGJSON_PARQUET_BASE_URL','https://mtgjson.com/api/v5/parquet').rstrip('/')
BATCH=max(25,min(500,int(os.environ.get('MTGJSON_BATCH_SIZE','300'))))
PAGE=1000
if not SUPABASE_URL or not SERVICE_KEY: raise RuntimeError('Supabase credentials required')

def now(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
def is_uuid(v):
    if not isinstance(v,str) or len(v)!=36:return False
    try:
        import uuid; uuid.UUID(v); return True
    except:return False

def clean(v):
    if isinstance(v,(datetime,date)):return v.isoformat()
    if isinstance(v,Decimal):return float(v)
    if isinstance(v,bytes):return v.decode('utf-8','replace')
    if isinstance(v,list):return [clean(x) for x in v]
    if isinstance(v,dict):return {str(k):clean(x) for k,x in v.items()}
    return v

def jsonish(v,default=None):
    if isinstance(v,(dict,list)): return clean(v)
    if isinstance(v,str):
        s=v.strip()
        if s and s[0] in '[{':
            try:return json.loads(s)
            except:pass
    return {} if default is None else default

def pick(row,*names,default=None):
    for n in names:
        if n in row and row[n] is not None:return row[n]
    return default

def text(v):return None if v is None else str(v)
def arr(v):
    if isinstance(v,list):return v
    if isinstance(v,str):
        x=jsonish(v,default=None)
        if isinstance(x,list):return x
    return [] if v is None else [v]
def datev(v):
    if v is None:return None
    s=str(clean(v));return s[:10] if len(s)>=10 else None

def sb(path,method='GET',body=None,prefer=None):
    url=f'{SUPABASE_URL}/rest/v1/{path}'
    data=None if body is None else json.dumps(clean(body),separators=(',',':')).encode()
    headers={'apikey':SERVICE_KEY,'Authorization':f'Bearer {SERVICE_KEY}','Content-Type':'application/json'}
    if prefer:headers['Prefer']=prefer
    last=None
    for attempt in range(5):
        try:
            req=urllib.request.Request(url,data=data,headers=headers,method=method)
            with urllib.request.urlopen(req,timeout=120) as r:
                raw=r.read();return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw=e.read().decode('utf-8','replace');last=RuntimeError(f'Supabase HTTP {e.code}: {raw[:500]}')
            if e.code not in (429,500,502,503,504):raise last
        except Exception as e:last=e
        time.sleep(.5*(2**attempt))
    raise last

def dedupe(rows,conflict):
    keys=[x.strip() for x in conflict.split(',')]
    return list({tuple(str(r.get(k,'')) for k in keys):r for r in rows}.values())

def upsert(table,rows,conflict):
    if not rows:return 0
    rows=dedupe(rows,conflict);count=0
    for i in range(0,len(rows),BATCH):
        part=rows[i:i+BATCH]
        sb(f'{table}?on_conflict={urllib.parse.quote(conflict)}','POST',part,'resolution=merge-duplicates,return=minimal')
        count+=len(part)
        if count%5000<BATCH:print(f'{table}: {count}/{len(rows)}',flush=True)
    return count

def paged_values(table,column,extra=''):
    values=set();offset=0
    suffix=f'&{extra}' if extra else ''
    while True:
        batch=sb(f'{table}?select={column}&{column}=not.is.null{suffix}&limit={PAGE}&offset={offset}') or []
        for r in batch:
            if r.get(column) not in (None,''):values.add(str(r[column]))
        if len(batch)<PAGE:break
        offset+=PAGE
    return values

def collectish_used_skus():
    marketplace=paged_values('marketplace_scan_rows','sku_id');seller=paged_values('seller_order_items','sku_id');syp=paged_values('syp_products','tcgplayer_id','product_line=eq.Magic')
    used=set(marketplace);used.update(seller);used.update(syp)
    print(f'Collectish relevant exact TCGplayer SKUs: {len(used)} (marketplace={len(marketplace)}, seller={len(seller)}, syp={len(syp)})',flush=True);return used

def download(name):
    url=f'{BASE}/{name}.parquet';dest=f'/tmp/{name}.parquet';print('Downloading',url,flush=True)
    req=urllib.request.Request(url,headers={'User-Agent':'Collectish-MTGJSON-Sync/1.3'})
    with urllib.request.urlopen(req,timeout=300) as r,open(dest,'wb') as out:
        while True:
            b=r.read(1024*1024)
            if not b:break
            out.write(b)
    return dest

def read_rows(name):
    path=download(name);table=pq.read_table(path);print(name,'columns:',','.join(table.column_names),flush=True);return [clean(r) for r in table.to_pylist()]

def identifier_map(data):
    out={}
    for r in data:
        uid=text(pick(r,'uuid','cardUuid','card_uuid'))
        if is_uuid(uid):out[uid]={k:v for k,v in r.items() if k not in ('uuid','cardUuid','card_uuid') and v is not None}
    return out

def idget(x,*keys):
    x=x or {};lowered={str(k).lower():v for k,v in x.items()}
    for k in keys:
        if k in x and x[k] is not None:return x[k]
        if k.lower() in lowered and lowered[k.lower()] is not None:return lowered[k.lower()]
    return None

def sync_cards():
    cards=read_rows('cards');ids=identifier_map(read_rows('cardIdentifiers'));out=[];valid=set()
    for c in cards:
        uid=text(pick(c,'uuid','cardUuid','card_uuid'))
        if not is_uuid(uid):continue
        valid.add(uid);x=ids.get(uid,{})
        out.append({'uuid':uid,'name':str(pick(c,'name',default='') or '').strip() or '(unknown)','set_code':str(pick(c,'setCode','set_code',default='') or ''),'collector_number':text(pick(c,'number','collectorNumber','collector_number')),'language':text(pick(c,'language')),'rarity':text(pick(c,'rarity')),'release_date':datev(pick(c,'releaseDate','release_date','originalReleaseDate')),'finishes':arr(pick(c,'finishes')),'availability':arr(pick(c,'availability')),'scryfall_id':idget(x,'scryfallId') if is_uuid(idget(x,'scryfallId')) else None,'scryfall_oracle_id':idget(x,'scryfallOracleId') if is_uuid(idget(x,'scryfallOracleId')) else None,'tcgplayer_product_id':text(idget(x,'tcgplayerProductId')),'tcgplayer_etched_product_id':text(idget(x,'tcgplayerEtchedProductId')),'tcgplayer_alt_foil_product_id':text(idget(x,'tcgplayerAlternativeFoilProductId')),'cardkingdom_id':text(idget(x,'cardKingdomId')),'cardkingdom_foil_id':text(idget(x,'cardKingdomFoilId')),'cardkingdom_etched_id':text(idget(x,'cardKingdomEtchedId')),'csi_id':text(idget(x,'csiId')),'cardmarket_id':text(idget(x,'mcmId')),'cardmarket_meta_id':text(idget(x,'mcmMetaId')),'scg_id':text(idget(x,'scgId')),'identifiers':x,'source_updated_at':now()})
    return valid,upsert('mtgjson_cards',out,'uuid')

def sync_skus(valid,used_skus):
    path=download('TcgplayerSkus');table=pq.read_table(path);sku_type=table.schema.field('skuId').type;usable=[]
    for s in used_skus:
        try:usable.append(int(s) if pa.types.is_integer(sku_type) else s)
        except:pass
    if not usable:return 0
    filtered=table.filter(pc.is_in(table['skuId'],value_set=pa.array(usable,type=sku_type)));out=[]
    for s in filtered.to_pylist():
        s=clean(s);uid=text(pick(s,'uuid','cardUuid','card_uuid'));sku=pick(s,'skuId','sku_id');product=pick(s,'productId','product_id')
        if uid not in valid or sku is None or product is None:continue
        out.append({'sku_id':str(sku),'uuid':uid,'product_id':str(product),'condition':str(pick(s,'condition',default='') or ''),'finish':text(pick(s,'finish')),'language':str(pick(s,'language',default='') or ''),'printing':text(pick(s,'printing')),'source_updated_at':now()})
    return upsert('mtgjson_tcgplayer_skus',out,'sku_id')

def sync_sealed():
    out=[]
    for p in read_rows('sealedProducts'):
        uid=text(pick(p,'uuid','sealedProductUuid','sealed_product_uuid'))
        if not is_uuid(uid):continue
        ids=jsonish(pick(p,'identifiers',default={}))
        urls=jsonish(pick(p,'purchaseUrls','purchase_urls',default={}))
        out.append({'uuid':uid,'set_code':text(pick(p,'setCode','set_code','code')),'name':str(pick(p,'name',default='') or '').strip() or '(unknown)','category':text(pick(p,'category')),'subtype':text(pick(p,'subtype')),'release_date':datev(pick(p,'releaseDate','release_date')),'card_count':pick(p,'cardCount','card_count'),'product_size':pick(p,'productSize','product_size'),'tcgplayer_product_id':text(idget(ids,'tcgplayerProductId') or pick(p,'tcgplayerProductId')),'cardkingdom_id':text(idget(ids,'cardKingdomId') or pick(p,'cardKingdomId')),'csi_id':text(idget(ids,'csiId') or pick(p,'csiId')),'cardmarket_id':text(idget(ids,'mcmId') or pick(p,'mcmId')),'identifiers':ids,'purchase_urls':urls,'contents':jsonish(pick(p,'contents'),default=pick(p,'contents')),'source_updated_at':now()})
    return upsert('mtgjson_sealed_products',out,'uuid')

def deck_key(r):return hashlib.sha1('|'.join(str(pick(r,x,default='') or '') for x in ('code','name','type','releaseDate')).encode()).hexdigest()
def sync_decks(valid):
    deck_rows=[];card_rows=[]
    for d in read_rows('setDecks'):
        key=deck_key(d);sealed=arr(pick(d,'sealedProductUuids','sealed_product_uuids'))
        deck_rows.append({'deck_key':key,'code':text(pick(d,'code','setCode','set_code')),'name':str(pick(d,'name',default='') or '').strip() or '(unknown)','deck_type':text(pick(d,'type','deckType')),'release_date':datev(pick(d,'releaseDate','release_date')),'sealed_product_uuids':sealed,'source_updated_at':now()})
        for zone,names in [('commander',('commander',)),('main',('mainBoard','main_board')),('side',('sideBoard','side_board'))]:
            entries=[]
            for n in names:
                if isinstance(d.get(n),list):entries=d[n];break
            for c in entries:
                uid=text(pick(c,'uuid','cardUuid','card_uuid'));qty=pick(c,'count','quantity',default=1)
                if uid not in valid:continue
                try:q=int(qty or 1)
                except:q=1
                card_rows.append({'deck_key':key,'card_uuid':uid,'zone':zone,'quantity':q,'finish':text(pick(c,'finish'))})
    return upsert('mtgjson_decks',deck_rows,'deck_key'),upsert('mtgjson_deck_cards',card_rows,'deck_key,card_uuid,zone')

def main():
    started=now();sb('mtgjson_sync_state?on_conflict=feed','POST',[{'feed':'parquet_catalog','last_started_at':started,'status':'running','detail':{'mode':'parquet-relevant-skus+syp'}}],'resolution=merge-duplicates,return=minimal')
    try:
        used=collectish_used_skus();valid,cards=sync_cards();skus=sync_skus(valid,used);sealed=sync_sealed();decks,deck_cards=sync_decks(valid)
        detail={'cards':cards,'relevantSkuUniverse':len(used),'tcgplayerSkus':skus,'sealedProducts':sealed,'decks':decks,'deckCards':deck_cards,'source':'parquet','sypIncluded':True}
        sb('mtgjson_sync_state?on_conflict=feed','POST',[{'feed':'parquet_catalog','last_started_at':started,'last_completed_at':now(),'status':'complete','row_count':cards,'detail':detail}],'resolution=merge-duplicates,return=minimal');print(json.dumps(detail),flush=True)
    except Exception as e:
        sb('mtgjson_sync_state?on_conflict=feed','POST',[{'feed':'parquet_catalog','last_started_at':started,'status':'failed','detail':{'error':repr(e),'source':'parquet-relevant-skus+syp'}}],'resolution=merge-duplicates,return=minimal');raise
if __name__=='__main__':main()
