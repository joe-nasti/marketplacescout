create or replace function public.secret_lair_emit_transition_alerts()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_drop text;
  v_key text;
  v_title text;
  v_message text;
  v_sev text := 'info';
  v_meta jsonb;
  v_prev_listings int := coalesce(old.latest_listing_count,0);
  v_new_listings int := coalesce(new.latest_listing_count,0);
  v_peak int := greatest(coalesce(new.peak_listing_count,0),v_new_listings);
begin
  select d.drop_name into v_drop from public.secret_lair_drops d where d.drop_id=new.drop_id;
  if old.first_listing_at is null and new.first_listing_at is not null then
    v_key := format('secret_lair:first_listing:%s:%s:%s',new.release_id,new.drop_id,new.finish);
    v_title := 'First TCG listing appeared';
    v_message := format('%s %s has its first observed TCGplayer listing.',coalesce(v_drop,'Secret Lair drop'),upper(new.finish));
    v_meta := jsonb_build_object('release_id',new.release_id,'drop_id',new.drop_id,'finish',new.finish,'event','first_listing','observed_at',new.first_listing_at,'tcgplayer_product_id',new.tcgplayer_product_id);
  elsif old.first_sale_at is null and new.first_sale_at is not null then
    v_key := format('secret_lair:first_sale:%s:%s:%s',new.release_id,new.drop_id,new.finish);
    v_title := 'First TCG sale observed';
    v_message := format('%s %s has its first observed TCGplayer sale. Treat presale pricing as urgency evidence, not settled value.',coalesce(v_drop,'Secret Lair drop'),upper(new.finish));
    v_sev := 'warning';
    v_meta := jsonb_build_object('release_id',new.release_id,'drop_id',new.drop_id,'finish',new.finish,'event','first_sale','observed_at',new.first_sale_at,'tcgplayer_product_id',new.tcgplayer_product_id);
  elsif v_prev_listings < 10 and v_new_listings >= 10 then
    v_key := format('secret_lair:listing_flood:%s:%s:%s',new.release_id,new.drop_id,new.finish);
    v_title := 'TCG listing flood started';
    v_message := format('%s %s reached %s active listings. This may be the beginning of the release-supply undercut phase.',coalesce(v_drop,'Secret Lair drop'),upper(new.finish),v_new_listings);
    v_sev := 'warning';
    v_meta := jsonb_build_object('release_id',new.release_id,'drop_id',new.drop_id,'finish',new.finish,'event','listing_flood','listing_count',v_new_listings,'peak_listing_count',v_peak);
  elsif v_peak >= 20 and v_new_listings <= floor(v_peak*0.65) and v_prev_listings > floor(v_peak*0.65) then
    v_key := format('secret_lair:supply_drain:%s:%s:%s:%s',new.release_id,new.drop_id,new.finish,v_peak);
    v_title := 'Secret Lair supply draining';
    v_message := format('%s %s active listings are down at least 35%% from the observed peak (%s → %s).',coalesce(v_drop,'Secret Lair drop'),upper(new.finish),v_peak,v_new_listings);
    v_meta := jsonb_build_object('release_id',new.release_id,'drop_id',new.drop_id,'finish',new.finish,'event','supply_drain','listing_count',v_new_listings,'peak_listing_count',v_peak);
  else
    return new;
  end if;
  insert into public.collectish_alerts(user_id,alert_key,category,severity,title,message,action_screen,metadata_json,last_seen_at,resolved_at,updated_at)
  values(new.user_id,v_key,'business',v_sev,v_title,v_message,'signals',coalesce(v_meta,'{}'::jsonb),now(),null,now())
  on conflict(user_id,alert_key) do update set last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at,message=excluded.message,metadata_json=excluded.metadata_json,resolved_at=null;
  return new;
end $$;
revoke all on function public.secret_lair_emit_transition_alerts() from public,anon,authenticated;
grant execute on function public.secret_lair_emit_transition_alerts() to service_role;
drop trigger if exists trg_secret_lair_transition_alerts on public.secret_lair_market_transition_state;
create trigger trg_secret_lair_transition_alerts after update on public.secret_lair_market_transition_state for each row execute function public.secret_lair_emit_transition_alerts();

create or replace function public.secret_lair_emit_release_transition_alerts()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_release text;
  v_key text;
  v_title text;
  v_message text;
  v_meta jsonb;
begin
  select release_name into v_release from public.secret_lair_releases where release_id=new.release_id;
  if old.first_listing_at is null and new.first_listing_at is not null then
    v_key:=format('secret_lair:release_first_listing:%s',new.release_id);
    v_title:='Secret Lair TCG market started';
    v_message:=format('%s has its first observed TCGplayer listing.',coalesce(v_release,'Secret Lair release'));
    v_meta:=jsonb_build_object('release_id',new.release_id,'event','release_first_listing','observed_at',new.first_listing_at);
  elsif old.first_sale_at is null and new.first_sale_at is not null then
    v_key:=format('secret_lair:release_first_sale:%s',new.release_id);
    v_title:='First Secret Lair TCG sale';
    v_message:=format('%s has its first observed TCGplayer sale; presale pricing remains low-weight for equilibrium value.',coalesce(v_release,'Secret Lair release'));
    v_meta:=jsonb_build_object('release_id',new.release_id,'event','release_first_sale','observed_at',new.first_sale_at);
  elsif coalesce(old.broad_market_confidence,0) < .70 and coalesce(new.broad_market_confidence,0) >= .70 then
    v_key:=format('secret_lair:broad_market:%s',new.release_id);
    v_title:='Broad TCG market likely open';
    v_message:=format('%s crossed 70%% broad-market confidence: %s',coalesce(v_release,'Secret Lair release'),coalesce(new.evidence_summary,'market participation spread across products'));
    v_meta:=jsonb_build_object('release_id',new.release_id,'event','broad_market','confidence',new.broad_market_confidence,'candidate_at',new.broad_market_candidate_at,'evidence_summary',new.evidence_summary);
  else
    return new;
  end if;
  insert into public.collectish_alerts(user_id,alert_key,category,severity,title,message,action_screen,metadata_json,last_seen_at,resolved_at,updated_at)
  values(new.user_id,v_key,'business','info',v_title,v_message,'signals',v_meta,now(),null,now())
  on conflict(user_id,alert_key) do update set last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at,message=excluded.message,metadata_json=excluded.metadata_json,resolved_at=null;
  return new;
end $$;
revoke all on function public.secret_lair_emit_release_transition_alerts() from public,anon,authenticated;
grant execute on function public.secret_lair_emit_release_transition_alerts() to service_role;
drop trigger if exists trg_secret_lair_release_transition_alerts on public.secret_lair_release_market_transition_state;
create trigger trg_secret_lair_release_transition_alerts after update on public.secret_lair_release_market_transition_state for each row execute function public.secret_lair_emit_release_transition_alerts();
