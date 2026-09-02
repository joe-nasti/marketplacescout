#!/usr/bin/env python3
import bisect, json, math, os, random, statistics, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

SUPABASE_URL=os.environ.get('SUPABASE_URL','').rstrip('/')
SERVICE_KEY=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
SET_CODES=[x.strip().upper() for x in os.environ.get('MTGJSON_NATIVE_BOOSTER_SETS','CMM').split(',') if x.strip()]
BOOSTER_CODES=[x.strip().lower() for x in os.environ.get('MTGJSON_NATIVE_BOOSTER_CODES','draft,set,collector').split(',') if x.strip()]
SAMPLES=max(2000,min(100000,int(os.environ.get('MTGJSON_NATIVE_BOOSTER_SAMPLES','30000'))))
FEE_RATE=float(os.environ.get('SEALED_EV_FEE_RATE','0.25'))
if not SUPABASE_URL or not SERVICE_KEY: raise RuntimeError('Supabase credentials required')

def now(): return datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def sb(path,method='GET',body=None,prefer=None):
    url=f'{SUPABASE_URL}/rest/v1/{path}'
    data=None if body is None else json.dumps(body,separators=(',',':')).encode()
    headers={'apikey':SERVICE_KEY,'Authorization':f'Bearer {SERVICE_KEY}','Content-Type':'application/json'}
    if prefer:headers['Prefer']=prefer
    last=None
    for attempt in range(5):
        try:
            req=urllib.request.Request(url,data=data,headers=headers,method=method)
            with urllib.request.urlopen(req,timeout=120) as r:
                raw=r.read(); return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw=e.read().decode('utf-8','replace'); last=RuntimeError(f'Supabase HTTP {e.code}: {raw[:800]}')
            if e.code not in (429,500,502,503,504):raise last
        except Exception as e:last=e
        time.sleep(.5*(2**attempt))
    raise last

def chunks(items,n=100):
    for i in range(0,len(items),n):yield items[i:i+n]

def in_filter(values):return ','.join(str(v) for v in values)

def get_user(set_code):
    rows=sb(f'sealed_set_profiles?select=user_id&set_code=eq.{urllib.parse.quote(set_code)}&enabled=eq.true&limit=1') or []
    if not rows:raise RuntimeError(f'No enabled sealed profile for {set_code}')
    return rows[0]['user_id']

def get_configs(set_code):
    rows=sb(f'mtgjson_set_booster_configs?select=booster_code,booster_config,config_fingerprint&set_code=eq.{urllib.parse.quote(set_code)}') or []
    return {str(r['booster_code']).lower():r for r in rows}

def get_verifications(set_code):
    rows=sb(f'sealed_native_booster_verifications?select=booster_code,config_fingerprint,verification_status,official_source_url,verified_at,verification_notes&set_code=eq.{urllib.parse.quote(set_code)}') or []
    return {str(r['booster_code']).lower():r for r in rows}

def get_products(set_code):
    return sb(f'mtgjson_sealed_products?select=uuid,set_code,name,category,subtype,tcgplayer_product_id,contents&set_code=eq.{urllib.parse.quote(set_code)}&category=in.(booster_pack,booster_box,booster_case)') or []

def get_cards(uuids):
    out={}
    for part in chunks(sorted(uuids),80):
        rows=sb(f"mtgjson_cards?select=uuid,name,set_code,collector_number,rarity,tcgplayer_product_id&uuid=in.({in_filter(part)})&limit=1000") or []
        out.update({r['uuid']:r for r in rows})
    return out

def get_prices(uuids):
    out={}
    for part in chunks(sorted(uuids),250):
        rows=sb('rpc/get_preferred_prices_for_uuids','POST',{'p_uuids':part}) or []
        for r in rows:out[(r['uuid'],str(r.get('finish') or 'normal').lower())]=r
    return out

def sealed_price(sealed_uuid):
    rows=sb(f'sealed_product_price_current?select=market_price,low_price,low_with_shipping,captured_at&sealed_uuid=eq.{sealed_uuid}&order=captured_at.desc&limit=1') or []
    if not rows:return None,None
    r=rows[0]; return r.get('market_price') or r.get('low_with_shipping') or r.get('low_price'),r.get('captured_at')

def sheet_finish(name,sheet):
    n=name.lower()
    if 'etched' in n:return 'etched'
    return 'foil' if bool(sheet.get('foil')) else 'normal'

