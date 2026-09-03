-- Keep "consistent top sellers" distinct from merely persistent-but-cooling cards.
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
  select coalesce(date_trunc('month',p_as_of_month)::date,(select max(h.sales_month) from public.tcgplayer_top_selling_history_v1 h)) as m,
         greatest(1,least(coalesce(p_limit,20),100)) as lim,
         lower(coalesce(p_mode,'persistent')) as mode
), hist as (
  select h.*,
         lag(h.sales_rank) over(partition by h.user_id,h.price_bucket,h.card_name,coalesce(h.set_name,'') order by h.sales_month) as prev_rank,
         min(h.sales_month) over(partition by h.user_id,h.price_bucket,h.card_name,coalesce(h.set_name,'')) as first_seen
  from public.tcgplayer_top_selling_history_v1 h
), cur as (
  select h.*,p.m,p.lim,p.mode from hist h cross join params p where h.sales_month=p.m
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
   round(least(100,
     12*a.mp3 + 3*a.mp6
     + 30*greatest(0,1-least(coalesce(a.avg6,100),100)/100.0)
     + 16*greatest(0,1-least(a.sales_rank,100)/100.0)
   ),1) as persist_score,
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
  else s.mp3=3 and s.sales_rank<=50
end
order by case s.mode when 'breakout' then s.accel_score when 'accelerating' then s.accel_score else s.persist_score end desc,
         s.sales_rank asc,s.card_name
limit (select lim from params);
$function$;

revoke all on function public.ask_delvin_tcgplayer_velocity_trends_v1(date,integer,text) from public,anon,authenticated;
grant execute on function public.ask_delvin_tcgplayer_velocity_trends_v1(date,integer,text) to service_role;
select public.refresh_delvin_query_cache_v1('tcgplayer_velocity_persistent',true);
