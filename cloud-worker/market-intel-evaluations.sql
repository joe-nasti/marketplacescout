-- MarketplaceScout independent market-timing evaluation for external intel.
-- Production migration names:
--   market_intel_market_evaluations
--   refresh_market_intel_evaluations_rpc

create table if not exists public.market_intel_evaluations (
  evaluation_id uuid primary key default gen_random_uuid(),
  intel_entity_id uuid not null unique references public.market_intel_entities(intel_entity_id) on delete cascade,
  intel_id uuid not null,
  user_id uuid not null,
  product_id text,
  market_stage text not null default 'insufficient_data' check (market_stage in ('early','confirming','late','insufficient_data')),
  evaluation_confidence numeric(4,3) not null default 0.5 check (evaluation_confidence between 0 and 1),
  baseline_at timestamptz,
  publish_snapshot_at timestamptz,
  current_snapshot_at timestamptz,
  baseline_market numeric,
  publish_market numeric,
  current_market numeric,
  baseline_direct numeric,
  publish_direct numeric,
  current_direct numeric,
  baseline_qty integer,
  publish_qty integer,
  current_qty integer,
  baseline_rank integer,
  publish_rank integer,
  current_rank integer,
  pre_price_change_pct numeric,
  post_price_change_pct numeric,
  pre_direct_change_pct numeric,
  pre_qty_change_pct numeric,
  pre_rank_improvement_pct numeric,
  reason text,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_intel_evaluations_intel_user_fkey foreign key (intel_id,user_id)
    references public.market_intel_items(intel_id,user_id) on delete cascade
);

create index if not exists market_intel_evaluations_user_stage_idx
  on public.market_intel_evaluations(user_id,market_stage,evaluated_at desc);
create index if not exists market_intel_evaluations_product_idx
  on public.market_intel_evaluations(product_id,evaluated_at desc);

alter table public.market_intel_evaluations enable row level security;

