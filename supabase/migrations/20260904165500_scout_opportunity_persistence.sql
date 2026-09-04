-- Censor-aware opportunity persistence profile.
-- Excludes left-censored baseline starts and never treats closed-only duration as half-life.

create or replace function public.ask_collectish_scout_persistence_v1(
  p_days integer default 365,
  p_sku_id text default null
) returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
with params as (
  select greatest(1,least(coalesce(p_days,365),3650))::int d
), hist_all as (
  select h.*,
    (coalesce(h.flag,'PASS')='HOT' or (h.promoted_grade in ('A','B') and coalesce(h.flag,'PASS')<>'PASS')) actionable,
    lag(coalesce(h.flag,'PASS')='HOT' or (h.promoted_grade in ('A','B') and coalesce(h.flag,'PASS')<>'PASS'))
      over(partition by h.user_id,h.sku_id order by h.evaluated_at,h.id) prev_actionable,
    lag(h.evaluated_at) over(partition by h.user_id,h.sku_id order by h.evaluated_at,h.id) prev_at
  from public.scout_evaluation_history h
  where auth.uid() is not null and h.user_id=auth.uid()
    and (p_sku_id is null or h.sku_id=p_sku_id)
), starts as (
  select h.* from hist_all h,params p
  where h.actionable and not coalesce(h.prev_actionable,false)
    and h.evaluated_at>=now()-make_interval(days=>p.d)
), observed_starts as (
  select * from starts where prev_at is not null
), episodes as (
  select s.*,c.evaluated_at closed_at,coalesce(c.evaluated_at,now()) end_at,
    c.evaluated_at is null censored_open,
    extract(epoch from(coalesce(c.evaluated_at,now())-s.evaluated_at))/3600.0 observed_hours
  from observed_starts s
  left join lateral (
    select h.evaluated_at from hist_all h
    where h.user_id=s.user_id and h.sku_id=s.sku_id
      and h.evaluated_at>s.evaluated_at and not h.actionable
    order by h.evaluated_at,h.id limit 1
  ) c on true
), horizons(hours,label) as (
  values (1,'1h'),(3,'3h'),(6,'6h'),(12,'12h'),(24,'24h'),(72,'72h'),(168,'7d')
), survival as (
  select hz.hours,hz.label,
    count(*) filter(where e.evaluated_at<=now()-make_interval(hours=>hz.hours))::int eligible,
    count(*) filter(where e.evaluated_at<=now()-make_interval(hours=>hz.hours)
      and (e.closed_at is null or e.closed_at>=e.evaluated_at+make_interval(hours=>hz.hours)))::int survived
  from episodes e cross join horizons hz
  group by hz.hours,hz.label
), survival_shaped as (
  select *,case when eligible>0 then round(100.0*survived/eligible,1) end survival_pct,
    (eligible>=30) claimable
  from survival
), grade_survival as (
  select e.promoted_grade entry_grade,hz.hours,hz.label,
    count(*) filter(where e.evaluated_at<=now()-make_interval(hours=>hz.hours))::int eligible,
    count(*) filter(where e.evaluated_at<=now()-make_interval(hours=>hz.hours)
      and (e.closed_at is null or e.closed_at>=e.evaluated_at+make_interval(hours=>hz.hours)))::int survived
  from episodes e cross join horizons hz
  group by e.promoted_grade,hz.hours,hz.label
), grade_packed as (
  select entry_grade,jsonb_agg(jsonb_build_object(
    'hours',hours,'label',label,'eligible',eligible,'survived',survived,
    'survival_pct',case when eligible>0 then round(100.0*survived/eligible,1) end,
    'claimable',eligible>=20
  ) order by hours) survival
  from grade_survival group by entry_grade
), episode_stats as (
  select count(*)::int observed_transition_episodes,
    count(*) filter(where closed_at is not null)::int closed_episodes,
    count(*) filter(where closed_at is null)::int open_censored_episodes,
    round(avg(extract(epoch from(closed_at-evaluated_at))/3600.0) filter(where closed_at is not null)::numeric,2) mean_closed_hours,
    round(percentile_cont(.5) within group(order by extract(epoch from(closed_at-evaluated_at))/3600.0) filter(where closed_at is not null)::numeric,2) median_closed_hours,
    min(evaluated_at) first_observed_transition,max(evaluated_at) last_observed_transition
  from episodes
), left_censored as (
  select count(*)::int n from starts where prev_at is null
), max_claimable as (
  select hours,label,survival_pct from survival_shaped where claimable order by hours desc limit 1
), first_cross as (
  select hours,label,survival_pct from survival_shaped where claimable and survival_pct<=50 order by hours limit 1
), half_life as (
  select case
    when exists(select 1 from first_cross) then jsonb_build_object(
      'status','CROSSED','at_or_before_hours',(select hours from first_cross),'survival_pct',(select survival_pct from first_cross),
      'note','Earliest mature observation horizon at which at most half of observed-transition episodes remained actionable.'
    )
    when exists(select 1 from max_claimable) then jsonb_build_object(
      'status','LOWER_BOUND','greater_than_hours',(select hours from max_claimable),'survival_pct_at_bound',(select survival_pct from max_claimable),
      'note','More than half of mature observed-transition episodes remained actionable through the longest claimable horizon; half-life has not yet been reached.'
    )
    else jsonb_build_object('status','INSUFFICIENT_SAMPLE','note','No horizon has at least 30 mature observed-transition episodes yet.') end j
), survival_json as (
  select coalesce(jsonb_agg(jsonb_build_object('hours',hours,'label',label,'eligible',eligible,'survived',survived,'survival_pct',survival_pct,'claimable',claimable) order by hours),'[]'::jsonb) j
  from survival_shaped
), grade_json as (
  select coalesce(jsonb_agg(jsonb_build_object('entry_grade',entry_grade,'survival',survival) order by entry_grade),'[]'::jsonb) j from grade_packed
)
select jsonb_build_object(
  'available',true,'version','scout_persistence_v1','days',(select d from params),'sku_id',p_sku_id,
  'sample',jsonb_build_object(
    'episode_starts_total',(select observed_transition_episodes+(select n from left_censored) from episode_stats),
    'observed_transition_episodes',(select observed_transition_episodes from episode_stats),
    'left_censored_starts',(select n from left_censored),
    'closed_episodes',(select closed_episodes from episode_stats),
    'open_censored_episodes',(select open_censored_episodes from episode_stats),
    'first_observed_transition',(select first_observed_transition from episode_stats),
    'last_observed_transition',(select last_observed_transition from episode_stats)
  ),
  'closed_only_diagnostics',jsonb_build_object(
    'mean_closed_hours',(select mean_closed_hours from episode_stats),
    'median_closed_hours',(select median_closed_hours from episode_stats),
    'warning','Closed-only duration is not an opportunity half-life because still-open episodes are right-censored.'
  ),
  'survival',(select j from survival_json),
  'by_entry_grade',(select j from grade_json),
  'half_life',(select j from half_life),
  'readiness',case
    when coalesce((select hours from max_claimable),0)>=72 then 'MATURE_72H'
    when coalesce((select hours from max_claimable),0)>=24 then 'MATURE_24H'
    when coalesce((select hours from max_claimable),0)>=12 then 'EARLY_12H'
    when coalesce((select hours from max_claimable),0)>=6 then 'EARLY_6H'
    else 'INSUFFICIENT_SAMPLE' end,
  'method_note','Episode persistence excludes left-censored baseline starts. Survival at each horizon uses only episodes old enough to be observed at that horizon; still-open episodes are treated as surviving/censored rather than discarded.',
  'generated_at',now()
);
$$;
revoke all on function public.ask_collectish_scout_persistence_v1(integer,text) from public,anon;
grant execute on function public.ask_collectish_scout_persistence_v1(integer,text) to authenticated,service_role;
notify pgrst,'reload schema';
