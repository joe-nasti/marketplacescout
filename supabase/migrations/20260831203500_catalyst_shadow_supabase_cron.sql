-- Supabase is the primary scheduler for catalyst shadow capture. GitHub Actions
-- remains available for manual/push-triggered recovery, but calibration should not
-- depend on GitHub's delayed/omitted schedule events.

-- Give catalyst capture its own generated secret. Nothing sensitive is committed.
do $$
begin
  if not exists(select 1 from vault.secrets where name='catalyst_shadow_cron') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32),'hex'),
      'catalyst_shadow_cron',
      'Catalyst shadow recorder cron authentication'
    );
  end if;
end $$;

-- Existing scheduled Collectish functions use the TCGplayer cron key. Preserve
-- that behavior while allowing the dedicated catalyst scheduler token too.
create or replace function public.verify_collectish_cron_key(p_key text)
returns boolean
language sql
stable security definer
set search_path to 'public','vault'
as $$
  select coalesce(exists(
    select 1
    from vault.decrypted_secrets
    where name in ('tcgplayer_price_cron','catalyst_shadow_cron')
      and decrypted_secret=p_key
  ),false);
$$;

-- Replace any prior catalyst job with one canonical hourly schedule.
do $$
declare existing bigint;
begin
  select jobid into existing
  from cron.job
  where jobname='catalyst-shadow-recorder-hourly'
  limit 1;
  if existing is not null then perform cron.unschedule(existing); end if;
end $$;

select cron.schedule(
  'catalyst-shadow-recorder-hourly',
  '23 * * * *',
  $$select net.http_post(
    url := 'https://bnsnlikjeogzdubgyvxk.supabase.co/functions/v1/catalyst-shadow-recorder',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-collectish-cron-key',(
        select decrypted_secret
        from vault.decrypted_secrets
        where name='catalyst_shadow_cron'
        limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );$$
);
