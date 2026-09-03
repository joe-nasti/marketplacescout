-- TCGplayer first-party Top Selling monthly history and derived Delvin velocity intelligence.

create or replace view public.tcgplayer_top_selling_history_v1
with (security_invoker = true)
as
select distinct
  i.user_id,
  (sc.payload_json->>'report_window_start')::date as sales_window_start,
  (sc.payload_json->>'report_window_end')::date as sales_window_end,
  date_trunc('month',(sc.payload_json->>'report_window_start')::date)::date as sales_month,
  sc.payload_json->'criteria'->>'prior_month_average_sale_price_bucket' as price_bucket,
  (substring(i.summary from 'rank #([0-9]+)'))::integer as sales_rank,
  e.entity_name as card_name,
  nullif(substring(i.summary from '\[([^]]+)\] among'),'') as set_name,
  nullif(substring(i.summary from 'average sale price \$([0-9]+(?:\.[0-9]+)?)'),'')::numeric as average_sale_price,
  i.source_url,
  sc.payload_json->>'parent_article_title' as article_title
from public.source_captures sc
join public.market_intel_items i
  on i.user_id=sc.user_id
 and i.source_name='TCGplayer Top Selling Report'
 and i.source_url=sc.source_key
join public.market_intel_entities e on e.intel_id=i.intel_id
where sc.source='TCGplayer Top Selling Report'
  and sc.capture_type='data_report'
  and sc.metadata_json->>'status'='saved'
  and substring(i.summary from 'rank #([0-9]+)') is not null
  and (sc.payload_json->>'report_window_start') ~ '^\d{4}-\d{2}-\d{2}$';

revoke all on public.tcgplayer_top_selling_history_v1 from anon, authenticated;
grant select on public.tcgplayer_top_selling_history_v1 to service_role;

create or replace function public.ask_delvin_tcgplayer_velocity_trends_v1(
  p_as_of_month date default null,
  p_limit integer default 20,
  p_mode text default 'persistent'
)
returns table(
  sales_month date,
  price_bucket text,
  current_rank integer,
  previous_rank integer,
  rank_improvement integer,
  card_name text,
  set_name text,
  average_sale_price numeric,
  months_present_3 integer,
  months_present_6 integer,
  best_rank_6 integer,
  avg_rank_6 numeric,
  first_seen_month date,
  is_new_entry boolean,
  breakout boolean,
  persistence_score numeric,
  acceleration_score numeric,
  source_url text
)
language sql stable security definer
set search_path=public
as $function$
with params as (
  select coalesce(
    date_trunc('month',p_as_of_month)::date,
    (select max(h.sales_month) from public.tcgplayer_top_selling_history_v1 h)
  ) as m,
  greatest(1,least(coalesce(p_limit,20),100)) as lim,
  lower(coalesce(p_mode,'persistent')) as mode
), hist as (
  select h.*,
         lag(h.sales_rank) over(partition by h.user_id,h.price_bucket,h.card_name,coalesce(h.set_name,'') order by h.sales_month) as prev_rank,
         min(h.sales_month) over(partition by h.user_id,h.price_bucket,h.card_name,coalesce(h.set_name,'')) as first_seen
  from public.tcgplayer_top_selling_history_v1 h
), cur as (
  select h.*,p.m,p.lim,p.mode
  from hist h cross join params p
  where h.sales_month=p.m
), agg as (
  select c.user_id,c.sales_month,c.price_bucket,c.sales_rank,c.prev_rank,c.card_name,c.set_name,c.average_sale_price,c.source_url,c.first_seen,c.lim,c.mode,
         count(*) filter(where x.sales_month between (c.sales_month - interval '2 months')::date and c.sales_month)::int as mp3,
         count(*) filter(where x.sales_month between (c.sales_month - interval '5 months')::date and c.sales_month)::int as mp6,
         min(x.sales_rank) filter(where x.sales_month between (c.sales_month - interval '5 months')::date and c.sales_month)::int as best6,
         round(avg(x.sales_rank) filter(where x.sales_month between (c.sales_month - interval '5 months')::date and c.sales_month),1) as avg6
  from cur c
  join public.tcgplayer_top_selling_history_v1 x
    on x.user_id=c.user_id and x.price_bucket=c.price_bucket and x.card_name=c.card_name and coalesce(x.set_name,'')=coalesce(c.set_name,'')
  group by c.user_id,c.sales_month,c.price_bucket,c.sales_rank,c.prev_rank,c.card_name,c.set_name,c.average_sale_price,c.source_url,c.first_seen,c.lim,c.mode
), scored as (
 select a.*,
   (a.prev_rank-a.sales_rank) as improve,
   (a.first_seen=a.sales_month) as new_entry,
   (a.sales_rank<=25 and (a.prev_rank is null or a.prev_rank>50)) as is_breakout,
   round(least(100,20*a.mp3 + 5*a.mp6 + greatest(0,40-a.avg6)/2),1) as persist_score,
   round(least(100,greatest(0,
     greatest(0,coalesce(a.prev_rank,101)-a.sales_rank)*1.2
     + greatest(0,51-a.sales_rank)*0.8
     + case when a.first_seen=a.sales_month and a.sales_rank<=25 then 20 else 0 end
   )),1) as accel_score
 from agg a
)
select s.sales_month,s.price_bucket,s.sales_rank,s.prev_rank,s.improve,s.card_name,s.set_name,s.average_sale_price,
       s.mp3,s.mp6,s.best6,s.avg6,s.first_seen,s.new_entry,s.is_breakout,s.persist_score,s.accel_score,s.source_url
