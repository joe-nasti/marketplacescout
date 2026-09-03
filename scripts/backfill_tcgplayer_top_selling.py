#!/usr/bin/env python3
import csv, io, json, os, re, sys
from datetime import datetime, timezone
from html import unescape
from urllib.parse import quote, urljoin, urlparse, unquote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

SUPABASE_URL=os.environ.get('SUPABASE_URL','').rstrip('/')
SERVICE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december']
REPORT_SOURCE='TCGplayer Top Selling Report'
UA='MarketplaceScout/0.9 (+historical TCGplayer Top Selling backfill)'

if not SUPABASE_URL or not SERVICE_KEY:
    raise SystemExit('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')

def req(url,method='GET',body=None,accept='*/*',timeout=40):
    data=None if body is None else json.dumps(body).encode()
    headers={'User-Agent':UA,'Accept':accept}
    if url.startswith(SUPABASE_URL):
        headers.update({'apikey':SERVICE_KEY,'Authorization':f'Bearer {SERVICE_KEY}','Content-Type':'application/json'})
    r=Request(url,data=data,method=method,headers=headers)
    with urlopen(r,timeout=timeout) as resp:
        return resp.read(), resp.geturl(), resp.status

def text_of(html):
    s=re.sub(r'<script\b[^>]*>[\s\S]*?</script>',' ',html,flags=re.I)
    s=re.sub(r'<style\b[^>]*>[\s\S]*?</style>',' ',s,flags=re.I)
    s=re.sub(r'<[^>]+>',' ',s)
    return re.sub(r'\s+',' ',unescape(s)).strip()

