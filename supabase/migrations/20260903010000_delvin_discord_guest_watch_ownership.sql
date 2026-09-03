alter table public.delvin_user_watches add column if not exists discord_user_id text;
alter table public.delvin_user_watches alter column user_id drop not null;
alter table public.delvin_user_watch_events add column if not exists discord_user_id text;
alter table public.delvin_user_watch_events alter column user_id drop not null;

update public.delvin_user_watches w
set discord_user_id=l.discord_user_id
from public.discord_collectish_links l
where w.user_id=l.user_id and w.discord_user_id is null;

update public.delvin_user_watch_events e
set discord_user_id=w.discord_user_id
from public.delvin_user_watches w
where e.watch_id=w.id and e.discord_user_id is null;

create index if not exists delvin_user_watches_discord_user_idx on public.delvin_user_watches(discord_user_id, enabled);
create index if not exists delvin_user_watch_events_discord_user_idx on public.delvin_user_watch_events(discord_user_id, matched_at desc);

create or replace function public.create_delvin_watch_from_discord_v1(
  p_discord_user_id text,
  p_prompt text,
  p_guild_id text default null,
  p_channel_id text default null,
  p_thread_id text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_user uuid;
  v_rule text;
  v_name text;
  v_rule_json jsonb;
  v_id uuid;
  s text := lower(coalesce(p_prompt,''));
begin
  if nullif(trim(coalesce(p_discord_user_id,'')),'') is null then
    return jsonb_build_object('ok',false,'error','Discord user id is required.');
  end if;
  select user_id into v_user from public.discord_collectish_links where discord_user_id=p_discord_user_id limit 1;
  if s ~ 'syp' and s ~ '(direct|cover)' then
    v_rule := 'syp_direct_tight'; v_name := 'SYP + tight Direct';
    v_rule_json := jsonb_build_object('max_direct_cover_days',2,'require_appetite_up',true);
  elsif s ~ '(sales|selling)' and s ~ '(before.*price|price.*move|price lag)' and s ~ '(confirm|another signal|corrobor)' then
    v_rule := 'price_lag_confirmed'; v_name := 'Price-lag confirmation';
    v_rule_json := jsonb_build_object('max_price_change_pct',10,'min_other_signals',1);
  else
    return jsonb_build_object('ok',false,'unsupported',true,'error','I can currently save SYP + tight Direct watches and sales-acceleration-before-price + confirmation watches.');
  end if;
  insert into public.delvin_user_watches(user_id,discord_user_id,name,prompt,rule_type,rule_json,delivery_type,discord_guild_id,discord_channel_id,discord_thread_id)
  values(v_user,p_discord_user_id,v_name,p_prompt,v_rule,v_rule_json,'discord',p_guild_id,p_channel_id,p_thread_id)
  returning id into v_id;
  return jsonb_build_object('ok',true,'watch_id',v_id,'name',v_name,'rule_type',v_rule,'rule',v_rule_json,'delivery','discord','owner','discord_guest','collectish_user_id',v_user);
end $$;

create or replace function public.list_delvin_watches_for_discord_v1(p_discord_user_id text)
returns jsonb language sql stable security definer set search_path=public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id',w.id,'name',w.name,'prompt',w.prompt,'rule_type',w.rule_type,'rule',w.rule_json,'enabled',w.enabled,
  'cooldown_minutes',w.cooldown_minutes,'last_triggered_at',w.last_triggered_at,'last_match_count',w.last_match_count,'created_at',w.created_at,
  'owner','discord_guest','linked_collectish',w.user_id is not null
) order by w.created_at desc),'[]'::jsonb)
from public.delvin_user_watches w
where w.discord_user_id=p_discord_user_id;
$$;

revoke all on function public.create_delvin_watch_from_discord_v1(text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.list_delvin_watches_for_discord_v1(text) from public,anon,authenticated;
grant execute on function public.create_delvin_watch_from_discord_v1(text,text,text,text,text) to service_role;
grant execute on function public.list_delvin_watches_for_discord_v1(text) to service_role;
