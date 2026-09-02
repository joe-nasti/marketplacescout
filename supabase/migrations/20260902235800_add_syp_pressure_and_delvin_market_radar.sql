create or replace function public.ask_syp_pressure_v1(p_lookback_days integer default 7, p_limit integer default 30)
returns jsonb language sql stable security definer set search_path='public' as $function$
with params as (
  select greatest(1,least(coalesce(p_lookback_days,7),30))::int lookback_days,
         greatest(1,least(coalesce(p_limit,30),80))::int lim
), recent as (
  select e.*,p.condition,p.market_price syp_market_price,p.current_max_quantity,p.is_currently_eligible,p.last_seen,
         row_number() over(partition by e.user_id,e.tcgplayer_id order by e.changed_at desc nulls last,e.collected_at desc) rn,
         count(*) filter(where e.event_type='ADDED') over(partition by e.user_id,e.tcgplayer_id) added_events,
         count(*) filter(where e.event_type='MAX_QUANTITY_INCREASED') over(partition by e.user_id,e.tcgplayer_id) increased_events
  from syp_events e join params q on true
  left join syp_products p on p.user_id=e.user_id and p.tcgplayer_id=e.tcgplayer_id
  where e.changed_at>=now()-make_interval(days=>(select lookback_days from params))
), latest as (select * from recent where rn=1), enriched as (
  select l.*,c.sku_id,c.product_id,c.set_code,c.set_name scout_set_name,c.printing,c.direct_low,c.direct_available,
         c.avg_daily_qty_sold,c.sku_market_price,c.tcg_low,c.grade,c.opportunity_score,
         case when c.sku_market_price>0 and c.direct_low is not null then (c.direct_low-c.sku_market_price)/c.sku_market_price*100 end direct_premium_pct,
         case when coalesce(c.avg_daily_qty_sold,0)>0 and c.direct_available is not null then c.direct_available/c.avg_daily_qty_sold end days_of_direct_cover,
         case when l.event_type in('ADDED','MAX_QUANTITY_INCREASED') then 'appetite_up'
              when l.event_type in('REMOVED','MAX_QUANTITY_DECREASED') then 'appetite_down_or_filled' else 'changed' end syp_direction
  from latest l left join scout_opportunities_v5_cache c on c.user_id=l.user_id and c.sku_id=l.tcgplayer_id
), scored as (
  select e.*,
    round((case when syp_direction='appetite_up' then 30 else 15 end
      +least(35,abs(coalesce(difference,new_value,old_value,0))*0.35)
      +least(20,coalesce(avg_daily_qty_sold,0)*2)
      +case when syp_direction='appetite_up' and coalesce(direct_available,999999)<=5 then 15 else 0 end
      +case when syp_direction='appetite_up' and coalesce(direct_premium_pct,0)>=15 then least(15,direct_premium_pct/4) else 0 end
      +case when added_events>1 or increased_events>1 then 8 else 0 end)::numeric,1) importance_score,
    case when syp_direction='appetite_up' and coalesce(direct_available,999999)<=5 and coalesce(avg_daily_qty_sold,0)>=1 then 'SYP appetite up + tight Direct supply'
         when syp_direction='appetite_up' and coalesce(avg_daily_qty_sold,0)>=1 then 'SYP appetite up + active sales'
         when syp_direction='appetite_up' then 'SYP appetite increased; market meaning still needs corroboration'
         when event_type='REMOVED' then 'Removed from SYP; may mean target filled or appetite changed'
         else 'SYP target decreased; may mean target filled or appetite changed' end interpretation
  from enriched e
), ranked as (select * from scored order by importance_score desc,changed_at desc nulls last limit(select lim from params))
select jsonb_build_object('query_type','syp_pressure','lookback_days',(select lookback_days from params),'observed_through',(select max(changed_at) from syp_events),
  'rows',coalesce(jsonb_agg(jsonb_build_object('sku_id',coalesce(sku_id,tcgplayer_id),'product_id',product_id,'card_name',product_name,
    'set_name',coalesce(scout_set_name,set_name),'set_code',set_code,'printing',printing,'condition',condition,'event_type',event_type,
    'syp_direction',syp_direction,'changed_at',changed_at,'old_value',old_value,'new_value',new_value,'difference',difference,
    'current_max_quantity',current_max_quantity,'currently_eligible',is_currently_eligible,'importance_score',importance_score,
    'interpretation',interpretation,'direct_low',direct_low,'direct_available',direct_available,'market_price',coalesce(sku_market_price,syp_market_price),
    'tcg_low',tcg_low,'avg_daily_qty_sold',avg_daily_qty_sold,'direct_premium_pct',round(direct_premium_pct::numeric,1),
    'days_of_direct_cover',round(days_of_direct_cover::numeric,1),'grade',grade,'opportunity_score',opportunity_score,
    'repeat_adds',added_events,'repeat_increases',increased_events) order by importance_score desc,changed_at desc),'[]'::jsonb)) from ranked;
