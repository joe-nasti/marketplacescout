-- Propagate Signals through Scryfall Oracle identity anywhere Signals are joined
-- back to Scout. The underlying-card signal is contextual; exact-printing Scout
-- price, supply, velocity, grade, and execution remain printing/SKU specific.

create or replace function public.actionable_emerging_opportunities(p_limit integer default 80)
returns table(card_name text, product_id text, sku_id text, set_name text, printing text, base_scout_score integer, adjusted_scout_score integer, liquidity_score integer, liquidity_label text, target_roi_pct numeric, direct_roi_pct numeric, margin_cushion_pct numeric, cheapest_buy numeric, direct_net_est numeric, direct_net_profit numeric, direct_low numeric, market_price numeric, direct_available integer, signal_families integer, signal_count integer, signal_labels text, primary_signal text, signal_strength integer, actionability_score integer, action_class text, action_reason text)
language sql
set search_path to 'public'
as $function$
with liquid as (
  select l.*,c.edhrec_rank,c.product_name
  from public.liquid_scout_opportunities(250) l
  join public.scout_opportunities_v5_cache c on c.user_id=auth.uid() and c.sku_id=l.sku_id
), comp as (
  select lower(card_name) k, product_id, sku_id,'60-card competitive'::text family,
         case watch_class when 'adoption_breakout' then 'Competitive breakout' when 'standard_watch' then 'Standard watch' else 'Recent competitive card' end label,
         case watch_class when 'adoption_breakout' then 100 when 'standard_watch' then 86 else 72 end::int strength,watch_reason reason
  from public.competitive_financial_opportunities(null)
  where watch_class in ('adoption_breakout','standard_watch','recent_card')
), cedh as (
  select lower(card_name) k, product_id, sku_id,'cEDH'::text family,
         case watch_class when 'cedh_breakout' then 'cEDH breakout' else 'New / recent cEDH card' end label,
         case watch_class when 'cedh_breakout' then 96 else 76 end::int strength,
         case watch_class when 'cedh_breakout' then 'cEDH card adoption is increasing across imported structured tournament lists.' else 'A relatively new card is already seeing meaningful cEDH tournament adoption.' end reason
  from public.cedh_card_opportunities(90)
  where watch_class in ('cedh_breakout','cedh_recent_card')
), edh as (
  select lower(l.card_name) k,l.product_id,l.sku_id,'EDHREC'::text family,'EDH breakout'::text label,
         least(100,greatest(0,70+round(((b.edhrec_rank-l.edhrec_rank)::numeric/nullif(b.edhrec_rank,0)*100)/4.0)))::int strength,
         'EDHREC rank improved materially across the available history while this liquid Scout printing remains actionable.'::text reason
  from liquid l
  join lateral (
    select r.edhrec_rank,r.edhrec_observed_at from public.marketplace_scan_rows r
    where r.user_id=auth.uid() and r.product_name=l.product_name and r.edhrec_observed_at is not null and r.edhrec_rank is not null and r.edhrec_observed_at>=now()-interval '8 days'
    order by r.edhrec_observed_at asc,r.id asc limit 1
  ) b on true
  where l.edhrec_rank is not null and l.edhrec_rank<=10000 and b.edhrec_rank>0 and b.edhrec_observed_at<=now()-interval '3 days'
    and ((b.edhrec_rank-l.edhrec_rank)::numeric/b.edhrec_rank*100)>=20
), intel as (
  select lower(max(l.canonical_name)) k,l.product_id,null::text sku_id,'articles/social'::text family,
         case max(case i.signal_stage when 'leading' then 3 when 'confirming' then 2 else 0 end) when 3 then 'Leading article/social signal' else 'Confirming article/social signal' end label,
         least(100,greatest(0,round(55+max(coalesce(i.confidence,0.5))*35+case max(case i.signal_stage when 'leading' then 3 when 'confirming' then 2 else 0 end) when 3 then 10 else 0 end)))::int strength,
         'Recent bullish article/social intelligence is attached to the underlying Oracle card.'::text reason
  from public.market_intel_scout_signal_links l
  join public.market_intel_items i on i.intel_id=l.intel_id and i.user_id=l.user_id
  where l.user_id=auth.uid() and l.product_id is not null and coalesce(i.direction,'neutral')='bullish'
    and i.signal_stage in ('leading','confirming') and i.observed_at>=now()-interval '30 days'
  group by l.product_id
), signals as (
  select * from comp union all select * from edh union all select * from cedh union all select * from intel
), matched as (
  select l.*,s.family,s.label,s.strength,s.reason,row_number() over(partition by l.sku_id,s.family order by s.strength desc) family_rn
  from liquid l
  join signals s on (s.product_id is not null and s.product_id=l.product_id) or (s.product_id is null and s.k=lower(l.card_name))
), agg as (
  select sku_id,count(*) filter(where family_rn=1)::int signal_families,count(*)::int signal_count,
         string_agg(label,' · ' order by strength desc) filter(where family_rn=1) signal_labels,
         (array_agg(label order by strength desc))[1] primary_signal,max(strength)::int signal_strength,
         (array_agg(reason order by strength desc))[1] primary_reason
  from matched group by sku_id
), final as (
  select l.*,a.signal_families,a.signal_count,a.signal_labels,a.primary_signal,a.signal_strength,a.primary_reason,
         least(100,round(l.adjusted_scout_score*0.55+a.signal_strength*0.25+least(10,a.signal_families*4)+least(10,greatest(0,l.margin_cushion_pct)/10)))::int actionability,
         case when a.signal_families>=2 and l.quick_turn_class='priority_quick_turn' then 'action_now'
              when a.signal_strength>=90 and l.quick_turn_class='priority_quick_turn' then 'action_now'
              when l.quick_turn_class in ('priority_quick_turn','quick_turn') then 'emerging_quick_turn' else 'liquid_signal_watch' end action_class_calc
  from liquid l join agg a on a.sku_id=l.sku_id
)
select card_name,product_id,sku_id,set_name,printing,base_scout_score,adjusted_scout_score,liquidity_score,liquidity_label,target_roi_pct,direct_roi_pct,margin_cushion_pct,
       cheapest_buy,direct_net_est,direct_net_profit,direct_low,market_price,direct_available,signal_families,signal_count,signal_labels,primary_signal,signal_strength,actionability,action_class_calc,
       case action_class_calc when 'action_now' then primary_reason||' The selected printing is liquid and its estimated Direct ROI clears the velocity-adjusted target with room to spare.'
            when 'emerging_quick_turn' then primary_reason||' The trade currently clears its liquidity-adjusted margin hurdle.'
            else primary_reason||' Liquidity is favorable, but the execution setup is less compelling than the top quick-turn candidates.' end
