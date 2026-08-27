-- Creator-video market response snapshots.
-- T0 is captured once per video/card Signal; follow-ups are captured at +6h/+24h/+3d/+7d/+30d.
-- Prices are Oracle-family level using linked TCGplayer product ids, preferring normal finish when available.

create table if not exists public.market_intel_market_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  intel_id uuid not null,
  user_id uuid not null,
  oracle_id uuid,
  card_name text not null,
  horizon text not null check (horizon in ('t0','h6','h24','d3','d7','d30','adhoc')),
  target_at timestamptz not null,
  captured_at timestamptz not null default now(),
  printing_count integer not null default 0,
  product_count integer not null default 0,
  direct_low numeric,
  market_price numeric,
  tcg_low numeric,
  low_with_shipping numeric,
  direct_available integer,
  direct_listings integer,
  avg_daily_qty_sold numeric,
  scout_score numeric,
  raw_metrics jsonb not null default '{}'::jsonb,
  constraint market_intel_market_snapshots_item_fkey foreign key (intel_id,user_id)
    references public.market_intel_items(intel_id,user_id) on delete cascade,
  constraint market_intel_market_snapshots_unique unique (intel_id,user_id,horizon)
);

create index if not exists market_intel_market_snapshots_user_oracle_idx
  on public.market_intel_market_snapshots(user_id,oracle_id,captured_at desc);
create index if not exists market_intel_market_snapshots_target_idx
  on public.market_intel_market_snapshots(target_at,captured_at);

alter table public.market_intel_market_snapshots enable row level security;
drop policy if exists market_intel_market_snapshots_own on public.market_intel_market_snapshots;
create policy market_intel_market_snapshots_own on public.market_intel_market_snapshots
for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update,delete on public.market_intel_market_snapshots to authenticated;
grant all on public.market_intel_market_snapshots to service_role;
revoke all on public.market_intel_market_snapshots from anon;

create or replace function public.capture_due_market_intel_snapshots(p_limit integer default 100)
returns table(intel_id uuid,horizon text,captured_at timestamptz)
language plpgsql
security invoker
set search_path=public
as $$
declare
  r record;
  v_t0 timestamptz; v_target timestamptz; v_horizon text; v_delta interval;
  v_oracle uuid; v_card text; v_printing_count integer; v_product_count integer;
  v_direct_low numeric; v_market_price numeric; v_tcg_low numeric;
  v_direct_available integer; v_direct_listings integer; v_avg_daily_qty numeric; v_scout_score numeric;
  v_count integer:=0;