def meta(html,name):
    e=re.escape(name)
    for p in [rf'<meta[^>]+(?:property|name)=["\']{e}["\'][^>]+content=["\']([^"\']+)',rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{e}["\']']:
        m=re.search(p,html,re.I)
        if m:return unescape(m.group(1)).strip()
    return ''

def article_info(html,url):
    title=meta(html,'og:title') or text_of((re.search(r'<title[^>]*>([\s\S]*?)</title>',html,re.I) or ['',''])[1])
    title=re.sub(r'\s*[|–-]\s*TCGplayer.*$','',title,flags=re.I).strip()
    published=meta(html,'article:published_time') or meta(html,'datePublished')
    if not published:
        m=re.search(r'<time\b[^>]*datetime=["\']([^"\']+)',html,re.I); published=m.group(1) if m else None
    author=meta(html,'author') or None
    body=(re.search(r'<article\b[^>]*>([\s\S]*?)</article>',html,re.I) or re.search(r'<main\b[^>]*>([\s\S]*?)</main>',html,re.I) or ['',html])[1]
    return {'url':url,'title':title,'published_at':published,'author':author,'plain':text_of(body),'html':html}

def is_mtg_top_selling(a):
    title=a['title'].lower()
    lead=a['plain'][:2200].lower()
    top=('top selling' in title or 'top-selling' in title or 'best-selling' in title)
    magic=('magic: the gathering' in title or re.search(r'\bmtg\b',title) or 'top-selling magic' in title)
    if not magic:
        magic='top-selling magic: the gathering cards' in lead or 'top-selling magic cards' in lead
    return bool(top and magic and 'direct by tcgplayer' not in title and ' in direct' not in title)

def report_window(html):
    t=text_of(html)
    months='|'.join(m.title() for m in MONTHS)
    m=re.search(rf'between\s+({months})\s+(\d{{1,2}})(?:,?\s+(\d{{4}}))?\s+and\s+({months})\s+(\d{{1,2}}),?\s+(\d{{4}})',t,re.I)
    if m:
        sm,sd,sy,em,ed,ey=m.groups(); sy=int(sy or ey); ey=int(ey)
        if not m.group(3) and MONTHS.index(sm.lower())>MONTHS.index(em.lower()): sy-=1
        return (f'{sy:04d}-{MONTHS.index(sm.lower())+1:02d}-{int(sd):02d}',f'{ey:04d}-{MONTHS.index(em.lower())+1:02d}-{int(ed):02d}',m.group(0))
    m=re.search(rf'between\s+({months})\s+(\d{{1,2}})(?:,?\s+(\d{{4}}))?\s+and\s+(\d{{1,2}}),?\s+(\d{{4}})',t,re.I)
    if m:
        sm,sd,sy,ed,ey=m.groups(); year=int(sy or ey); mon=MONTHS.index(sm.lower())+1
        return (f'{year:04d}-{mon:02d}-{int(sd):02d}',f'{int(ey):04d}-{mon:02d}-{int(ed):02d}',m.group(0))
    return None

def links(html,base):
    out=[]
    for m in re.finditer(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>',html,re.I):
        href=unescape(m.group(1)); label=text_of(m.group(2)).strip(); u=urljoin(base,href)
        host=urlparse(u).hostname or ''
        if host=='bit.ly' or 'hubspotusercontent' in host:
            if re.search(r'csv|download|report|top selling|price',label,re.I) or 'bit.ly' in host or '.csv' in u.lower():
                if u not in [x['url'] for x in out]: out.append({'url':u,'label':label})
    return out

def bucket(label,url):
    s=(label+' '+unquote(url)).lower()
    if re.search(r'\$?50\s*(?:\+|or more|and up)',s):return '$50+'
    if re.search(r'\$?1(?:\.00)?\s*(?:-|to)\s*\$?50|\$?1(?:\.00)?\s*(?:-|to)\s*\$?49\.99',s):return '$1-$49.99'
    return None

def n(v):
    if v is None:return None
    s=str(v).strip()
    if not s:return None
    try:return float(re.sub(r'[$,%\s,]','',s))
    except:return None

def parse_rows(raw):
    rows=[]
    reader=csv.DictReader(io.StringIO(raw.decode('utf-8-sig','replace')))
    for i,r in enumerate(reader,1):
        norm={re.sub(r'[^a-z0-9]+',' ',k.lower()).strip():(v or '').strip() for k,v in r.items() if k}
        def first(*keys):
            for k in keys:
                if norm.get(k):return norm[k]
            return ''
        card=first('product name','card name','name')
        if not card:continue
        rows.append({'rank':int(n(first('rank','ranking','sales rank')) or i),'card':card,'set':first('set name','set'),'avg':n(first('average sale price','avg sale price','average price','avg price'))})
    return rows

def rest_get(path):
    b,_,_=req(f'{SUPABASE_URL}/rest/v1/{path}',accept='application/json'); return json.loads(b or b'[]')

def rest_post(table,obj):
    url=f'{SUPABASE_URL}/rest/v1/{table}'
    data=json.dumps(obj).encode(); headers={'apikey':SERVICE_KEY,'Authorization':f'Bearer {SERVICE_KEY}','Content-Type':'application/json','Prefer':'return=minimal'}
    with urlopen(Request(url,data=data,method='POST',headers=headers),timeout=40) as r:r.read()

def ingest(owner,a,report_url,rows,win,bkt):
    saved=dupes=0
    for i in range(0,len(rows),20):
        signals=[]
        for r in rows[i:i+20]:
            facts=[f"rank #{r['rank']}"]
            if r['avg'] is not None:facts.append(f"average sale price ${r['avg']:.2f}")
            if bkt:facts.append(f"prior-month average-sale-price bucket {bkt}")
            signals.append({'entity_name':r['card'],'entity_type':'card','claim_type':'demand','direction':'bullish','signal_stage':'confirming','confidence':0.99,'summary':f"TCGplayer first-party sales report ranks {r['card']}{' ['+r['set']+']' if r['set'] else ''} among its top-selling MTG cards ({'; '.join(facts)}). Sales window: {win[0]} through {win[1]}. Rankings are by total copies sold; the published CSV does not state copies-sold counts."})
        payload={'url':report_url,'source_type':'article','source_name':REPORT_SOURCE,'source_profile':'marketplace_editorial','source_subtype':'first_party_market_sales','published_at':a['published_at'],'_scheduler_user_id':owner,'analysis':{'url':report_url,'title':f"{a['title']} — downloadable TCGplayer top-selling report{f' ({bkt})' if bkt else ''}",'author':a['author'],'published_at':a['published_at'],'source_summary':f"TCGplayer first-party Marketplace sales-velocity report ranked by total copies sold. Sales window {win[0]} through {win[1]}. Published CSV fields are rank, product, set, and average sale price; copies-sold counts are not published.{f' Prior-month average-sale-price bucket: {bkt}.' if bkt else ''}",'signals':signals}}
        b,_,_=req(f'{SUPABASE_URL}/functions/v1/market-intel-ingest',method='POST',body=payload,accept='application/json',timeout=90)
        d=json.loads(b or b'{}'); saved+=int(d.get('saved') or 0); dupes+=int(d.get('duplicates') or 0)
    return saved,dupes

def candidates(months_back=25):
    now=datetime.now(timezone.utc); y,m=now.year,now.month
    for _ in range(months_back+1):
        mon=MONTHS[m-1]; slug=f'top-selling-magic-the-gathering-cards-on-tcgplayer-{mon}-{y}'
        yield mon,y,[f'https://seller.tcgplayer.com/blog/{slug}',f'https://seller.tcgplayer.com/blog/articles/{slug}']
        m-=1
        if m==0:m=12;y-=1

def main():
    subs=rest_get('source_captures?select=user_id&capture_type=eq.content_subscription&payload_json-%3E%3Ediscovery=eq.tcgplayer_seller_blog_mtg')
    owners=sorted({str(x.get('user_id') or '') for x in subs if x.get('user_id')})
    if not owners:raise SystemExit('No TCGplayer Seller Blog subscriptions configured')
    found=[]; total_saved=total_dupes=0; skipped_existing=0
    for mon,year,urls in candidates(int(os.environ.get('MONTHS_BACK','25'))):
        a=None
        for u in urls:
            try:
                raw,final,_=req(u,accept='text/html,application/xhtml+xml')
                maybe=article_info(raw.decode('utf-8','replace'),final)
                if is_mtg_top_selling(maybe):a=maybe;break
            except (HTTPError,URLError,TimeoutError):continue
        if not a:continue
        win=report_window(a['html']); dl_links=links(a['html'],a['url'])
        if not win or not dl_links:
            print(json.dumps({'article':a['url'],'status':'skipped','reason':'missing window or CSV links'}),flush=True);continue
        article_reports=[]
        for lk in dl_links:
            try:
                raw,final,_=req(lk['url'],accept='text/csv,text/plain,application/octet-stream')
                if len(raw)>5_000_000:raise ValueError('CSV exceeds 5 MB')
                rows=parse_rows(raw)
                if not rows:continue
                bkt=bucket(lk['label'],final)
                processed=False
                for owner in owners:
                    existing=rest_get(f"source_captures?select=capture_id,metadata_json&user_id=eq.{quote(owner)}&source=eq.{quote(REPORT_SOURCE)}&capture_type=eq.data_report&source_key=eq.{quote(final,safe='')}&limit=1")
                    if existing and (existing[0].get('metadata_json') or {}).get('status')=='saved':
                        skipped_existing+=1
                        continue
                    s,d=ingest(owner,a,final,rows,win,bkt);total_saved+=s;total_dupes+=d;processed=True
                    payload={'parent_article_url':a['url'],'parent_article_title':a['title'],'published_at':a['published_at'],'report_window_start':win[0],'report_window_end':win[1],'report_window_note':win[2],'criteria':{'ranking':'total copies sold','condition':'all','printing_finish':'all','prior_month_average_sale_price_bucket':bkt},'rows':len(rows),'download_url':lk['url'],'final_url':final,'label':lk['label'] or None}
                    meta={'status':'saved','source_profile':'marketplace_editorial','source_subtype':'first_party_market_sales','retrieved_at':datetime.now(timezone.utc).isoformat(),'historical_backfill':True}
                    rest_post('source_captures',{'user_id':owner,'source':REPORT_SOURCE,'capture_type':'data_report','source_key':final,'content_type':'text/csv','payload_json':payload,'payload_text':raw[:200000].decode('utf-8','replace'),'metadata_json':meta})
                article_reports.append({'url':final,'label':lk['label'],'bucket':bkt,'rows':len(rows),'processed':processed})
            except Exception as e:
                print(json.dumps({'article':a['url'],'report':lk['url'],'status':'error','error':str(e)}),file=sys.stderr,flush=True)
        if article_reports:
            found.append({'article':a['url'],'title':a['title'],'sales_window':[win[0],win[1]],'reports':article_reports})
            print(json.dumps(found[-1]),flush=True)
    print(json.dumps({'ok':True,'articles':len(found),'reports':sum(len(x['reports']) for x in found),'saved':total_saved,'duplicates':total_dupes,'skipped_existing':skipped_existing,'found':found},indent=2),flush=True)

if __name__=='__main__':main()
