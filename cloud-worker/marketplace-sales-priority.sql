-- Follow-up production tuning for the shared Marketplace sales collector.
-- Never-seen Signal products get a larger temporary priority boost so the initial watch universe fills
-- before normal short-TTL refreshes can churn on already-collected products.

create index if not exists market_intel_card_mentions_intel_user_idx
on public.market_intel_card_mentions(intel_id,user_id);

create or replace function public.get_marketplace_sales_collection_candidates(p_limit integer default 200)
returns table(
  user_id uuid,
  product_id text,
  product_name text,
  priority_score numeric,
  ttl_hours integer,
  watch_reasons text[],
  cached_at timestamptz,
  signal_first_at timestamptz,
  signal_last_at timestamptz
)
language sql security definer set search_path=public as $function$
  select w.user_id,w.product_id,w.product_name,
    (w.priority_score + case
      when c.fetched_at is null and 'signal'=any(w.watch_reasons) then 80
      when c.fetched_at is null then 30
      else least(18,greatest(0,extract(epoch from (now()-c.fetched_at))/3600/2))
    end)::numeric,
    w.ttl_hours,w.watch_reasons,c.fetched_at,w.signal_first_at,w.signal_last_at
  from public.marketplace_sales_watch_products w
  left join public.marketplace_product_sales_cache c
    on c.user_id=w.user_id and c.product_id=w.product_id
  where c.fetched_at is null or c.fetched_at<now()-make_interval(hours=>w.ttl_hours)
  order by 4 desc,coalesce(w.signal_last_at,'epoch'::timestamptz) desc,w.product_id
  limit greatest(1,least(coalesce(p_limit,200),1000));
$function$;
revoke all on function public.get_marketplace_sales_collection_candidates(integer) from public,anon,authenticated;
grant execute on function public.get_marketplace_sales_collection_candidates(integer) to service_role;