def weighted_choice(rng,items,cumulative,total):
    if not items or total<=0:return None
    x=rng.random()*total
    idx=bisect.bisect_left(cumulative,x)
    return items[min(idx,len(items)-1)]

def pctile(vals,p):
    if not vals:return None
    s=sorted(vals); x=(len(s)-1)*p; lo=int(math.floor(x)); hi=int(math.ceil(x))
    if lo==hi:return s[lo]
    return s[lo]*(hi-x)+s[hi]*(x-lo)

def stats(vals,ref,fee_rate):
    mean=statistics.fmean(vals); med=pctile(vals,.5); p10=pctile(vals,.1); p90=pctile(vals,.9); net=mean*(1-fee_rate)
    if ref and ref>0:
        gross_be=sum(v>=ref for v in vals)/len(vals); net_be=sum(v*(1-fee_rate)>=ref for v in vals)/len(vals); two=sum(v>=2*ref for v in vals)/len(vals); five=sum(v>=5*ref for v in vals)/len(vals)
    else:gross_be=net_be=two=five=None
    return {'mean':mean,'median':med,'p10':p10,'p90':p90,'net':net,'gross_be':gross_be,'net_be':net_be,'two_x':two,'five_x':five}

def build_native_model(set_code,booster_code,cfg,cards,prices):
    sheets={}; missing_cards=[]; expected_contrib={}; expected_draws={}
    for sheet_name,sheet in (cfg.get('sheets') or {}).items():
        finish=sheet_finish(sheet_name,sheet); entries=[]; cumulative=[]; total=0.0; priced_weight=0.0
        for uid,w in (sheet.get('cards') or {}).items():
            weight=float(w or 0)
            if weight<=0:continue
            meta=cards.get(uid)
            if not meta:missing_cards.append(uid); continue
            pr=prices.get((uid,finish)) or {}
            mv=pr.get('market_price')
            value=float(mv) if mv is not None else 0.0
            total+=weight; cumulative.append(total); entries.append({'uuid':uid,'weight':weight,'value':value,'meta':meta,'price':pr,'finish':finish})
            if mv is not None:priced_weight+=weight
        sheets[sheet_name]={'finish':finish,'items':entries,'cum':cumulative,'total':total,'priced_weight':priced_weight}
    layouts=[]; layout_cum=[]; layout_total=0.0
    for layout in (cfg.get('boosters') or []):
        w=float(layout.get('weight') or 0)
        if w<=0:continue
        layout_total+=w; layout_cum.append(layout_total); layouts.append(layout)
        for sheet_name,draws in (layout.get('contents') or {}).items():expected_draws[sheet_name]=expected_draws.get(sheet_name,0.0)+w*float(draws or 0)
    if layout_total<=0:raise RuntimeError(f'{set_code}/{booster_code} has no weighted layouts')
    expected_draws={k:v/layout_total for k,v in expected_draws.items()}
    total_draws=sum(expected_draws.values())
    priced_draws=0.0
    for sheet_name,draws in expected_draws.items():
        sh=sheets.get(sheet_name)
        if not sh or sh['total']<=0:continue
        coverage=sh['priced_weight']/sh['total']; priced_draws+=draws*coverage
        for item in sh['items']:
            ev=draws*(item['weight']/sh['total'])*item['value']
            key=(sheet_name,item['uuid'],item['finish']); expected_contrib[key]=ev
    coverage=priced_draws/total_draws if total_draws>0 else 0
    return sheets,layouts,layout_cum,layout_total,expected_draws,expected_contrib,coverage,missing_cards

def simulate_pack(rng,sheets,layouts,layout_cum,layout_total):
    layout=weighted_choice(rng,layouts,layout_cum,layout_total); total=0.0
    for sheet_name,draws in (layout.get('contents') or {}).items():
        sh=sheets.get(sheet_name)
        if not sh or not sh['items']:continue
        for _ in range(int(draws or 0)):
            item=weighted_choice(rng,sh['items'],sh['cum'],sh['total'])
            if item:total+=item['value']
    return total