from final
order by case action_class_calc when 'action_now' then 0 when 'emerging_quick_turn' then 1 else 2 end,actionability desc,signal_families desc,margin_cushion_pct desc
limit greatest(1,least(coalesce(p_limit,80),200));
$function$;

create or replace function public.cross_source_market_watches(p_limit integer default 60)
returns table(card_name text, product_id text, sku_id text, set_name text, printing text, market_price numeric, direct_low numeric, direct_available integer, opportunity_score integer, evidence_sources integer, dynamic_sources integer, competitive_formats text, competitive_decks bigint, competitive_top8 bigint, competitive_stage text, edhrec_rank integer, edh_watch_class text, edh_rank_improvement_pct numeric, cedh_decks bigint, cedh_share_pct numeric, cedh_watch_class text, intel_items bigint, intel_sources bigint, intel_stage text, corroboration_score integer, watch_class text, watch_reason text)
language sql
set search_path to 'public'
as $function$
with comp_raw as (
  select * from public.competitive_scout_opportunities(null) where lower(coalesce(format,'')) <> 'cedh'
), comp as (
  select lower(card_name) k,min(card_name) card_name,string_agg(distinct format,', ' order by format) formats,
         sum(deck_count_30d)::bigint decks,sum(top8_decks_30d)::bigint top8s,
         max(case competitive_stage when 'early' then 3 when 'confirming' then 2 when 'late' then 1 else 0 end) stage_rank
  from comp_raw where deck_count_30d>0 group by lower(card_name)
), edh_raw as (select * from public.commander_edh_opportunities(200)),
edh as (
  select distinct on (lower(card_name)) lower(card_name) k,card_name,edhrec_rank,watch_class,rank_improvement_pct,commander_priority
  from edh_raw order by lower(card_name),commander_priority desc nulls last
), cedh_raw as (select * from public.cedh_card_opportunities(90)),
cedh as (
  select distinct on (lower(card_name)) lower(card_name) k,card_name,deck_count_30d,share_30d_pct,watch_class,cedh_card_priority
  from cedh_raw order by lower(card_name),cedh_card_priority desc nulls last
), intel as (
  select lower(max(l.canonical_name)) k,l.product_id,min(l.canonical_name) card_name,
         count(distinct i.intel_id)::bigint intel_items,count(distinct coalesce(nullif(i.source_name,''),i.source_type))::bigint intel_sources,
         max(case i.signal_stage when 'leading' then 3 when 'confirming' then 2 when 'lagging' then 1 else 0 end) stage_rank
  from public.market_intel_scout_signal_links l
  join public.market_intel_items i on i.intel_id=l.intel_id and i.user_id=l.user_id
  where l.user_id=auth.uid() and l.product_id is not null and coalesce(i.direction,'neutral')='bullish' and i.observed_at>=now()-interval '90 days'
  group by l.product_id
), keys as (
  select k from comp union select k from edh union select k from cedh union select k from intel
), evidence as (
  select k.k,coalesce(c.card_name,e.card_name,cd.card_name,min(i.card_name)) card_name,
         min(i.product_id) intel_product_id,c.formats,c.decks competitive_decks,c.top8s competitive_top8,c.stage_rank comp_stage_rank,
         e.edhrec_rank,e.watch_class edh_watch_class,e.rank_improvement_pct,cd.deck_count_30d cedh_decks,cd.share_30d_pct cedh_share_pct,cd.watch_class cedh_watch_class,
         max(i.intel_items) intel_items,max(i.intel_sources) intel_sources,max(i.stage_rank) intel_stage_rank,
         ((c.k is not null)::int+(e.k is not null)::int+(cd.k is not null)::int+(count(i.product_id)>0)::int)::int evidence_sources,
         ((coalesce(c.stage_rank,0)>=2)::int+(e.watch_class='edh_breakout')::int+(cd.watch_class in ('cedh_breakout','cedh_recent_card'))::int+(coalesce(max(i.stage_rank),0)>=2)::int)::int dynamic_sources
  from keys k left join comp c on c.k=k.k left join edh e on e.k=k.k left join cedh cd on cd.k=k.k left join intel i on i.k=k.k
  group by k.k,c.card_name,e.card_name,cd.card_name,c.formats,c.decks,c.top8s,c.stage_rank,e.edhrec_rank,e.watch_class,e.rank_improvement_pct,cd.deck_count_30d,cd.share_30d_pct,cd.watch_class
), market as (
  select ev.*,s.product_id,s.sku_id,s.set_name,s.printing,s.sku_market_price,s.direct_low,s.direct_available,s.opportunity_score,
         row_number() over(partition by ev.k order by case when ev.intel_product_id is not null and s.product_id=ev.intel_product_id then 0 else 1 end,
           case when lower(coalesce(s.condition,''))='near mint' then 0 else 1 end,case when lower(coalesce(s.language,''))='english' then 0 else 1 end,
           case when lower(coalesce(s.printing,''))='normal' then 0 else 1 end,s.opportunity_score desc nulls last,s.direct_available asc nulls last) rn
  from evidence ev join public.scout_opportunities_v5_cache s on s.user_id=auth.uid()
    and ((ev.intel_product_id is not null and s.product_id=ev.intel_product_id) or lower(s.product_name)=ev.k)
), chosen as (select * from market where rn=1),
scored as (
  select *,least(100,greatest(0,round(evidence_sources*18+dynamic_sources*7+coalesce(opportunity_score,0)*0.20
    +case when direct_available<=5 then 10 when direct_available<=20 then 6 when direct_available<=50 then 3 else 0 end
    +case when direct_low>0 and sku_market_price>0 and direct_low>=sku_market_price*1.20 then 5 else 0 end+least(5,coalesce(intel_sources,0)))))::integer corroboration_score
  from chosen where evidence_sources>=2
), final as (
  select *,case when evidence_sources>=3 and dynamic_sources>=2 then 'cross_source_breakout' when evidence_sources>=3 then 'high_conviction_watch'
                 when dynamic_sources>=2 then 'corroborated_breakout' else 'corroborated_setup' end watch_class,
    concat_ws(' · ',case when competitive_decks is not null then '60-card competitive' end,case when edhrec_rank is not null then 'EDHREC' end,
      case when cedh_decks is not null then 'cEDH' end,case when intel_items is not null then 'articles/social' end)
      ||case when dynamic_sources>0 then ' · '||dynamic_sources||' dynamic signal'||case when dynamic_sources=1 then '' else 's' end else '' end watch_reason
  from scored
)
select card_name,product_id,sku_id,set_name,printing,sku_market_price,direct_low,direct_available,opportunity_score,evidence_sources,dynamic_sources,formats,competitive_decks,competitive_top8,
       case comp_stage_rank when 3 then 'early' when 2 then 'confirming' when 1 then 'late' else null end,edhrec_rank,edh_watch_class,rank_improvement_pct,cedh_decks,cedh_share_pct,cedh_watch_class,
       intel_items,intel_sources,case intel_stage_rank when 3 then 'leading' when 2 then 'confirming' when 1 then 'lagging' else null end,corroboration_score,watch_class,watch_reason
