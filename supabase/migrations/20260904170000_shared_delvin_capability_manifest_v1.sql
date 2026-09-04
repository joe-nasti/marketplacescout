alter table public.delvin_query_registry add column if not exists capability_kind text not null default 'cached';
alter table public.delvin_query_registry add column if not exists route_key text;
alter table public.delvin_query_registry add column if not exists clients text[] not null default array['web','discord']::text[];
alter table public.delvin_query_registry add column if not exists discoverable boolean not null default true;
alter table public.delvin_query_registry add column if not exists context_scope text not null default 'market';
alter table public.delvin_query_registry add column if not exists surface_type text;
alter table public.delvin_query_registry add column if not exists async_enrichment boolean not null default false;
alter table public.delvin_query_registry add column if not exists modifier_schema jsonb not null default '{}'::jsonb;
alter table public.delvin_query_registry add column if not exists description text;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='delvin_query_registry_capability_kind_check') then
    alter table public.delvin_query_registry add constraint delvin_query_registry_capability_kind_check check(capability_kind in ('cached','dynamic','async'));
  end if;
end $$;

update public.delvin_query_registry
set route_key=coalesce(route_key,query_key),
    clients=coalesce(clients,array['web','discord']::text[]),
    surface_type=coalesce(surface_type,case when query_key='market_radar' then 'market_radar' else 'delvin_shared_report' end),
    context_scope=coalesce(nullif(context_scope,''),'market')
where route_key is null or surface_type is null or context_scope is null;

update public.delvin_query_registry set capability_kind='dynamic',route_key=query_key where query_key in ('market_changes','signal_followthrough');

insert into public.delvin_query_registry(query_key,prompt,category,aliases,ttl_seconds,sort_order,followups,capability_kind,route_key,clients,discoverable,context_scope,surface_type,async_enrichment,modifier_schema,description)
values
('collectible_cohort_thesis','Is there growth left with BLB and BLC raised foils?','Collectibles',array['collectible cohort thesis','raised foil growth','collectible growth runway','growth left in raised foils'],600,92,'["How are textured foils doing across sets?","What should I look at right now?"]'::jsonb,'dynamic','collectible_cohort_thesis',array['web','discord'],true,'market','delvin_shared_report',true,'{"supports":["set_codes","treatment","history_horizon"]}'::jsonb,'Cumulative one-of-each collectible-family thesis across one or more sets, with on-demand history enrichment when coverage is shallow.'),
('collectible_family_index','How are textured foils doing across sets?','Collectibles',array['collectible treatment across sets','which textured foil families are strongest','compare collectible treatments across sets'],600,93,'["Is there growth left with BLB and BLC raised foils?","What should I look at right now?"]'::jsonb,'dynamic','collectible_family_index',array['web','discord'],true,'market','delvin_shared_report',false,'{"supports":["treatment","top_n"]}'::jsonb,'Cross-set cohort ranking for a named collectible treatment family.'),
('set_intelligence','What''s moving in BLB?','Sets',array['set intelligence','what is moving in a set','top cards in a set','collectibles in a set'],600,94,'["Show me BLC raised foils","What should I look at right now?"]'::jsonb,'dynamic','set_intelligence',array['web','discord'],true,'market','delvin_shared_report',false,'{"supports":["set_code","top_n"]}'::jsonb,'Set-level market and collectible intelligence with treatment cohort context.'),
('treatment_intelligence','Show me BLC raised foils','Collectibles',array['show treatment in set','raised foils in set','retro frame foils in set','premium treatment in set'],600,95,'["How are textured foils doing across sets?","What''s moving in BLB?"]'::jsonb,'dynamic','treatment_intelligence',array['web','discord'],true,'market','delvin_shared_report',false,'{"supports":["set_code","treatment","top_n"]}'::jsonb,'Exact treatment cohort inside a specific set, preserving unique collectible treatments.'),
('printing_family','Compare all printings of Chatterfang, Squirrel General','Cards',array['compare all printings','which printing should i buy','printing family','compare printings'],600,96,'["Why is Chatterfang, Squirrel General moving?","What should I look at right now?"]'::jsonb,'dynamic','printing_family',array['web','discord'],true,'card_family','delvin_shared_report',false,'{"supports":["card_name","set_code","finish","condition"]}'::jsonb,'Compare relevant printings/treatments of one card using exact-SKU economics where available.'),
('card_investigation','Why is Y''shtola, Night''s Blessed moving?','Cards',array['why is this card moving','is this move real','am i late on this card','analyze card'],600,97,'["Compare all printings of Chatterfang, Squirrel General","What should I look at right now?"]'::jsonb,'dynamic','card_investigation',array['web','discord'],true,'card_family','delvin_shared_report',false,'{"supports":["card_name","set_code","finish","condition"]}'::jsonb,'Deterministic card-market investigation across current Scout and corroborating market evidence.')
on conflict(query_key) do update set
 prompt=excluded.prompt,category=excluded.category,aliases=excluded.aliases,sort_order=excluded.sort_order,followups=excluded.followups,
 capability_kind=excluded.capability_kind,route_key=excluded.route_key,clients=excluded.clients,discoverable=excluded.discoverable,context_scope=excluded.context_scope,
 surface_type=excluded.surface_type,async_enrichment=excluded.async_enrichment,modifier_schema=excluded.modifier_schema,description=excluded.description,updated_at=now();