begin
  for r in
    select distinct i.intel_id,i.user_id,e.entity_name
    from public.market_intel_items i
    join public.market_intel_entities e on e.intel_id=i.intel_id and e.user_id=i.user_id and e.entity_type='card'
    join public.market_intel_video_events ve on ve.intel_id=i.intel_id and ve.user_id=i.user_id
    where i.source_type='youtube' order by i.intel_id
  loop
    exit when v_count>=greatest(1,least(coalesce(p_limit,100),500));
    select min(l.oracle_id::text)::uuid into v_oracle from public.market_intel_scout_signal_links l
      where l.intel_id=r.intel_id and l.user_id=r.user_id and l.oracle_id is not null;
    v_card:=r.entity_name;
    select s.captured_at into v_t0 from public.market_intel_market_snapshots s
      where s.intel_id=r.intel_id and s.user_id=r.user_id and s.horizon='t0' limit 1;
    if v_t0 is null then
      v_horizon:='t0'; v_delta:=interval '0 hours'; v_target:=now();
    else
      select q.horizon,q.delta into v_horizon,v_delta
      from (values ('h6'::text,interval '6 hours'),('h24',interval '24 hours'),('d3',interval '3 days'),('d7',interval '7 days'),('d30',interval '30 days')) q(horizon,delta)
      where now()>=v_t0+q.delta
        and not exists(select 1 from public.market_intel_market_snapshots s where s.intel_id=r.intel_id and s.user_id=r.user_id and s.horizon=q.horizon)
      order by q.delta limit 1;
      if v_horizon is null then continue; end if;
      v_target:=v_t0+v_delta;
    end if;

    with products as (
      select distinct nullif(l.product_id,'')::bigint product_id
      from public.market_intel_scout_signal_links l
      where l.intel_id=r.intel_id and l.user_id=r.user_id and l.product_id~'^[0-9]+$'
    ), prices as (
      select coalesce(min(p.direct_low_price) filter(where p.finish='normal' and p.direct_low_price>0),min(p.direct_low_price) filter(where p.direct_low_price>0)) direct_low,
             coalesce(min(p.market_price) filter(where p.finish='normal' and p.market_price>0),min(p.market_price) filter(where p.market_price>0)) market_price,
             coalesce(min(p.low_price) filter(where p.finish='normal' and p.low_price>0),min(p.low_price) filter(where p.low_price>0)) tcg_low,
             count(distinct p.product_id)::integer product_count,count(*)::integer printing_count
      from public.tcgplayer_preferred_price_current_cache p join products x on x.product_id=p.product_id
    ), scout as (
      select sum(coalesce(s.direct_available,0))::integer direct_available,
             sum(coalesce(s.direct_listings,0))::integer direct_listings,
             sum(coalesce(s.avg_daily_qty_sold,0))::numeric avg_daily_qty,
             max(s.opportunity_score)::numeric scout_score
      from public.scout_opportunities_v5 s join products x on x.product_id::text=s.product_id
      where lower(coalesce(s.condition,'')) in ('near mint','near-mint','nm') and lower(coalesce(s.language,''))='english'
    ), sales as (
      select sum(coalesce(n.average_daily_quantity_sold,0))::numeric avg_daily_qty
      from public.marketplace_signal_nm_sales_current n where n.user_id=r.user_id and lower(n.card_name)=lower(v_card)
    )
    select coalesce(pr.printing_count,0),coalesce(pr.product_count,0),pr.direct_low,pr.market_price,pr.tcg_low,
           sc.direct_available,sc.direct_listings,coalesce(sc.avg_daily_qty,sa.avg_daily_qty),sc.scout_score
      into v_printing_count,v_product_count,v_direct_low,v_market_price,v_tcg_low,v_direct_available,v_direct_listings,v_avg_daily_qty,v_scout_score
    from prices pr cross join scout sc cross join sales sa;

    insert into public.market_intel_market_snapshots(intel_id,user_id,oracle_id,card_name,horizon,target_at,captured_at,printing_count,product_count,direct_low,market_price,tcg_low,low_with_shipping,direct_available,direct_listings,avg_daily_qty_sold,scout_score,raw_metrics)
    values(r.intel_id,r.user_id,v_oracle,v_card,v_horizon,v_target,now(),coalesce(v_printing_count,0),coalesce(v_product_count,0),v_direct_low,v_market_price,v_tcg_low,null,v_direct_available,v_direct_listings,v_avg_daily_qty,v_scout_score,
      jsonb_build_object('oracle_level',true,'price_source','tcgplayer_preferred_price_current_cache','scout_source','scout_opportunities_v5','sales_source','marketplace_signal_nm_sales_current'))
    on conflict on constraint market_intel_market_snapshots_unique do nothing;
    if found then
      v_count:=v_count+1; intel_id:=r.intel_id; horizon:=v_horizon; captured_at:=now(); return next;
    end if;
    v_horizon:=null; v_delta:=null;
  end loop;
end;
$$;
revoke all on function public.capture_due_market_intel_snapshots(integer) from public,anon,authenticated;
grant execute on function public.capture_due_market_intel_snapshots(integer) to service_role;