def pack_count(product,pack_uuid,products_by_uuid,visiting=None):
    if str(product.get('uuid'))==str(pack_uuid):return 1
    visiting=set(visiting or ())
    product_uuid=str(product.get('uuid') or '')
    if product_uuid in visiting:return 0
    visiting.add(product_uuid)
    sealed=((product.get('contents') or {}).get('sealed') or []) if isinstance(product.get('contents'),dict) else []
    total=0
    for child in sealed:
        child_uuid=str(child.get('uuid') or '')
        quantity=int(child.get('count') or 0)
        if quantity<=0:continue
        if child_uuid==str(pack_uuid):total+=quantity
        elif child_uuid in products_by_uuid:
            total+=quantity*pack_count(products_by_uuid[child_uuid],pack_uuid,products_by_uuid,visiting)
    return total

def product_kind(product,booster_count):
    category=product.get('category')
    if category=='booster_pack':return 'pack'
    if category=='booster_case':return 'case'
    return 'box' if booster_count>1 else 'pack'

def write_backtest(user_id,product,booster_code,booster_count,pack_vals,expected_draws,sheets,expected_contrib,coverage,missing_cards,verification):
    ref,ref_at=sealed_price(product['uuid']); rng=random.Random(f"{product['uuid']}|mtgjson-native-v1|{SAMPLES}")
    if booster_count==1:vals=pack_vals[:]
    else:vals=[sum(pack_vals[rng.randrange(len(pack_vals))] for _ in range(booster_count)) for _ in range(SAMPLES)]
    st=stats(vals,float(ref) if ref is not None else None,FEE_RATE)
    total_ev=sum(expected_contrib.values())*booster_count
    top10=sum(sorted((x*booster_count for x in expected_contrib.values()),reverse=True)[:10]); top10_share=top10/total_ev if total_ev>0 else None
    payload={
      'user_id':user_id,'sealed_uuid':product['uuid'],'set_code':product['set_code'],'product_name':product['name'],
      'model_key':f'mtgjson_native_{booster_code}_{product_kind(product,booster_count)}','model_version':'mtgjson-native-booster-v1',
      'valuation_as_of':now(),'sealed_reference_price':ref,'reference_price_source':'sealed_product_price_current',
      'sample_count':SAMPLES,'booster_count':booster_count,'booster_mean_ev':round(statistics.fmean(pack_vals),4),'topper_mean_ev':None,
      'gross_mean_ev':round(st['mean'],4),'gross_median_ev':round(st['median'],4),'p10_ev':round(st['p10'],4),'p90_ev':round(st['p90'],4),
      'net_mean_ev_after_fees':round(st['net'],4),'break_even_probability':st['gross_be'],'two_x_probability':st['two_x'],'five_x_probability':st['five_x'],'top10_ev_share':top10_share,
      'excluded_jackpot':{},
      'assumptions':{'booster_code':booster_code,'native_config_source':'mtgjson_set_booster_configs','native_weighted_sheets':True,'fee_rate':FEE_RATE,'pricing_coverage_weighted':coverage,'missing_native_card_ids':len(set(missing_cards)),'sealed_price_captured_at':ref_at,'official_verification_status':verification.get('verification_status') if verification else None,'official_source_url':verification.get('official_source_url') if verification else None,'official_verified_at':verification.get('verified_at') if verification else None,'resolved_native_pack_count':booster_count,'container_distribution_rollup':product.get('category')=='booster_case'},
      'results':{'net_break_even_probability':st['net_be'],'fee_rate':FEE_RATE,'distribution_basis':'Monte Carlo from recursively resolved MTGJSON sealed children and native weighted booster layouts/sheets','analytical_expected_gross_ev':round(total_ev,4)}
    }
    created=sb('sealed_ev_backtests?select=backtest_id','POST',[payload],'return=representation') or []
    if not created:raise RuntimeError('Backtest insert returned no id')
    bid=created[0]['backtest_id']
    slot_rows=[]; pool_rows=[]
    for sheet_name,draws in expected_draws.items():
        sh=sheets.get(sheet_name)
        if not sh:continue
        slot_rows.append({'backtest_id':bid,'user_id':user_id,'slot_group':sheet_name,'draws_per_booster':draws,'pool_key':sheet_name,'probability':1,'finish':sh['finish'],'notes':'Expected draws from native weighted booster layouts','metadata':{'booster_code':booster_code,'native_layout_weighted':True}})
        for item in sh['items']:
            m=item['meta']; p=item['price']
            pool_rows.append({'backtest_id':bid,'user_id':user_id,'pool_key':sheet_name,'set_code':m.get('set_code') or product['set_code'],'collector_number':str(m.get('collector_number') or '?'),'card_name':m.get('name') or '(unknown)','rarity':m.get('rarity'),'finish':item['finish'],'tcgplayer_product_id':str(p.get('product_id') or m.get('tcgplayer_product_id') or '') or None,'market_value':item['value'] if p.get('market_price') is not None else None,'value_source':'tcgplayer_preferred_price_current_cache','metadata':{'native_weight':item['weight'],'native_sheet_total_weight':sh['total'],'booster_code':booster_code,'mtgjson_uuid':item['uuid']}})
    for rows,table in ((slot_rows,'sealed_ev_backtest_slots'),(pool_rows,'sealed_ev_backtest_pool_items')):
        for part in chunks(rows,150):sb(table,'POST',part,'return=minimal')
    officially_verified=bool(verification and verification.get('verification_status')=='verified')
    status='full' if officially_verified and coverage>=.98 and not missing_cards else 'partial'
    if product.get('category')=='booster_case':adapter='sealed_container_rollup_v1'
    elif booster_code=='collector-sample':adapter='collector_sample_mtgjson_v1'
    else:adapter=f'{booster_code}_booster_mtgjson_v1' if booster_code in ('draft','set') else 'collector_booster_mtgjson_v1'
    binding={'set_code':product['set_code'],'sealed_uuid':product['uuid'],'product_category':product['category'],'product_subtype':product['subtype'],'adapter_key':adapter,'model_version':'mtgjson-native-booster-v1','profile_status':status,'source_type':'wizards_official+mtgjson_native_booster' if officially_verified else 'mtgjson_native_booster','source_ref':verification.get('official_source_url') if officially_verified else f'{product["set_code"]}:{booster_code}','assumptions':{'pricing_coverage_weighted':coverage,'backtest_id':bid,'official_verification_status':verification.get('verification_status') if verification else 'missing','native_config_fingerprint':verification.get('config_fingerprint') if verification else None},'priority':5,'enabled':True,'updated_at':now()}
    sb('sealed_collation_profile_bindings','POST',[binding],'return=minimal')
    return {'backtest_id':bid,'product':product['name'],'booster_count':booster_count,'sealed_reference_price':ref,'gross_mean':round(st['mean'],2),'median':round(st['median'],2),'net_mean':round(st['net'],2),'pricing_coverage':round(coverage,5),'profile_status':status}

