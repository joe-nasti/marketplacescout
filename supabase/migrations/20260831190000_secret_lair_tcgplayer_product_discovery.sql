create table if not exists public.secret_lair_tcgplayer_products (
  mapping_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  drop_id uuid not null references public.secret_lair_drops(drop_id) on delete cascade,
  finish text not null check (finish in ('nonfoil','foil','other')),
  tcgplayer_product_id text not null,
  tcgplayer_sku_ids text[] not null default '{}',
  product_name text,
  set_name text,
  product_url text,
  discovery_query text,
  discovery_confidence numeric not null default 0 check (discovery_confidence between 0 and 1),
  discovery_status text not null default 'candidate' check (discovery_status in ('candidate','confirmed','rejected','stale')),
  discovery_source text not null default 'tcgplayer_search',
  details jsonb not null default '{}'::jsonb,
  is_primary boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,drop_id,finish,tcgplayer_product_id)
);
alter table public.secret_lair_tcgplayer_products enable row level security;
drop policy if exists secret_lair_tcgplayer_products_own on public.secret_lair_tcgplayer_products;
create policy secret_lair_tcgplayer_products_own on public.secret_lair_tcgplayer_products for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create index if not exists secret_lair_tcgplayer_products_release_idx on public.secret_lair_tcgplayer_products(user_id,release_id,discovery_status,last_seen_at desc);
create index if not exists secret_lair_tcgplayer_products_product_idx on public.secret_lair_tcgplayer_products(user_id,tcgplayer_product_id);
create unique index if not exists secret_lair_tcgplayer_primary_finish_idx on public.secret_lair_tcgplayer_products(user_id,drop_id,finish) where is_primary and discovery_status='confirmed';
create unique index if not exists secret_lair_market_observations_source_record_uq on public.secret_lair_market_observations(user_id,source_market,observation_type,source_record_id) where source_record_id is not null;

create or replace function public.project_secret_lair_marketplace_sales(p_user_id uuid,p_product_id text)
returns integer language plpgsql security definer set search_path=public as $$
declare n integer:=0;
begin
  insert into public.secret_lair_market_observations(user_id,release_id,drop_id,region,finish,source_market,observation_type,observed_at,market_phase,price,quantity,sales_count,market_price,low_price,phase_weight,equilibrium_weight,urgency_signal_weight,source_record_id,metadata)
  select m.user_id,m.release_id,m.drop_id,'US',m.finish,'tcgplayer','sale',b.bucket_start_date::timestamptz + interval '12 hours',
    public.secret_lair_market_phase(b.bucket_start_date::timestamptz + interval '12 hours',r.tcgplayer_presale_start_at,r.tcgplayer_general_listing_at,r.tcgplayer_release_weekend_end_at),
    case when coalesce(b.quantity_sold,0)>0 then b.market_price else null end,b.quantity_sold,coalesce(b.transaction_count,0)::int,b.market_price,b.low_sale_price_with_shipping,
    public.secret_lair_phase_equilibrium_weight(public.secret_lair_market_phase(b.bucket_start_date::timestamptz + interval '12 hours',r.tcgplayer_presale_start_at,r.tcgplayer_general_listing_at,r.tcgplayer_release_weekend_end_at)),
    public.secret_lair_phase_equilibrium_weight(public.secret_lair_market_phase(b.bucket_start_date::timestamptz + interval '12 hours',r.tcgplayer_presale_start_at,r.tcgplayer_general_listing_at,r.tcgplayer_release_weekend_end_at)),
    public.secret_lair_phase_urgency_weight(public.secret_lair_market_phase(b.bucket_start_date::timestamptz + interval '12 hours',r.tcgplayer_presale_start_at,r.tcgplayer_general_listing_at,r.tcgplayer_release_weekend_end_at)),
    concat('history:',p_product_id,':',b.sku_id,':',b.bucket_start_date::text),
    jsonb_build_object('sku_id',b.sku_id,'transaction_count',b.transaction_count,'quantity_sold',b.quantity_sold,'low_sale_price',b.low_sale_price,'high_sale_price',b.high_sale_price,'low_sale_price_with_shipping',b.low_sale_price_with_shipping,'high_sale_price_with_shipping',b.high_sale_price_with_shipping,'shared_marketplace_history',true)
  from public.secret_lair_tcgplayer_products m
  join public.secret_lair_releases r on r.release_id=m.release_id and r.user_id=m.user_id
  join public.marketplace_sku_sales_buckets b on b.user_id=m.user_id and b.product_id=m.tcgplayer_product_id and (cardinality(m.tcgplayer_sku_ids)=0 or b.sku_id=any(m.tcgplayer_sku_ids))
  where m.user_id=p_user_id and m.tcgplayer_product_id=p_product_id and m.discovery_status='confirmed'
  on conflict (user_id,source_market,observation_type,source_record_id) where source_record_id is not null do update set observed_at=excluded.observed_at,market_phase=excluded.market_phase,price=excluded.price,quantity=excluded.quantity,sales_count=excluded.sales_count,market_price=excluded.market_price,low_price=excluded.low_price,phase_weight=excluded.phase_weight,equilibrium_weight=excluded.equilibrium_weight,urgency_signal_weight=excluded.urgency_signal_weight,metadata=excluded.metadata;
  get diagnostics n=row_count;
  return n;