from final order by corroboration_score desc,evidence_sources desc,dynamic_sources desc,opportunity_score desc
limit greatest(1,least(coalesce(p_limit,60),200));
$function$;

create or replace function public.ask_collectish_market_timeline_v1(p_product_id text default null::text,p_sku_id text default null::text,p_days integer default 120)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare s record; ev jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  p_days := greatest(30,least(coalesce(p_days,120),365));
  select * into s from public.scout_opportunities_v5 x
  where x.user_id=auth.uid() and (p_sku_id is null or x.sku_id=p_sku_id) and (p_product_id is null or x.product_id=p_product_id)
  order by x.latest_scan_at desc nulls last limit 1;
  if s.sku_id is null then return jsonb_build_object('available',false,'reason','No current Scout card matched the supplied identifiers.'); end if;
  with raw_daily as (
    select distinct on (sc.captured_at::date) sc.captured_at::date day,sc.captured_at,r.sku_market_price,r.direct_available,r.direct_listings,r.edhrec_rank
    from public.marketplace_scan_rows r join public.marketplace_scans sc on sc.scan_id=r.scan_id and sc.user_id=r.user_id
    where r.user_id=auth.uid() and r.sku_id=s.sku_id and sc.captured_at>=now()-make_interval(days=>p_days)
    order by sc.captured_at::date,sc.captured_at desc
  ), daily as (
    select *,lag(sku_market_price) over(order by day) prev_market,lag(direct_available) over(order by day) prev_supply,lag(edhrec_rank) over(order by day) prev_edhrec from raw_daily
  ), price_events as (
    select day::timestamptz event_at,'price'::text kind,'Market repriced'::text title,
      format('Market $%s → $%s (%s%s%%)',round(prev_market,2),round(sku_market_price,2),case when sku_market_price>=prev_market then '+' else '' end,round(((sku_market_price-prev_market)/nullif(prev_market,0))*100,1)) detail,
      abs(((sku_market_price-prev_market)/nullif(prev_market,0))*100)::numeric significance,
      jsonb_build_object('from',prev_market,'to',sku_market_price,'change_pct',round(((sku_market_price-prev_market)/nullif(prev_market,0))*100,1)) data
    from daily where prev_market>0 and sku_market_price>0 and abs((sku_market_price-prev_market)/prev_market)>=0.05
  ), supply_events as (
    select day::timestamptz event_at,'supply'::text kind,case when direct_available<prev_supply then 'Direct supply contracted' else 'Direct supply expanded' end title,
      format('Direct available %s → %s (%s%s%%)',prev_supply,direct_available,case when direct_available>=prev_supply then '+' else '' end,round(((direct_available-prev_supply)::numeric/nullif(prev_supply,0))*100,1)) detail,
      abs(((direct_available-prev_supply)::numeric/nullif(prev_supply,0))*100)::numeric significance,
      jsonb_build_object('from',prev_supply,'to',direct_available,'change_pct',round(((direct_available-prev_supply)::numeric/nullif(prev_supply,0))*100,1),'listings',direct_listings) data
    from daily where prev_supply is not null and prev_supply>0 and direct_available is not null and abs(direct_available-prev_supply)>=5 and abs((direct_available-prev_supply)::numeric/prev_supply)>=0.15
  ), edh_events as (
    select day::timestamptz event_at,'edhrec'::text kind,case when edhrec_rank<prev_edhrec then 'EDHREC rank improved' else 'EDHREC rank weakened' end title,
      format('EDHREC #%s → #%s (%s%% %s)',prev_edhrec,edhrec_rank,round((abs(edhrec_rank-prev_edhrec)::numeric/nullif(prev_edhrec,0))*100,1),case when edhrec_rank<prev_edhrec then 'improvement' else 'decline' end) detail,
      (abs(edhrec_rank-prev_edhrec)::numeric/nullif(prev_edhrec,0))*100 significance,
      jsonb_build_object('from',prev_edhrec,'to',edhrec_rank,'improvement_pct',round(((prev_edhrec-edhrec_rank)::numeric/nullif(prev_edhrec,0))*100,1)) data
    from daily where prev_edhrec is not null and prev_edhrec>0 and edhrec_rank is not null and edhrec_rank>0 and (abs(edhrec_rank-prev_edhrec)>=250 or abs(edhrec_rank-prev_edhrec)::numeric/prev_edhrec>=0.15)
  ), sales_base as (
    select bucket_start_date,quantity_sold,transaction_count,market_price,low_sale_price,high_sale_price,avg(quantity_sold) over() avg_qty
    from public.marketplace_sku_sales_buckets where user_id=auth.uid() and sku_id=s.sku_id and bucket_start_date>=current_date-p_days
  ), sales_events as (
    select bucket_start_date::timestamptz event_at,'sales'::text kind,'Sales volume spike'::text title,
      format('%s units / %s transactions; market $%s',quantity_sold,transaction_count,coalesce(round(market_price,2),0)) detail,
      (quantity_sold::numeric/nullif(avg_qty,0))*10 significance,jsonb_build_object('units',quantity_sold,'transactions',transaction_count,'market',market_price,'low_sale',low_sale_price,'high_sale',high_sale_price) data
    from sales_base where quantity_sold>=greatest(15,ceil(coalesce(avg_qty,0)*1.4))
  ), signal_events as (
    select coalesce(i.published_at,i.observed_at,i.created_at) event_at,'signal'::text kind,coalesce(nullif(i.title,''),'Collectish Signal') title,
      concat_ws(' · ',nullif(i.source_name,''),nullif(i.direction,''),nullif(i.signal_stage,''),case when l.family_match then 'underlying-card family' end) detail,
      coalesce(i.confidence,0.5)*20 significance,
      jsonb_build_object('source_name',i.source_name,'source_url',i.source_url,'direction',i.direction,'signal_stage',i.signal_stage,'confidence',i.confidence,'summary',i.summary,'oracle_family_match',l.family_match,'canonical_name',l.canonical_name) data
    from public.market_intel_items i
    join public.market_intel_scout_signal_links l on l.intel_id=i.intel_id and l.user_id=i.user_id and l.product_id=s.product_id
    where i.user_id=auth.uid() and coalesce(i.published_at,i.observed_at,i.created_at)>=now()-make_interval(days=>p_days)
  ), all_events as (
    select * from price_events union all select * from supply_events union all select * from edh_events union all select * from sales_events union all select * from signal_events
  ), chosen as (select * from all_events order by significance desc nulls last,event_at desc limit 36)
  select coalesce(jsonb_agg(jsonb_build_object('event_at',event_at,'kind',kind,'title',title,'detail',detail,'significance',round(significance,1),'data',data) order by event_at),'[]'::jsonb) into ev from chosen;
  return jsonb_build_object('available',true,'version','v1.1-oracle-family','days',p_days,'card',jsonb_build_object('product_id',s.product_id,'sku_id',s.sku_id,'product_name',s.product_name,'set_name',s.set_name),'events',coalesce(ev,'[]'::jsonb),'event_count',jsonb_array_length(coalesce(ev,'[]'::jsonb)),'generated_at',now());
