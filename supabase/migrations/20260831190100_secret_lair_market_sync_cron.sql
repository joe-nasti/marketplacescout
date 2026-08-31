do $$ begin perform cron.unschedule('secret-lair-market-sync'); exception when others then null; end $$;
select cron.schedule('secret-lair-market-sync','*/15 * * * *',$$
  select net.http_post(
    url := 'https://bnsnlikjeogzdubgyvxk.supabase.co/functions/v1/secret-lair-market-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-collectish-cron-key',(select decrypted_secret from vault.decrypted_secrets where name='tcgplayer_price_cron' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
