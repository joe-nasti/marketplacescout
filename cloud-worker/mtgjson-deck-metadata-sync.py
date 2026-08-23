#!/usr/bin/env python3
import hashlib,json,os,time,urllib.request,urllib.error
from datetime import datetime,timezone
import pyarrow.parquet as pq

SUPABASE_URL=os.environ.get('SUPABASE_URL','').rstrip('/')
SERVICE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
BASE=os.environ.get('MTGJSON_PARQUET_BASE_URL','https://mtgjson.com/api/v5/parquet').rstrip('/')
BATCH=300
if not SUPABASE_URL or not SERVICE_KEY: raise RuntimeError('Supabase credentials required')

def now(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def sb(path,method='GET',body=None,prefer=None):
    data=None if body is None else json.dumps(body,separators=(',',':')).encode()
    h={'apikey':SERVICE_KEY,'Authorization':f'Bearer {SERVICE_KEY}','Content-Type':'application/json'}
    if prefer:h['Prefer']=prefer
    last=None
    for attempt in range(5):
        try:
            req=urllib.request.Request(f'{SUPABASE_URL}/rest/v1/{path}',data=data,headers=h,method=method)
            with urllib.request.urlopen(req,timeout=120) as r:
                raw=r.read();return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            last=RuntimeError(f'Supabase HTTP {e.code}: {e.read().decode("utf-8","replace")[:500]}')
            if e.code not in (429,500,502,503,504):raise last
        except Exception as e:last=e
        time.sleep(.5*(2**attempt))
    raise last

def download():
    dest='/tmp/setDecks.parquet';url=f'{BASE}/setDecks.parquet'
    req=urllib.request.Request(url,headers={'User-Agent':'Collectish-MTGJSON-Deck-Metadata/1.0'})
    with urllib.request.urlopen(req,timeout=300) as r,open(dest,'wb') as out:
        while True:
            b=r.read(1024*1024)
            if not b:break
            out.write(b)
    return dest

def deck_key(r):
    raw='|'.join(str(r.get(x) or '') for x in ('code','name','type','releaseDate'))
    return hashlib.sha1(raw.encode()).hexdigest()

def decode_list(v):
    if v is None:return []
    if isinstance(v,str):
        s=v.strip()
        if not s:return []
        try:x=json.loads(s)
        except Exception:return [v]
        if x==v:return [v]
        return decode_list(x)
    if isinstance(v,(list,tuple)):
        out=[]
        for x in v:out.extend(decode_list(x))
        return out
    return [v]

def main():
    started=now();rows=pq.read_table(download()).to_pylist();out=[];skipped=0
    for d in rows:
        name=str(d.get('name') or '').strip()
        if not name:
            skipped+=1;continue
        out.append({
            'deck_key':deck_key(d),
            'code':str(d.get('code') or '') or None,
            'name':name,
            'deck_type':str(d.get('type') or '') or None,
            'release_date':str(d.get('releaseDate') or '') or None,
            'sealed_product_uuids':decode_list(d.get('sealedProductUuids')),
            'source_updated_at':started
        })
    for i in range(0,len(out),BATCH):
        sb('mtgjson_decks?on_conflict=deck_key','POST',out[i:i+BATCH],'resolution=merge-duplicates,return=minimal')
    sb('mtgjson_sync_state?on_conflict=feed','POST',[{
        'feed':'deck_metadata','status':'complete','row_count':len(out),
        'last_started_at':started,'last_completed_at':now(),
        'detail':{'source':'setDecks.parquet','decks':len(out),'skippedMissingName':skipped}
    }],'resolution=merge-duplicates,return=minimal')
    print(json.dumps({'decks':len(out),'skippedMissingName':skipped,'sample':out[0] if out else None}))

if __name__=='__main__':main()
