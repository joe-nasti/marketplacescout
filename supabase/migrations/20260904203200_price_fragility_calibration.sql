create or replace function public.ask_collectish_price_fragility_calibration_v1(p_days integer default 30)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
with params as (
  select greatest(1,least(coalesce(p_days,30),365))::int d
), base as (
  select h.*,
    p6.market_price m6,p6.direct_low_price d6,p6.low_price l6,
    case when p6.market_price>0 and p6.direct_low_price>0 then 100*abs(p6.direct_low_price-p6.market_price)/p6.market_price end dg,
    case when p6.market_price>0 and p6.low_price>0 then 100*abs(p6.low_price-p6.market_price)/p6.market_price end lg,
    s6.coverage_state sc,s6.unit_count su,s6.listing_count sl,s6.seller_count ss
  from public.scout_price_confidence_history h,params p
  left join lateral (
    select ph.* from public.tcgplayer_official_sku_price_history ph
    where ph.sku_id=h.sku_id and ph.observed_at>=h.evaluated_at+interval '5 hours' and ph.observed_at<h.evaluated_at+interval '8 hours'
    order by abs(extract(epoch from(ph.observed_at-(h.evaluated_at+interval '6 hours')))) limit 1
  ) p6 on true
  left join lateral (
    select s.* from public.market_supply_snapshots s
    where s.source='tcgplayer_marketplace' and s.sku_id=h.sku_id and s.observed_at>=h.evaluated_at+interval '5 hours' and s.observed_at<h.evaluated_at+interval '8 hours'
    order by abs(extract(epoch from(s.observed_at-(h.evaluated_at+interval '6 hours')))) limit 1
  ) s6 on true
  where auth.uid() is not null and h.user_id=auth.uid()
    and h.evaluated_at>=now()-make_interval(days=>p.d)
    and h.evaluated_at<=now()-interval '8 hours'
), scored as (
  select b.*,
    case when m6 is null then null
         when (coalesce(dg,999)<=20 or coalesce(lg,999)<=20)
          and (sc is null or (sc='COMPLETE' and coalesce(su,0)>=5 and coalesce(sl,0)>=3 and coalesce(ss,0)>=3))
         then true else false end supported_6h
  from base b
), overall as (
  select count(*) filter(where supported_6h is not null) scored_n,
         count(*) filter(where supported_6h) supported_n,
         case when count(*) filter(where supported_6h is not null)>0 then
           round(100.0*count(*) filter(where supported_6h)/count(*) filter(where supported_6h is not null),1) end supported_pct
  from scored
), expanded as (
  select s.*,f.flag
  from scored s cross join lateral unnest(s.fragility_flags) as f(flag)
  where s.supported_6h is not null
), flag_stats as (
  select flag,count(*) n,count(*) filter(where supported_6h) supported_n,
    round(100.0*count(*) filter(where supported_6h)/count(*),1) supported_pct
  from expanded group by flag
), noflag as (
  select fs.flag,
    count(*) filter(where s.supported_6h is not null and not (fs.flag=any(s.fragility_flags))) noflag_n,
    count(*) filter(where s.supported_6h and not (fs.flag=any(s.fragility_flags))) noflag_supported_n,
    case when count(*) filter(where s.supported_6h is not null and not (fs.flag=any(s.fragility_flags)))>0 then
      round(100.0*count(*) filter(where s.supported_6h and not (fs.flag=any(s.fragility_flags))) /
        count(*) filter(where s.supported_6h is not null and not (fs.flag=any(s.fragility_flags))),1) end noflag_supported_pct
  from flag_stats fs cross join scored s group by fs.flag
), packed as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'flag',fs.flag,'scored_n',fs.n,'supported_n',fs.supported_n,'supported_pct',fs.supported_pct,
    'without_flag_n',nf.noflag_n,'without_flag_supported_pct',nf.noflag_supported_pct,
    'descriptive_delta_pct_points',case when fs.supported_pct is not null and nf.noflag_supported_pct is not null then round(fs.supported_pct-nf.noflag_supported_pct,1) end,
    'claimable',fs.n>=20 and nf.noflag_n>=20
  ) order by fs.n desc,fs.flag),'[]'::jsonb) flags
  from flag_stats fs join noflag nf using(flag)
)
select jsonb_build_object(
  'available',true,'version','price_fragility_calibration_v1','days',(select d from params),
  'overall',jsonb_build_object('scored_6h',o.scored_n,'supported_6h',o.supported_n,'supported_6h_pct',o.supported_pct),
  'flags',p.flags,
  'readiness',case when o.scored_n>=100 then 'EARLY_FLAG_CALIBRATION' when o.scored_n>=40 then 'DIRECTIONAL_ONLY' else 'INSUFFICIENT_SAMPLE' end,
  'interpretation','Flag rates are univariate descriptive associations with 6h price-reference support. Flags overlap heavily, so deltas versus rows without a flag are not causal effects and must not be used as automatic scoring weights without larger multivariate/mature samples.',
  'generated_at',now()
) from overall o cross join packed p;
$$;
revoke all on function public.ask_collectish_price_fragility_calibration_v1(integer) from public,anon;
grant execute on function public.ask_collectish_price_fragility_calibration_v1(integer) to authenticated,service_role;
