-- Zeta TCGplayer discovery is set-level and official-API-only.
-- Check Magic groups twice daily; once SLZ exists the Edge Function fetches
-- the whole group with includeSkus=true and maps all exact printings in bulk.
-- The function short-circuits with zero TCGplayer calls once mapping is complete.
do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='secret-lair-zeta-market-sync' limit 1;
  if j is not null then perform cron.unschedule(j); end if;
  perform cron.schedule(
    'secret-lair-zeta-market-sync',
    '0 6,18 * * *',
    $cmd$select net.http_post(
      url := 'https://bnsnlikjeogzdubgyvxk.supabase.co/functions/v1/secret-lair-zeta-market-sync',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-collectish-cron-key',(select decrypted_secret from vault.decrypted_secrets where name='tcgplayer_price_cron' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );$cmd$
  );
end $$;
