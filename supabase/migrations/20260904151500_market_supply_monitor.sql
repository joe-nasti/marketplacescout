-- Bounded TCGplayer-only supply history monitor for high-value Scout exact SKUs.
-- Intentionally rotates through a top-120 cohort rather than scanning the catalog.

create or replace function public.market_supply_monitor_targets_v1(p_limit integer default 40)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
with ranked as (
  select distinct on (c.sku_id)
    c.sku_id,c.product_id,c.product_name,c.set_code,c.collector_number,c.printing,c.condition,c.language,
    c.promoted_score,c.promoted_grade,c.direct_available,c.avg_daily_qty_sold
  from public.scout_opportunities_v5_cache c
  where c.sku_id ~ '^\d+$' and c.product_id ~ '^\d+$'
    and coalesce(c.promoted_score,c.opportunity_score,0)>=70
    and upper(coalesce(c.condition,'NEAR MINT')) in ('NEAR MINT','LIGHTLY PLAYED')
    and upper(coalesce(c.language,'ENGLISH'))='ENGLISH'
  order by c.sku_id,coalesce(c.promoted_score,c.opportunity_score,0) desc,c.computed_at desc nulls last
), cohort as (
  select r.* from ranked r
  order by coalesce(r.promoted_score,0) desc,coalesce(r.avg_daily_qty_sold,0) desc,r.sku_id
  limit 120
), aged as (
  select c.*,s.last_observed_at,s.observation_count
  from cohort c
  left join lateral (
    select max(m.observed_at) last_observed_at,count(*)::int observation_count
    from public.market_supply_snapshots m
    where m.source='tcgplayer_marketplace' and m.sku_id=c.sku_id and m.coverage_state='COMPLETE'
  ) s on true
), picked as (
  select * from aged
  order by last_observed_at asc nulls first,coalesce(promoted_score,0) desc,sku_id
  limit greatest(1,least(coalesce(p_limit,40),60))
)
select case when coalesce(auth.role(),'')<>'service_role' then jsonb_build_object('available',false,'error','service role required') else jsonb_build_object(
  'available',true,'scope','SCOUT_TOP_120_ROTATING_SUPPLY_MONITOR','target_count',(select count(*) from picked),
  'targets',coalesce((select jsonb_agg(jsonb_build_object(
    'product_id',product_id,'sku_id',sku_id,'card_name',product_name,'set_code',set_code,'collector_number',collector_number,
    'printing',printing,'condition',condition,'language',language,'promoted_score',promoted_score,'promoted_grade',promoted_grade,
    'direct_available',direct_available,'avg_daily_qty_sold',avg_daily_qty_sold,'last_supply_observed_at',last_observed_at,
    'supply_observation_count',coalesce(observation_count,0)
  ) order by last_observed_at asc nulls first,coalesce(promoted_score,0) desc) from picked),'[]'::jsonb),
  'note','Rotates through the top 120 English NM/LP Scout exact SKUs, prioritizing never/least-recently observed targets. This is intentionally bounded and not a catalog scan.'
) end;
$$;

revoke all on function public.market_supply_monitor_targets_v1(integer) from public,anon,authenticated;
grant execute on function public.market_supply_monitor_targets_v1(integer) to service_role;

insert into public.data_preservation_registry(
  table_name,data_class,preservation_tier,minimum_granularity,future_features,
  authoritative_source,can_rebuild,destructive_change_blocked,notes,reviewed_at
) values (
  'market_supply_snapshots','authoritative_history','PROTECT','Exact SKU marketplace supply snapshot',
  array['Supply shock / restock detection','Universal evidence timeline','Historical Direct restock behavior']::text[],
  true,false,true,
  'Authoritative observed listing/unit/seller depth by exact SKU; consumed by ask_collectish_supply_events_v1 and universal market timeline v3.',
  now()
)
on conflict(table_name) do update set
  preservation_tier='PROTECT',
  destructive_change_blocked=true,
  future_features=(select array(select distinct x from unnest(coalesce(public.data_preservation_registry.future_features,array[]::text[])||excluded.future_features) x)),
  notes=concat_ws(' ',public.data_preservation_registry.notes,excluded.notes),
  reviewed_at=now();

do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='market-supply-monitor-6h' limit 1;
  if j is not null then perform cron.unschedule(j); end if;
end$$;

select cron.schedule(
  'market-supply-monitor-6h',
  '17 */6 * * *',
  $cron$
  select net.http_post(
    url := 'https://bnsnlikjeogzdubgyvxk.supabase.co/functions/v1/market-supply-monitor',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-collectish-cron-key',(select decrypted_secret from vault.decrypted_secrets where name='tcgplayer_price_cron' limit 1)
    ),
    body := '{"limit":40,"max_pages":40}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