create or replace function public.list_delvin_query_starters_v1(p_search text default null,p_limit integer default 12)
returns jsonb language sql stable security definer set search_path=public as $$
with candidates as (
  select q.*,c.payload,c.generated_at,c.expires_at,
    case when q.capability_kind='cached' then (c.payload is not null) else true end as warm,
    case when q.capability_kind='cached' then coalesce(c.expires_at<=now(),true) else false end as stale
  from delvin_query_registry q left join delvin_query_cache c using(query_key)
  where q.enabled and q.discoverable
    and (nullif(trim(coalesce(p_search,'')),'') is null
      or q.prompt ilike '%'||p_search||'%'
      or q.category ilike '%'||p_search||'%'
      or coalesce(q.description,'') ilike '%'||p_search||'%'
      or exists(select 1 from unnest(q.aliases) a where a ilike '%'||p_search||'%'))
  order by case when q.capability_kind='cached' and c.expires_at>now() then 0 when q.capability_kind<>'cached' then 1 else 2 end,q.sort_order,q.query_key
  limit greatest(1,least(coalesce(p_limit,12),50))
)
select coalesce(jsonb_agg(jsonb_build_object(
 'query_key',query_key,'route_key',coalesce(route_key,query_key),'prompt',prompt,'category',category,'aliases',aliases,
 'followups',followups,'capability_kind',capability_kind,'clients',clients,'context_scope',context_scope,'surface_type',surface_type,
 'async_enrichment',async_enrichment,'modifier_schema',modifier_schema,'description',description,'warm',warm,'stale',stale,'generated_at',generated_at
) order by sort_order,query_key),'[]'::jsonb) from candidates;
$$;

create or replace function public.list_delvin_query_starters_v1(p_prefix text default null,p_limit integer default 12,p_compat boolean default true)
returns jsonb language sql stable security definer set search_path=public as $$
select public.list_delvin_query_starters_v1(p_search=>p_prefix,p_limit=>p_limit);
$$;

create or replace function public.get_delvin_capability_manifest_v1(p_client text default null,p_limit integer default 100)
returns jsonb language sql stable security definer set search_path=public as $$
with rows as (
 select q.query_key,coalesce(q.route_key,q.query_key) route_key,q.prompt,q.category,q.aliases,q.followups,q.capability_kind,q.clients,q.discoverable,q.context_scope,q.surface_type,q.async_enrichment,q.modifier_schema,q.description,q.sort_order,q.ttl_seconds,
   case when q.capability_kind='cached' then c.generated_at else null end generated_at,
   case when q.capability_kind='cached' then coalesce(c.expires_at<=now(),true) else false end stale,
   case when q.capability_kind='cached' then c.payload is not null else true end warm
 from delvin_query_registry q left join delvin_query_cache c using(query_key)
 where q.enabled and (nullif(trim(coalesce(p_client,'')),'') is null or lower(p_client)=any(select lower(x) from unnest(q.clients) x))
 order by q.sort_order,q.query_key
 limit greatest(1,least(coalesce(p_limit,100),200))
)
select coalesce(jsonb_agg(to_jsonb(rows) order by sort_order,query_key),'[]'::jsonb) from rows;
$$;

create or replace function public.refresh_delvin_query_cache_v1(p_query_key text default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record;v_payload jsonb;v_start timestamptz;v_ms integer;refreshed jsonb:='[]'::jsonb;skipped jsonb:='[]'::jsonb;failed jsonb:='[]'::jsonb;
begin
 for r in select q.*,c.expires_at from delvin_query_registry q left join delvin_query_cache c using(query_key) where q.enabled and q.capability_kind='cached' and (p_query_key is null or q.query_key=p_query_key) order by q.sort_order,q.query_key loop
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
    when 'velocity_price_supply_divergence' then public.ask_delvin_velocity_price_supply_divergence_v1(30)
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
end;
$$;

grant execute on function public.list_delvin_query_starters_v1(text,integer) to authenticated,service_role;
grant execute on function public.list_delvin_query_starters_v1(text,integer,boolean) to authenticated,service_role;
grant execute on function public.get_delvin_capability_manifest_v1(text,integer) to authenticated,service_role;