$function$;
grant execute on function public.ask_syp_pressure_v1(integer,integer) to anon,authenticated,service_role;

create or replace function public.ask_delvin_market_radar_v1(p_limit integer default 15)
returns jsonb language sql stable security definer set search_path='public' as $function$
with p as(select greatest(1,least(coalesce(p_limit,15),30)) lim),source_rows as(
  select 'sales_acceleration' source,x,26::numeric+least(24,coalesce((x->>'velocity_multiple')::numeric,0)*2) score from delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'rows','[]'::jsonb)) x where c.query_key='sales_acceleration'
  union all select 'direct_pressure',x,30+least(25,abs(coalesce((x->>'availability_drop_pct')::numeric,0))/4)+least(10,greatest(coalesce((x->>'direct_premium_pct')::numeric,0),0)/5) from delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'rows','[]'::jsonb)) x where c.query_key='direct_pressure_7d'
  union all select 'cross_market',x,24+least(26,coalesce((x->>'best_roi_pct')::numeric,0)/20) from delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'rows','[]'::jsonb)) x where c.query_key='cross_market_dislocations'
  union all select 'tcgplayer_climbing',x,20+least(20,abs(coalesce((x->>'pct_change')::numeric,0))/10) from delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'vetted','[]'::jsonb)) x where c.query_key='tcgplayer_climbing'
  union all select 'mtgstocks',x,22+least(20,coalesce((x->>'action_score')::numeric,0)/5) from delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'early_movers','[]'::jsonb)) x where c.query_key='mtgstocks_interests_both'
  union all select 'syp',x,22+least(28,coalesce((x->>'importance_score')::numeric,0)/4) from delvin_query_cache c cross join lateral jsonb_array_elements(coalesce(c.payload->'rows','[]'::jsonb)) x where c.query_key='syp_pressure_7d' and coalesce(x->>'syp_direction','')='appetite_up'
),normalized as(
  select source,x,score,coalesce(nullif(x->>'sku_id',''),nullif(x->>'product_id',''),lower(coalesce(x->>'card_name',''))||'|'||lower(coalesce(x->>'set_code',x->>'set_name',''))) entity_key,x->>'card_name' card_name from source_rows where coalesce(x->>'card_name','')<>''
),grouped as(
  select entity_key,max(card_name) card_name,max(nullif(x->>'sku_id','')) sku_id,max(nullif(x->>'product_id','')) product_id,max(nullif(x->>'set_code','')) set_code,max(nullif(x->>'set_name','')) set_name,max(nullif(x->>'printing','')) printing,count(distinct source) source_count,array_agg(distinct source order by source) sources,round(least(100,sum(score)+case when count(distinct source)>=2 then 18 else 0 end)::numeric,1) radar_score,jsonb_agg(jsonb_build_object('source',source,'score',round(score,1),'data',x) order by score desc) evidence from normalized group by entity_key
),ranked as(select * from grouped order by source_count desc,radar_score desc limit(select lim from p))
select jsonb_build_object('query_type','market_radar','generated_from_cache_at',now(),'rows',coalesce(jsonb_agg(jsonb_build_object('card_name',card_name,'sku_id',sku_id,'product_id',product_id,'set_code',set_code,'set_name',set_name,'printing',printing,'source_count',source_count,'sources',to_jsonb(sources),'radar_score',radar_score,'evidence',evidence) order by source_count desc,radar_score desc),'[]'::jsonb)) from ranked;
$function$;
grant execute on function public.ask_delvin_market_radar_v1(integer) to anon,authenticated,service_role;

