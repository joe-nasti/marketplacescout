do $$ declare j bigint; begin
  select jobid into j from cron.job where jobname='secret-lair-asset-sync' limit 1;
  if j is not null then perform cron.unschedule(j); end if;
end $$;
select cron.schedule(
  'secret-lair-asset-sync',
  '*/2 * * * *',
  $cron$select net.http_post(
    url := 'https://bnsnlikjeogzdubgyvxk.supabase.co/functions/v1/secret-lair-assets-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-collectish-cron-key',(select decrypted_secret from vault.decrypted_secrets where name='tcgplayer_price_cron' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );$cron$
);