from scored s
where case s.mode
  when 'breakout' then s.is_breakout or s.accel_score>=60
  when 'accelerating' then coalesce(s.improve,0)>0
  when 'new' then s.new_entry
  else s.mp3>=2
end
order by
  case s.mode when 'breakout' then s.accel_score when 'accelerating' then s.accel_score else s.persist_score end desc,
  s.sales_rank asc,s.card_name
limit (select lim from params);
$function$;

revoke all on function public.ask_delvin_tcgplayer_velocity_trends_v1(date,integer,text) from public,anon,authenticated;
grant execute on function public.ask_delvin_tcgplayer_velocity_trends_v1(date,integer,text) to service_role;

create or replace function public.ask_delvin_tcgplayer_velocity_dropoffs_v1(
 p_as_of_month date default null,
 p_limit integer default 20
)
returns table(
 sales_month date,
 price_bucket text,
 previous_rank integer,
 card_name text,
 set_name text,
 previous_average_sale_price numeric,
 dropoff_type text,
 previous_source_url text
)
language sql stable security definer
set search_path=public
as $function$
with p as (
 select coalesce(date_trunc('month',p_as_of_month)::date,(select max(sales_month) from public.tcgplayer_top_selling_history_v1)) as m,
        greatest(1,least(coalesce(p_limit,20),100)) as lim
), prior as (
 select h.* from public.tcgplayer_top_selling_history_v1 h,p
 where h.sales_month=(p.m-interval '1 month')::date and h.sales_rank<=25
), cur as (
 select h.* from public.tcgplayer_top_selling_history_v1 h,p where h.sales_month=p.m
)
select p.m,pr.price_bucket,pr.sales_rank,pr.card_name,pr.set_name,pr.average_sale_price,
       case when c.sales_rank is null then 'fell_out' else 'rank_collapse' end,
       pr.source_url
from prior pr cross join p
left join cur c on c.user_id=pr.user_id and c.price_bucket=pr.price_bucket and c.card_name=pr.card_name and coalesce(c.set_name,'')=coalesce(pr.set_name,'')
where c.sales_rank is null or c.sales_rank>=50
order by pr.sales_rank asc,pr.card_name
limit (select lim from p);
$function$;

revoke all on function public.ask_delvin_tcgplayer_velocity_dropoffs_v1(date,integer) from public,anon,authenticated;
grant execute on function public.ask_delvin_tcgplayer_velocity_dropoffs_v1(date,integer) to service_role;

