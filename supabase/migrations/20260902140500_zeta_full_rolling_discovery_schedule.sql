select cron.unschedule('secret-lair-zeta-market-sync')
where exists (select 1 from cron.job where jobname='secret-lair-zeta-market-sync');

select cron.schedule(
  'secret-lair-zeta-market-sync',
  '*/5 * * * *',
  $$select net.http_post(
    url := 'https://bnsnlikjeogzdubgyvxk.supabase.co/functions/v1/secret-lair-zeta-market-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-collectish-cron-key',(select decrypted_secret from vault.decrypted_secrets where name='tcgplayer_price_cron' limit 1)
    ),
    body := '{"limit":12}'::jsonb,
    timeout_milliseconds := 120000
  );$$
);