insert into public.delvin_query_registry(query_key,prompt,category,aliases,ttl_seconds,sort_order,enabled,followups,updated_at) values
('syp_pressure_7d','What SYP changes look most meaningful this week?','market',array['SYP pressure','meaningful SYP changes','what changed on SYP']::text[],900,75,true,'["What Direct cards are getting tight?","What should I look at right now?"]'::jsonb,now()),
('market_radar','What should I look at right now?','market',array['what should I look at','market radar','best opportunities right now','what is moving right now']::text[],300,90,true,'["What cards suddenly started selling faster?","What Direct cards are getting tight?","What SYP changes look most meaningful this week?"]'::jsonb,now())
on conflict(query_key) do update set prompt=excluded.prompt,category=excluded.category,aliases=excluded.aliases,ttl_seconds=excluded.ttl_seconds,sort_order=excluded.sort_order,enabled=excluded.enabled,followups=excluded.followups,updated_at=now();

create or replace function public.refresh_delvin_query_cache_v1(p_query_key text default null,p_force boolean default false)
returns jsonb language plpgsql security definer set search_path='public' as $function$
declare r record;v_payload jsonb;v_start timestamptz;v_ms integer;refreshed jsonb:='[]'::jsonb;skipped jsonb:='[]'::jsonb;failed jsonb:='[]'::jsonb;
begin
 for r in select q.*,c.expires_at from delvin_query_registry q left join delvin_query_cache c using(query_key) where q.enabled and(p_query_key is null or q.query_key=p_query_key) order by q.sort_order,q.query_key loop
  if not p_force and r.expires_at is not null and r.expires_at>now() then skipped:=skipped||to_jsonb(r.query_key);continue;end if;
  v_start:=clock_timestamp();
  begin
   v_payload:=case r.query_key when 'mtgstocks_interests_both' then public.ask_mtgstocks_interests_vetted_all_v1(null,'average','24h',80) when 'tcgplayer_climbing' then public.ask_tcgplayer_climbing_v1(80) when 'sales_acceleration' then public.ask_sales_acceleration_v1(3,28,80,null,false) when 'sales_acceleration_price_lag' then public.ask_sales_acceleration_v1(3,28,80,null,true) when 'direct_pressure_7d' then public.ask_direct_pressure_v1(7,80,0.25) when 'direct_pressure_24h' then public.ask_direct_pressure_v1(1,80,0.25) when 'cross_market_dislocations' then public.ask_cross_market_dislocations_v1(80,0.25,1,10) when 'syp_pressure_7d' then public.ask_syp_pressure_v1(7,80) when 'market_radar' then public.ask_delvin_market_radar_v1(30) else '{}'::jsonb end;
   v_ms:=greatest(0,round(extract(epoch from(clock_timestamp()-v_start))*1000)::integer);
   insert into delvin_query_cache(query_key,payload,generated_at,expires_at,source_watermarks,refresh_ms,last_error,updated_at) values(r.query_key,v_payload,now(),now()+make_interval(secs=>r.ttl_seconds),jsonb_build_object('refreshed_at',now()),v_ms,null,now()) on conflict(query_key) do update set payload=excluded.payload,generated_at=excluded.generated_at,expires_at=excluded.expires_at,source_watermarks=excluded.source_watermarks,refresh_ms=excluded.refresh_ms,last_error=null,updated_at=now();
   refreshed:=refreshed||jsonb_build_object('query_key',r.query_key,'refresh_ms',v_ms);
  exception when others then
   insert into delvin_query_cache(query_key,payload,generated_at,expires_at,last_error,updated_at) values(r.query_key,'{}'::jsonb,now(),now()+interval '2 minutes',sqlerrm,now()) on conflict(query_key) do update set expires_at=now()+interval '2 minutes',last_error=sqlerrm,updated_at=now();
   failed:=failed||jsonb_build_object('query_key',r.query_key,'error',sqlerrm);
  end;
 end loop;
 return jsonb_build_object('refreshed',refreshed,'skipped',skipped,'failed',failed,'at',now());
end;$function$;
grant execute on function public.refresh_delvin_query_cache_v1(text,boolean) to service_role;