create or replace function public.ask_delvin_tcgplayer_velocity_persistent_cache_v1()
returns jsonb language sql stable security definer set search_path=public as $function$
select jsonb_build_object(
  'as_of_month',(select max(sales_month) from public.tcgplayer_top_selling_history_v1),
  'mode','persistent',
  'rows',coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('score',x.persistence_score) order by x.persistence_score desc,x.current_rank asc)
    from public.ask_delvin_tcgplayer_velocity_trends_v1(null,30,'persistent') x),'[]'::jsonb)
);
$function$;

create or replace function public.ask_delvin_tcgplayer_velocity_breakouts_cache_v1()
returns jsonb language sql stable security definer set search_path=public as $function$
select jsonb_build_object(
  'as_of_month',(select max(sales_month) from public.tcgplayer_top_selling_history_v1),
  'mode','breakout',
  'rows',coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('score',x.acceleration_score) order by x.acceleration_score desc,x.current_rank asc)
    from public.ask_delvin_tcgplayer_velocity_trends_v1(null,30,'breakout') x),'[]'::jsonb)
);
$function$;

create or replace function public.ask_delvin_tcgplayer_velocity_dropoffs_cache_v1()
returns jsonb language sql stable security definer set search_path=public as $function$
select jsonb_build_object(
  'as_of_month',(select max(sales_month) from public.tcgplayer_top_selling_history_v1),
  'mode','dropoff',
  'rows',coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('score',greatest(1,101-x.previous_rank)) order by x.previous_rank asc)
    from public.ask_delvin_tcgplayer_velocity_dropoffs_v1(null,30) x),'[]'::jsonb)
);
$function$;

revoke all on function public.ask_delvin_tcgplayer_velocity_persistent_cache_v1() from public,anon,authenticated;
revoke all on function public.ask_delvin_tcgplayer_velocity_breakouts_cache_v1() from public,anon,authenticated;
revoke all on function public.ask_delvin_tcgplayer_velocity_dropoffs_cache_v1() from public,anon,authenticated;
grant execute on function public.ask_delvin_tcgplayer_velocity_persistent_cache_v1() to service_role;
grant execute on function public.ask_delvin_tcgplayer_velocity_breakouts_cache_v1() to service_role;
grant execute on function public.ask_delvin_tcgplayer_velocity_dropoffs_cache_v1() to service_role;

insert into public.delvin_query_registry(query_key,prompt,category,aliases,ttl_seconds,sort_order,followups)
values
('tcgplayer_velocity_persistent','What cards have been consistently selling well for 3 months?','Sales velocity',array['consistent top sellers','persistent top sellers','consistent sellers','what keeps selling well','cards consistently selling well'],21600,82,'["What were the biggest TCGplayer sales-velocity breakouts last month?","Which TCGplayer top sellers are cooling off?"]'::jsonb),
('tcgplayer_velocity_breakouts','What were the biggest TCGplayer sales-velocity breakouts last month?','Sales velocity',array['velocity breakouts','sales velocity breakouts','top selling breakouts','new demand breakouts','biggest sales velocity breakouts'],21600,83,'["What cards have been consistently selling well for 3 months?","Which TCGplayer top sellers are cooling off?"]'::jsonb),
('tcgplayer_velocity_dropoffs','Which TCGplayer top sellers are cooling off?','Sales velocity',array['cooling top sellers','top seller dropoffs','sales velocity dropoffs','what fell out of top sellers','top sellers cooling off'],21600,84,'["What cards have been consistently selling well for 3 months?","What were the biggest TCGplayer sales-velocity breakouts last month?"]'::jsonb)
on conflict(query_key) do update set prompt=excluded.prompt,category=excluded.category,aliases=excluded.aliases,ttl_seconds=excluded.ttl_seconds,sort_order=excluded.sort_order,followups=excluded.followups,enabled=true,updated_at=now();

