create or replace function public.manage_delvin_watch_for_discord_v1(
  p_discord_user_id text,
  p_action text,
  p_selector text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_action text := lower(trim(coalesce(p_action,'')));
  v_selector text := trim(coalesce(p_selector,''));
  v_watch public.delvin_user_watches%rowtype;
  v_count integer := 0;
  v_ordinal integer;
begin
  if nullif(trim(coalesce(p_discord_user_id,'')),'') is null then
    return jsonb_build_object('ok',false,'error','Discord user id is required.');
  end if;

  if v_action in ('pause_all','resume_all','clear_all') then
    if v_action='pause_all' then
      update public.delvin_user_watches set enabled=false,updated_at=now()
      where discord_user_id=p_discord_user_id and enabled=true;
      get diagnostics v_count=row_count;
      return jsonb_build_object('ok',true,'action','pause_all','affected',v_count);
    elsif v_action='resume_all' then
      update public.delvin_user_watches set enabled=true,last_match_fingerprint=null,updated_at=now()
      where discord_user_id=p_discord_user_id and enabled=false;
      get diagnostics v_count=row_count;
      return jsonb_build_object('ok',true,'action','resume_all','affected',v_count);
    else
      delete from public.delvin_user_watches where discord_user_id=p_discord_user_id;
      get diagnostics v_count=row_count;
      return jsonb_build_object('ok',true,'action','clear_all','affected',v_count);
    end if;
  end if;

  if v_action not in ('pause','resume','delete') then
    return jsonb_build_object('ok',false,'error','Unsupported watch action.');
  end if;
  if v_selector='' then
    return jsonb_build_object('ok',false,'error','Specify a watch number from “show my watches”.');
  end if;

  if v_selector ~ '^[0-9]+$' then
    v_ordinal := v_selector::integer;
    if v_ordinal < 1 then
      return jsonb_build_object('ok',false,'error','Watch number must be 1 or greater.');
    end if;
    select w.* into v_watch
    from public.delvin_user_watches w
    where w.discord_user_id=p_discord_user_id
    order by w.created_at desc,w.id
    offset (v_ordinal-1) limit 1;
  elsif v_selector ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select w.* into v_watch from public.delvin_user_watches w
    where w.discord_user_id=p_discord_user_id and w.id=v_selector::uuid limit 1;
  else
    return jsonb_build_object('ok',false,'error','Use the watch number shown by “show my watches”.');
  end if;

  if v_watch.id is null then
    return jsonb_build_object('ok',false,'not_found',true,'error','I could not find that watch for your Discord user.');
  end if;

  if v_action='pause' then
    update public.delvin_user_watches set enabled=false,updated_at=now() where id=v_watch.id;
  elsif v_action='resume' then
    update public.delvin_user_watches set enabled=true,last_match_fingerprint=null,updated_at=now() where id=v_watch.id;
  else
    delete from public.delvin_user_watches where id=v_watch.id;
  end if;

  return jsonb_build_object('ok',true,'action',v_action,'watch_id',v_watch.id,'name',v_watch.name,'owner','discord_guest');
end;
$$;

revoke all on function public.manage_delvin_watch_for_discord_v1(text,text,text) from public,anon,authenticated;
grant execute on function public.manage_delvin_watch_for_discord_v1(text,text,text) to service_role;
