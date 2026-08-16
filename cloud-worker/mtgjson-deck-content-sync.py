#!/usr/bin/env python3
import hashlib, json, os, time, urllib.request, urllib.error, urllib.parse
import pyarrow.parquet as pq

SUPABASE_URL=os.environ.get('SUPABASE_URL','').rstrip('/')
SERVICE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
BASE=os.environ.get('MTGJSON_PARQUET_BASE_URL','https://mtgjson.com/api/v5/parquet').rstrip('/')
BATCH=300
if not SUPABASE_URL or not SERVICE_KEY:
    raise RuntimeError('Supabase credentials required')

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
            raw=e.read().decode('utf-8','replace')
            last=RuntimeError(f'Supabase HTTP {e.code}: {raw[:500]}')
            if e.code not in (429,500,502,503,504): raise last
        except Exception as e: last=e
        time.sleep(.5*(2**attempt))
    raise last

def download(name):
    url=f'{BASE}/{name}.parquet'; dest=f'/tmp/{name}.parquet'
    print('Downloading',url,flush=True)
    req=urllib.request.Request(url,headers={'User-Agent':'Collectish-MTGJSON-Deck-Sync/1.0'})
    with urllib.request.urlopen(req,timeout=300) as r,open(dest,'wb') as out:
        while True:
            b=r.read(1024*1024)
            if not b: break
            out.write(b)
    return dest

def deck_key(r):
    raw='|'.join(str(r.get(x) or '') for x in ('code','name','type','releaseDate'))
    return hashlib.sha1(raw.encode()).hexdigest()

def decode(v):
    if v is None: return []
    if isinstance(v,list): return v
    if isinstance(v,str):
        try:
            j=json.loads(v)
            return j if isinstance(j,list) else []
        except: return []
    if isinstance(v,dict):
        for k in ('data','items','cards','values'):
            if isinstance(v.get(k),list): return v[k]
    return []

def card_obj(v):
    if isinstance(v,dict): return v
    if isinstance(v,str):
        try:
            j=json.loads(v)
            return j if isinstance(j,dict) else None
        except: return None
    return None

def upsert(rows):
    if not rows: return 0
    dedup={ (r['deck_key'],r['card_uuid'],r['zone'],r['finish']):r for r in rows }
    rows=list(dedup.values()); written=0
    for i in range(0,len(rows),BATCH):
        part=rows[i:i+BATCH]
        sb('mtgjson_deck_cards?on_conflict=deck_key,card_uuid,zone,finish','POST',part,'resolution=merge-duplicates,return=minimal')
        written+=len(part)
        if written%5000<BATCH: print(f'mtgjson_deck_cards: {written}/{len(rows)}',flush=True)
    return written

def main():
    setdecks=pq.read_table(download('setDecks')).to_pylist()
    cards=pq.read_table(download('cards'),columns=['uuid']).to_pylist()
    valid={str(r['uuid']) for r in cards if r.get('uuid')}
    print('setDecks rows:',len(setdecks),'valid cards:',len(valid),flush=True)
    sample=next((r for r in setdecks if r.get('mainBoard') is not None),None)
    if sample:
        print('mainBoard type:',type(sample.get('mainBoard')).__name__,flush=True)
        print('mainBoard sample:',repr(sample.get('mainBoard'))[:1200],flush=True)
    out=[]; zone_counts={}
    for d in setdecks:
        key=deck_key(d)
        for zone,col in (('commander','commander'),('main','mainBoard'),('side','sideBoard')):
            entries=decode(d.get(col)); zone_counts[zone]=zone_counts.get(zone,0)+len(entries)
            for raw in entries:
                c=card_obj(raw)
                if not c: continue
                uid=str(c.get('uuid') or c.get('cardUuid') or '')
                if uid not in valid: continue
                try: qty=max(1,int(c.get('count') or c.get('quantity') or 1))
                except: qty=1
                finish='foil' if c.get('isFoil') is True else 'normal'
                out.append({'deck_key':key,'card_uuid':uid,'zone':zone,'quantity':qty,'finish':finish})
    print('decoded zone entries:',zone_counts,'candidate rows:',len(out),flush=True)
    written=upsert(out)
    sb('mtgjson_sync_state?on_conflict=feed','POST',[{'feed':'deck_contents','status':'complete','row_count':written,'detail':{'candidateRows':len(out),'zoneEntries':zone_counts}}],'resolution=merge-duplicates,return=minimal')
    print(json.dumps({'ok':True,'deckCards':written,'candidateRows':len(out),'zoneEntries':zone_counts}),flush=True)

if __name__=='__main__': main()