create or replace function public.refresh_delvin_query_cache_v1(p_query_key text default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $function$
declare r record;v_payload jsonb;v_start timestamptz;v_ms integer;refreshed jsonb:='[]'::jsonb;skipped jsonb:='[]'::jsonb;failed jsonb:='[]'::jsonb;
begin
 for r in select q.*,c.expires_at from delvin_query_registry q left join delvin_query_cache c using(query_key) where q.enabled and (p_query_key is null or q.query_key=p_query_key) order by q.sort_order,q.query_key loop
  if not p_force and r.expires_at is not null and r.expires_at>now() then skipped:=skipped||to_jsonb(r.query_key);continue;end if;
  v_start:=clock_timestamp();
  begin
   v_payload:=case r.query_key
    when 'mtgstocks_interests_both' then public.ask_mtgstocks_interests_vetted_all_v1(null,'average','24h',80)
    when 'tcgplayer_climbing' then public.ask_tcgplayer_climbing_v1(80)
    when 'sales_acceleration' then public.ask_sales_acceleration_v1(3,28,80,null,false)
    when 'sales_acceleration_price_lag' then public.ask_sales_acceleration_v1(3,28,80,null,true)
    when 'direct_pressure_7d' then public.ask_direct_pressure_v1(7,80,0.25)
    when 'direct_pressure_24h' then public.ask_direct_pressure_v1(1,80,0.25)
    when 'cross_market_dislocations' then public.ask_cross_market_dislocations_v1(80,0.25,1,10)
    when 'syp_pressure_7d' then public.ask_syp_pressure_v1(7,80)
    when 'edh_demand_7d' then public.ask_edh_demand_movers_v1(7,80)
    when 'creator_catalysts_7d' then public.ask_creator_catalyst_movers_v1(7,80)
    when 'market_radar' then public.ask_delvin_market_radar_v1(40)
    when 'tcgplayer_velocity_persistent' then public.ask_delvin_tcgplayer_velocity_persistent_cache_v1()
    when 'tcgplayer_velocity_breakouts' then public.ask_delvin_tcgplayer_velocity_breakouts_cache_v1()
    when 'tcgplayer_velocity_dropoffs' then public.ask_delvin_tcgplayer_velocity_dropoffs_cache_v1()
    else '{}'::jsonb end;
   v_ms:=greatest(0,round(extract(epoch from(clock_timestamp()-v_start))*1000)::integer);
   insert into delvin_query_cache(query_key,payload,generated_at,expires_at,source_watermarks,refresh_ms,last_error,updated_at)
   values(r.query_key,v_payload,now(),now()+make_interval(secs=>r.ttl_seconds),jsonb_build_object('refreshed_at',now()),v_ms,null,now())
   on conflict(query_key) do update set payload=excluded.payload,generated_at=excluded.generated_at,expires_at=excluded.expires_at,source_watermarks=excluded.source_watermarks,refresh_ms=excluded.refresh_ms,last_error=null,updated_at=now();
   refreshed:=refreshed||jsonb_build_object('query_key',r.query_key,'refresh_ms',v_ms);
  exception when others then
   insert into delvin_query_cache(query_key,payload,generated_at,expires_at,last_error,updated_at) values(r.query_key,'{}'::jsonb,now(),now()+interval '2 minutes',sqlerrm,now()) on conflict(query_key) do update set expires_at=now()+interval '2 minutes',last_error=sqlerrm,updated_at=now();
   failed:=failed||jsonb_build_object('query_key',r.query_key,'error',sqlerrm);
  end;
 end loop;
 return jsonb_build_object('refreshed',refreshed,'skipped',skipped,'failed',failed,'at',now());
end;$function$;

-- Compatibility overload: the Edge route historically sends p_prefix while Discord autocomplete sends p_search.
create or replace function public.list_delvin_query_starters_v1(p_prefix text default null,p_limit integer default 12,p_compat boolean default true)
returns jsonb language sql stable security definer set search_path=public as $function$
select public.list_delvin_query_starters_v1(p_search=>p_prefix,p_limit=>p_limit);
$function$;
revoke all on function public.list_delvin_query_starters_v1(text,integer,boolean) from public,anon,authenticated;
grant execute on function public.list_delvin_query_starters_v1(text,integer,boolean) to service_role;

select public.refresh_delvin_query_cache_v1('tcgplayer_velocity_persistent',true);
select public.refresh_delvin_query_cache_v1('tcgplayer_velocity_breakouts',true);
select public.refresh_delvin_query_cache_v1('tcgplayer_velocity_dropoffs',true);