create or replace view public.market_intel_video_market_response with (security_invoker=true) as
with video_items as (
  select i.intel_id,i.user_id,i.source_name,i.source_url,i.title,e.entity_name card_name,
         max(v.prominence) attention_prominence,min(v.start_ms) first_start_ms,min(l.oracle_id::text)::uuid oracle_id
  from public.market_intel_items i
  join public.market_intel_entities e on e.intel_id=i.intel_id and e.user_id=i.user_id and e.entity_type='card'
  join public.market_intel_video_events v on v.intel_id=i.intel_id and v.user_id=i.user_id
  left join public.market_intel_scout_signal_links l on l.intel_id=i.intel_id and l.user_id=i.user_id
  where i.source_type='youtube'
  group by i.intel_id,i.user_id,i.source_name,i.source_url,i.title,e.entity_name
), ranked_snapshots as (
  select s.*,row_number() over(partition by s.intel_id,s.user_id order by s.captured_at desc) rn from public.market_intel_market_snapshots s
), joined as (
  select vi.*,b.snapshot_id baseline_id,b.captured_at baseline_captured_at,b.market_price baseline_market_price,b.direct_low baseline_direct_low,b.direct_available baseline_direct_available,b.direct_listings baseline_direct_listings,b.avg_daily_qty_sold baseline_avg_daily_qty_sold,
         l.captured_at latest_captured_at,l.horizon latest_horizon,l.market_price latest_market_price,l.direct_low latest_direct_low,l.direct_available latest_direct_available,l.direct_listings latest_direct_listings,l.avg_daily_qty_sold latest_avg_daily_qty_sold,
         s.transaction_velocity_lift_30d_pct,s.evidence_level,s.evidence_status,s.evidence_confidence,s.post_signal_transactions_to_date,s.post_signal_quantity_to_date
  from video_items vi
  left join ranked_snapshots b on b.intel_id=vi.intel_id and b.user_id=vi.user_id and b.horizon='t0'
  left join ranked_snapshots l on l.intel_id=vi.intel_id and l.user_id=vi.user_id and l.rn=1
  left join public.marketplace_signal_card_sales_response s on s.user_id=vi.user_id and lower(s.card_name)=lower(vi.card_name)
), metrics as (
  select j.*,
    case when baseline_market_price>0 and latest_market_price is not null then round((latest_market_price/baseline_market_price-1)*100,2) end market_price_change_pct,
    case when baseline_direct_low>0 and latest_direct_low is not null then round((latest_direct_low/baseline_direct_low-1)*100,2) end direct_low_change_pct,
    case when baseline_direct_available>0 and latest_direct_available is not null then round((latest_direct_available::numeric/baseline_direct_available-1)*100,2) end direct_available_change_pct
  from joined j
), scored as (
  select m.*,least(100,greatest(0,
    least(40,greatest(0,coalesce(m.market_price_change_pct,0)*2))+
    least(25,greatest(0,coalesce(-m.direct_available_change_pct,0)*0.5))+
    least(35,greatest(0,coalesce(m.transaction_velocity_lift_30d_pct,0)*0.35))))::integer market_response_score
  from metrics m
)
select intel_id,user_id,source_name,source_url,title,card_name,oracle_id,round(attention_prominence*100)::integer attention_score,first_start_ms,
       baseline_captured_at,latest_captured_at,latest_horizon,baseline_market_price,latest_market_price,market_price_change_pct,
       baseline_direct_low,latest_direct_low,direct_low_change_pct,baseline_direct_available,latest_direct_available,direct_available_change_pct,
       baseline_direct_listings,latest_direct_listings,baseline_avg_daily_qty_sold,latest_avg_daily_qty_sold,
       transaction_velocity_lift_30d_pct,evidence_level,evidence_status,evidence_confidence,post_signal_transactions_to_date,post_signal_quantity_to_date,market_response_score,
       case when baseline_id is null then 'awaiting_baseline' when latest_horizon='t0' then 'baseline_only' when market_response_score>=60 then 'strong_reaction' when market_response_score>=25 then 'emerging_reaction' else 'limited_reaction' end market_response_status,
       case when round(attention_prominence*100)>=75 and market_response_score<25 then 'attention_ahead_of_market' when market_response_score>=60 then 'market_confirming' else 'watching' end attention_market_state
from scored;
grant select on public.market_intel_video_market_response to authenticated,service_role;
revoke all on public.market_intel_video_market_response from anon;