end
$function$;

create or replace function public.ask_collectish_market_investigation_v3(p_product_id text default null::text,p_sku_id text default null::text)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare s record; sales jsonb := '{}'::jsonb; supply jsonb := '{}'::jsonb; edh jsonb := '{}'::jsonb; roll jsonb := '{}'::jsonb; claims jsonb := '[]'::jsonb; scry text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into s from public.scout_opportunities_v5 x where x.user_id=auth.uid() and (p_sku_id is null or x.sku_id=p_sku_id) and (p_product_id is null or x.product_id=p_product_id) order by x.latest_scan_at desc nulls last limit 1;
  if s.sku_id is null then return jsonb_build_object('available',false,'reason','No exact current Scout card matched the supplied identifiers.'); end if;
  scry:=s.scryfall_id::text;
  begin
    with b as (select bucket_start_date,market_price,low_sale_price,high_sale_price,quantity_sold,transaction_count,observed_at from public.marketplace_sku_sales_buckets where user_id=auth.uid() and sku_id=s.sku_id and bucket_start_date>=current_date-90 order by bucket_start_date),
    a as (select count(*) buckets,coalesce(sum(quantity_sold),0) units,coalesce(sum(transaction_count),0) transactions,min(bucket_start_date) from_date,max(bucket_start_date) to_date,min(nullif(low_sale_price,0)) low_sold,max(high_sale_price) high_sold,min(market_price) market_low,max(market_price) market_high,max(observed_at) observed_at from b)
    select jsonb_build_object('scope','exact_sku','sku_id',s.sku_id,'summary',to_jsonb(a),'buckets',coalesce((select jsonb_agg(to_jsonb(b) order by bucket_start_date) from b),'[]'::jsonb)) into sales from a;
  exception when others then sales:=jsonb_build_object('available',false,'error','sales unavailable'); end;
  begin
    with h as (select sc.captured_at,r.direct_low,r.direct_available,r.direct_listings,r.supply_type from public.marketplace_scan_rows r join public.marketplace_scans sc on sc.scan_id=r.scan_id and sc.user_id=r.user_id where r.user_id=auth.uid() and r.sku_id=s.sku_id and sc.captured_at>=now()-interval '90 days' order by sc.captured_at limit 240)
    select jsonb_build_object('scope','exact_sku','count',count(*),'observations',coalesce(jsonb_agg(to_jsonb(h) order by captured_at),'[]'::jsonb),'current',coalesce((select to_jsonb(z) from h z order by captured_at desc limit 1),'{}'::jsonb)) into supply from h;
  exception when others then supply:=jsonb_build_object('available',false,'error','supply history unavailable','current',jsonb_build_object('direct_low',s.direct_low,'direct_available',s.direct_available,'direct_listings',s.direct_listings,'supply_type',s.supply_type)); end;
  begin edh:=public.ask_collectish_shared_edhrec(s.product_id,scry); exception when others then edh:=jsonb_build_object('available',s.edhrec_rank is not null,'edhrec_rank',s.edhrec_rank,'source','scout'); end;
  begin
    select to_jsonb(r) into roll from public.market_intel_entity_rollups_with_edhrec r
    where r.user_id=auth.uid() and (r.product_id=s.product_id or (scry is not null and r.scryfall_id::text=scry)) order by r.latest_observed_at desc nulls last limit 1;
    if roll is null then
      with ids as (select distinct l.intel_id,l.canonical_name,l.oracle_id from public.market_intel_scout_signal_links l where l.user_id=auth.uid() and l.product_id=s.product_id),
      a as (select count(*)::int claim_count,count(distinct i.source_url)::int independent_source_count,count(*) filter(where i.direction='bullish')::int bullish_claims,count(*) filter(where i.direction='bearish')::int bearish_claims,max(i.observed_at) latest_observed_at,max(coalesce(i.published_at,i.observed_at)) latest_source_at,max(ids.canonical_name) canonical_name,max(ids.oracle_id)::text oracle_id from ids join public.market_intel_items i on i.intel_id=ids.intel_id and i.user_id=auth.uid())
      select case when claim_count>0 then jsonb_build_object('entity_key','oracle:'||oracle_id,'entity_name',canonical_name,'scryfall_id',scry,'product_id',s.product_id,'claim_count',claim_count,'independent_source_count',independent_source_count,'bullish_claims',bullish_claims,'bearish_claims',bearish_claims,'latest_observed_at',latest_observed_at,'latest_source_at',latest_source_at,'oracle_family_context',true) else '{}'::jsonb end into roll from a;
    end if;
  exception when others then roll:='{}'::jsonb; end;
  begin
    with ids as (select distinct l.intel_id from public.market_intel_scout_signal_links l where l.user_id=auth.uid() and l.product_id=s.product_id),
    c as (select i.intel_id,i.source_type,i.source_name,i.source_url,i.title,i.author,i.summary,i.direction,i.signal_stage,i.confidence,i.published_at,i.observed_at from public.market_intel_items i join ids on ids.intel_id=i.intel_id where i.user_id=auth.uid() order by i.observed_at desc nulls last limit 12)
    select coalesce(jsonb_agg(to_jsonb(c) order by observed_at desc),'[]'::jsonb) into claims from c;
  exception when others then claims:='[]'::jsonb; end;
  return jsonb_build_object('available',true,'card',jsonb_build_object('sku_id',s.sku_id,'product_id',s.product_id,'product_name',s.product_name,'set_name',s.set_name,'printing',s.printing,'condition',s.condition,'language',s.language),
    'scout',to_jsonb(s),'shared_sales',coalesce(sales,'{}'::jsonb),'exact_supply',coalesce(supply,'{}'::jsonb),'edhrec_current',coalesce(edh,'{}'::jsonb),
    'edhrec_history',jsonb_build_object('count',case when coalesce((edh->>'available')::boolean,false) then 1 else 0 end,'source',edh->>'source','observations',case when coalesce((edh->>'available')::boolean,false) then jsonb_build_array(jsonb_build_object('captured_at',edh->>'observed_at','edhrec_rank',nullif(edh->>'edhrec_rank','')::int)) else '[]'::jsonb end),
    'market_intelligence',jsonb_build_object('rollup',coalesce(roll,'{}'::jsonb),'claims',coalesce(claims,'[]'::jsonb),'fresh_claims_7d',coalesce((select count(*) from jsonb_array_elements(coalesce(claims,'[]'::jsonb)) x where nullif(x->>'observed_at','')::timestamptz>=now()-interval '7 days'),0),'identity_scope','oracle_family'),
    'investigation_version','v3.1-oracle-family','snapshot_at',now());
end
$function$;