def run_set(set_code):
    user_id=get_user(set_code); configs=get_configs(set_code); products=get_products(set_code); verifications=get_verifications(set_code); outputs=[]
    products_by_uuid={str(p['uuid']):p for p in products}
    for booster_code in BOOSTER_CODES:
        config_row=configs.get(booster_code)
        if not config_row:continue
        cfg=config_row['booster_config']
        verification=verifications.get(booster_code)
        if verification and verification.get('config_fingerprint')!=config_row.get('config_fingerprint'):
            verification=dict(verification,verification_status='rejected')
        target=[p for p in products if str(p.get('subtype') or '').lower()==booster_code and p.get('category') in ('booster_pack','booster_box','booster_case')]
        packs=[p for p in target if p['category']=='booster_pack']
        if not packs:continue
        pack=packs[0]
        uuids=set()
        for sh in (cfg.get('sheets') or {}).values():uuids.update((sh.get('cards') or {}).keys())
        cards=get_cards(uuids); prices=get_prices(uuids)
        sheets,layouts,layout_cum,layout_total,expected_draws,expected_contrib,coverage,missing=build_native_model(set_code,booster_code,cfg,cards,prices)
        rng=random.Random(f'{set_code}|{booster_code}|mtgjson-native-v1')
        pack_vals=[simulate_pack(rng,sheets,layouts,layout_cum,layout_total) for _ in range(SAMPLES)]
        for p in target:
            bc=pack_count(p,pack['uuid'],products_by_uuid)
            if bc<=0:continue
            outputs.append(write_backtest(user_id,p,booster_code,bc,pack_vals,expected_draws,sheets,expected_contrib,coverage,missing,verification))
    try:sb('rpc/refresh_sealed_single_source_compare_current','POST',{'p_user_id':user_id},'return=minimal')
    except Exception as e:print(f'warning: compare refresh failed: {e}',flush=True)
    return outputs

def main():
    all_out=[]
    for code in SET_CODES:all_out.extend(run_set(code))
    print(json.dumps({'sets':SET_CODES,'samples':SAMPLES,'backtests':all_out},indent=2),flush=True)

if __name__=='__main__':main()