end$$;
revoke all on function public.project_secret_lair_marketplace_sales(uuid,text) from public,anon,authenticated;
grant execute on function public.project_secret_lair_marketplace_sales(uuid,text) to service_role;

create or replace function public.get_marketplace_sales_collection_candidates(p_limit integer default 200)
returns table(user_id uuid, product_id text, product_name text, priority_score numeric, ttl_hours integer, watch_reasons text[], cached_at timestamptz, signal_first_at timestamptz, signal_last_at timestamptz)
language sql security definer set search_path=public as $$
  with base as (
    select w.user_id,w.product_id,w.product_name,w.priority_score,w.ttl_hours,w.watch_reasons,w.signal_first_at,w.signal_last_at from public.marketplace_sales_watch_products w
    union all
    select m.user_id,m.tcgplayer_product_id,m.product_name,case when r.lifecycle_state in ('pre_sale','live') then 220::numeric else 150::numeric end,case when r.lifecycle_state in ('pre_sale','live') then 1 else 3 end,array['secret_lair']::text[],r.tcgplayer_presale_start_at,now()
    from public.secret_lair_tcgplayer_products m join public.secret_lair_releases r on r.release_id=m.release_id and r.user_id=m.user_id
    where m.discovery_status='confirmed' and m.is_primary
  ), grouped as (
    select user_id,product_id,max(product_name) product_name,max(priority_score) priority_score,min(ttl_hours) ttl_hours,array_agg(distinct x) watch_reasons,min(signal_first_at) signal_first_at,max(signal_last_at) signal_last_at
    from base cross join lateral unnest(watch_reasons) x group by user_id,product_id
  )
  select g.user_id,g.product_id,g.product_name,(g.priority_score + case when c.fetched_at is null and 'secret_lair'=any(g.watch_reasons) then 120 when c.fetched_at is null and 'signal'=any(g.watch_reasons) then 80 when c.fetched_at is null then 30 else least(18,greatest(0,extract(epoch from (now()-c.fetched_at))/3600/2)) end)::numeric,g.ttl_hours,g.watch_reasons,c.fetched_at,g.signal_first_at,g.signal_last_at
  from grouped g left join public.marketplace_product_sales_cache c on c.user_id=g.user_id and c.product_id=g.product_id
  where c.fetched_at is null or c.fetched_at < now()-make_interval(hours=>g.ttl_hours)
  order by 4 desc,coalesce(g.signal_last_at,'epoch'::timestamptz) desc,g.product_id
  limit greatest(1,least(coalesce(p_limit,200),1000));
$$;
