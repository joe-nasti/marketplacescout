alter function public.ask_delvin_velocity_price_supply_divergence_v1(integer) rename to ask_delvin_velocity_price_supply_divergence_core_v1;

create function public.ask_delvin_velocity_price_supply_divergence_v1(p_limit integer default 25)
returns jsonb
language sql
stable
security definer
set search_path='public'
as $function$
with base as (
  select public.ask_delvin_velocity_price_supply_divergence_core_v1(p_limit) j
), raw_rows as (
  select x
  from base cross join lateral jsonb_array_elements(coalesce(j->'rows','[]'::jsonb)) x
), normalized as (
  select x,
    case
      when nullif(x->>'supply_history_start','') is not null
       and nullif(x->>'supply_history_end','') is not null
       and ((x->>'supply_history_end')::timestamptz-(x->>'supply_history_start')::timestamptz) >= interval '1 hour'
      then coalesce(x->>'global_supply_state','UNPROVEN')
      else 'UNPROVEN'
    end effective_global_supply_state
  from raw_rows
), adjusted as (
  select
    x || jsonb_build_object(
      'global_supply_state',effective_global_supply_state,
      'divergence_score',greatest(0,coalesce((x->>'divergence_score')::numeric,0)-case when x->>'global_supply_state'='CONTRACTING' and effective_global_supply_state='UNPROVEN' then 18 else 0 end),
      'signal_class',case
        when x->>'price_signal'='EXACT_PRICE_LAG' and effective_global_supply_state='CONTRACTING'
          and coalesce((x->>'divergence_score')::numeric,0)>=72 then 'MISPRICED_DEMAND_CONFIRMED'
        when x->>'price_signal'='EXACT_PRICE_LAG' and x->>'direct_supply_state'='CONTRACTING'
          and coalesce((x->>'divergence_score')::numeric,0)>=60 then 'PRICE_LAG_DIRECT_TIGHTENING'
        when x->>'price_signal'='EXACT_PRICE_LAG' and effective_global_supply_state='UNPROVEN' then 'EXACT_PRICE_LAG_SUPPLY_UNPROVEN'
        when x->>'price_signal'='FAMILY_FLOOR_LAG' then 'FAMILY_PRICE_LAG_WATCH'
        when x->>'price_signal'='PRICE_REACTED' then 'DEMAND_CONFIRMED_PRICE_REACTED'
        else 'WATCH'
      end
    ) row_json
  from normalized
), cov as (
  select
    count(*) filter(where row_json->>'global_supply_state'<>'UNPROVEN') market_rows,
    count(*) rows_returned
  from adjusted
), out_rows as (
  select row_json from adjusted
  order by (row_json->>'divergence_score')::numeric desc,
           (row_json->>'demand_score')::numeric desc,
           (row_json->>'current_rank')::integer asc
)
select
  (j
   || jsonb_build_object('model','velocity_price_supply_divergence_v1_1')
   || jsonb_build_object('supply_note','Direct and market-wide supply are scored separately. Market-wide state requires at least 1 hour of repeated COMPLETE marketplace snapshots; otherwise it remains UNPROVEN.')
   || jsonb_build_object('coverage',coalesce(j->'coverage','{}'::jsonb) || jsonb_build_object('rows_with_market_supply_history',cov.market_rows))
   || jsonb_build_object('rows',coalesce((select jsonb_agg(row_json) from out_rows),'[]'::jsonb)))
from base cross join cov
$function$;

revoke all on function public.ask_delvin_velocity_price_supply_divergence_core_v1(integer) from public,anon,authenticated;
grant execute on function public.ask_delvin_velocity_price_supply_divergence_core_v1(integer) to service_role;
revoke all on function public.ask_delvin_velocity_price_supply_divergence_v1(integer) from public,anon,authenticated;
grant execute on function public.ask_delvin_velocity_price_supply_divergence_v1(integer) to service_role;
select public.refresh_delvin_query_cache_v1('velocity_price_supply_divergence',true);