create or replace function public.refresh_market_intel_evaluations()
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  with targets as (
    select e.intel_entity_id,e.intel_id,e.user_id,e.product_id,i.direction,
           coalesce(i.published_at,i.observed_at) as event_at
    from public.market_intel_entities e
    join public.market_intel_items i on i.intel_id=e.intel_id and i.user_id=e.user_id
    where e.user_id=v_user and e.entity_type='card' and e.product_id is not null
  ), snaps as (
    select t.*,
      b.captured_at baseline_at,b.sku_market_price baseline_market,b.direct_low baseline_direct,b.direct_available baseline_qty,b.sales_rank baseline_rank,
      p.captured_at publish_snapshot_at,p.sku_market_price publish_market,p.direct_low publish_direct,p.direct_available publish_qty,p.sales_rank publish_rank,
      c.captured_at current_snapshot_at,c.sku_market_price current_market,c.direct_low current_direct,c.direct_available current_qty,c.sales_rank current_rank
    from targets t
    left join lateral (
      select s.captured_at,r.sku_market_price,r.direct_low,r.direct_available,r.sales_rank
      from public.marketplace_scan_rows r join public.marketplace_scans s on s.scan_id=r.scan_id
      where r.product_id=t.product_id and r.condition='Near Mint' and r.language='English' and r.printing='Normal'
        and s.captured_at <= t.event_at-interval '48 hours' and s.captured_at >= t.event_at-interval '10 days'
      order by s.captured_at desc limit 1
    ) b on true
    left join lateral (
      select s.captured_at,r.sku_market_price,r.direct_low,r.direct_available,r.sales_rank
      from public.marketplace_scan_rows r join public.marketplace_scans s on s.scan_id=r.scan_id
      where r.product_id=t.product_id and r.condition='Near Mint' and r.language='English' and r.printing='Normal'
        and s.captured_at <= t.event_at and s.captured_at >= t.event_at-interval '3 days'
      order by s.captured_at desc limit 1
    ) p on true
    left join lateral (
      select s.captured_at,r.sku_market_price,r.direct_low,r.direct_available,r.sales_rank
      from public.marketplace_scan_rows r join public.marketplace_scans s on s.scan_id=r.scan_id
      where r.product_id=t.product_id and r.condition='Near Mint' and r.language='English' and r.printing='Normal'
      order by s.captured_at desc limit 1
    ) c on true
  ), calc as (
    select *,
      case when baseline_market>0 and publish_market is not null then (publish_market-baseline_market)/baseline_market*100 end pre_price,
      case when publish_market>0 and current_market is not null then (current_market-publish_market)/publish_market*100 end post_price,
      case when baseline_direct>0 and publish_direct is not null then (publish_direct-baseline_direct)/baseline_direct*100 end pre_direct,
      case when baseline_qty>0 and publish_qty is not null then (baseline_qty-publish_qty)::numeric/baseline_qty*100 end pre_qty_down,
      case when baseline_rank>0 and publish_rank is not null then (baseline_rank-publish_rank)::numeric/baseline_rank*100 end pre_rank_improve
    from snaps
  ), scored as (
    select *,
      case direction when 'bearish' then greatest(coalesce(-pre_price,0),coalesce(-pre_direct,0),coalesce(-pre_qty_down,0),coalesce(-pre_rank_improve,0))
                     else greatest(coalesce(pre_price,0),coalesce(pre_direct,0),coalesce(pre_qty_down,0),coalesce(pre_rank_improve,0)) end pre_move,
      case direction when 'bearish' then coalesce(-post_price,0) else coalesce(post_price,0) end post_move
    from calc
  )
  insert into public.market_intel_evaluations(
    intel_entity_id,intel_id,user_id,product_id,market_stage,evaluation_confidence,
    baseline_at,publish_snapshot_at,current_snapshot_at,baseline_market,publish_market,current_market,
    baseline_direct,publish_direct,current_direct,baseline_qty,publish_qty,current_qty,
    baseline_rank,publish_rank,current_rank,pre_price_change_pct,post_price_change_pct,
    pre_direct_change_pct,pre_qty_change_pct,pre_rank_improvement_pct,reason,evaluated_at,updated_at)
  select intel_entity_id,intel_id,user_id,product_id,
    case when baseline_at is null or publish_snapshot_at is null then 'insufficient_data'
         when pre_move>=35 then 'late' when pre_move>=10 then 'confirming' else 'early' end,
    case when baseline_at is null or publish_snapshot_at is null then 0.35 when current_snapshot_at is null then 0.60 else 0.85 end,
    baseline_at,publish_snapshot_at,current_snapshot_at,baseline_market,publish_market,current_market,
    baseline_direct,publish_direct,current_direct,baseline_qty,publish_qty,current_qty,
    baseline_rank,publish_rank,current_rank,pre_price,post_price,pre_direct,pre_qty_down,pre_rank_improve,
    case when baseline_at is null or publish_snapshot_at is null then 'Not enough pre-publication Scout history to judge market timing.'
         when pre_move>=35 then 'MarketplaceScout detected a large directional market move before publication; treat this as late/context rather than fresh alpha.'
         when pre_move>=10 then 'MarketplaceScout detected a meaningful directional move before publication; the source is confirming an existing move.'
         when post_move>=7 then 'Little directional move was visible before publication, followed by movement afterward; the source appears early.'
         else 'No meaningful directional move was visible before publication; the source is early/unconfirmed so far.' end,
    now(),now()
  from scored
  on conflict (intel_entity_id) do update set
    product_id=excluded.product_id,market_stage=excluded.market_stage,evaluation_confidence=excluded.evaluation_confidence,
    baseline_at=excluded.baseline_at,publish_snapshot_at=excluded.publish_snapshot_at,current_snapshot_at=excluded.current_snapshot_at,
    baseline_market=excluded.baseline_market,publish_market=excluded.publish_market,current_market=excluded.current_market,
    baseline_direct=excluded.baseline_direct,publish_direct=excluded.publish_direct,current_direct=excluded.current_direct,
    baseline_qty=excluded.baseline_qty,publish_qty=excluded.publish_qty,current_qty=excluded.current_qty,
    baseline_rank=excluded.baseline_rank,publish_rank=excluded.publish_rank,current_rank=excluded.current_rank,
    pre_price_change_pct=excluded.pre_price_change_pct,post_price_change_pct=excluded.post_price_change_pct,
    pre_direct_change_pct=excluded.pre_direct_change_pct,pre_qty_change_pct=excluded.pre_qty_change_pct,
    pre_rank_improvement_pct=excluded.pre_rank_improvement_pct,reason=excluded.reason,evaluated_at=now(),updated_at=now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
