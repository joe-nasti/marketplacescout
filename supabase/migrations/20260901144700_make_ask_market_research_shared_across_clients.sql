create or replace function public.ask_collectish_market_investigation_v3(p_product_id text default null, p_sku_id text default null)
returns jsonb
language plpgsql
stable security definer
set search_path=public
as $$
declare e record; h jsonb; v_sku text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_sku_id is null then return jsonb_build_object('available',false,'reason','exact sku required for shared market investigation'); end if;
  select * into e from public.ask_collectish_public_internal_sku_evidence_v1(array[p_sku_id]) limit 1;
  if e.sku_id is null then return jsonb_build_object('available',false,'reason','shared sku evidence unavailable'); end if;
  v_sku:=e.sku_id;
  h:=public.ask_card_price_history_v1(nullif(coalesce(e.product_id,p_product_id),'')::bigint,v_sku::bigint,90);
  return jsonb_build_object(
    'available',true,
    'card',jsonb_build_object('sku_id',v_sku,'product_id',e.product_id,'product_name',e.card_name,'set_name',e.set_code,'printing',e.printing,'condition',e.condition,'language',e.language),
    'scout',jsonb_build_object('sku_id',v_sku,'product_id',e.product_id,'product_name',e.card_name,'set_code',e.set_code,'printing',e.printing,'condition',e.condition,'language',e.language,'promoted_score',e.scout_score,'promoted_grade',e.scout_grade,'sku_market_price',e.market_price,'direct_low',e.direct_low,'direct_available',e.direct_available,'direct_listings',e.direct_listings,'avg_daily_qty_sold',e.avg_daily_qty_sold,'sales_rank',e.sales_rank,'supply_type',e.supply_type,'edhrec_rank',e.edhrec_rank,'demand_signal',e.demand_signal,'demand_signal_score',e.demand_signal_score,'buylist_backed',e.buylist_backed,'ck_buylist',e.ck_buylist),
    'shared_sales',jsonb_build_object('summary',jsonb_build_object('units',e.sales_qty_14d,'transactions',e.sales_tx_14d,'window_days',14)),
    'exact_supply',jsonb_build_object('scope','exact_sku','current',jsonb_build_object('direct_low',e.direct_low,'direct_available',e.direct_available,'direct_listings',e.direct_listings,'supply_type',e.supply_type)),
    'edhrec_current',jsonb_build_object('available',e.edhrec_rank is not null,'edhrec_rank',e.edhrec_rank,'source','shared_public_evidence'),
    'edhrec_history',jsonb_build_object('count',0,'source','shared_public_evidence','observations','[]'::jsonb),
    'market_intelligence',jsonb_build_object('rollup',jsonb_build_object('claim_count',e.signal_count_14d,'independent_source_count',e.independent_sources_14d),'claims','[]'::jsonb,'fresh_claims_7d',0),
    'price_history',coalesce(h,'{}'::jsonb),
    'investigation_version','v4_shared_market','identity_source','shared_public_internal_sku_evidence','snapshot_at',now());
end $$;
revoke all on function public.ask_collectish_market_investigation_v3(text,text) from public;
grant execute on function public.ask_collectish_market_investigation_v3(text,text) to authenticated,service_role;

create or replace function public.ask_collectish_market_timeline_v1(p_product_id text default null,p_sku_id text default null,p_days integer default 120)
returns jsonb
language plpgsql
stable security definer
set search_path=public
as $$
declare h jsonb; card jsonb; ev jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  p_days:=greatest(30,least(coalesce(p_days,120),365));
  h:=public.ask_card_price_history_v1(nullif(p_product_id,'')::bigint,nullif(p_sku_id,'')::bigint,p_days);
  if not coalesce((h->>'available')::boolean,false) then return jsonb_build_object('available',false,'reason','shared exact-sku history unavailable'); end if;
  card:=coalesce(h->'card','{}'::jsonb);
  with p as (
    select (x->>'observed_at')::timestamptz observed_at,(x->>'market_price')::numeric market_price,
           lag((x->>'market_price')::numeric) over(order by (x->>'observed_at')::timestamptz) prev_market
    from jsonb_array_elements(coalesce(h->'price_points','[]'::jsonb)) x
    where nullif(x->>'observed_at','') is not null and nullif(x->>'market_price','') is not null
  ), moved as (
    select observed_at,'price'::text kind,'Market repriced'::text title,
      format('Market $%s → $%s (%s%s%%)',round(prev_market,2),round(market_price,2),case when market_price>=prev_market then '+' else '' end,round(((market_price-prev_market)/nullif(prev_market,0))*100,1)) detail,
      abs(((market_price-prev_market)/nullif(prev_market,0))*100)::numeric significance,
      jsonb_build_object('from',prev_market,'to',market_price,'change_pct',round(((market_price-prev_market)/nullif(prev_market,0))*100,1),'source','tcgplayer_official_sku_price_history') data
    from p where prev_market>0 and market_price>0 and abs((market_price-prev_market)/prev_market)>=0.05
  )
  select coalesce(jsonb_agg(jsonb_build_object('event_at',observed_at,'kind',kind,'title',title,'detail',detail,'significance',round(significance,1),'data',data) order by observed_at),'[]'::jsonb) into ev from moved;
  return jsonb_build_object('available',true,'version','v2_shared_official_history','days',p_days,
    'card',jsonb_build_object('product_id',card->>'product_id','sku_id',card->>'sku_id','product_name',card->>'card_name','set_name',card->>'set_code'),
    'events',coalesce(ev,'[]'::jsonb),'event_count',jsonb_array_length(coalesce(ev,'[]'::jsonb)),'identity_source','ask_card_price_history_v1','generated_at',now());
end $$;
revoke all on function public.ask_collectish_market_timeline_v1(text,text,integer) from public;
grant execute on function public.ask_collectish_market_timeline_v1(text,text,integer) to authenticated,service_role;
