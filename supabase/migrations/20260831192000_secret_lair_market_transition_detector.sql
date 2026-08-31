create table if not exists public.secret_lair_market_transition_state (
  transition_state_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  drop_id uuid not null references public.secret_lair_drops(drop_id) on delete cascade,
  finish text not null check (finish in ('nonfoil','foil','other')),
  tcgplayer_product_id text,
  first_observed_at timestamptz,
  first_listing_at timestamptz,
  first_sale_at timestamptz,
  first_three_sellers_at timestamptz,
  first_five_sellers_at timestamptz,
  first_five_listings_at timestamptz,
  first_ten_listings_at timestamptz,
  latest_observed_at timestamptz,
  latest_listing_count integer,
  latest_seller_count integer,
  latest_sales_count integer,
  peak_listing_count integer not null default 0,
  peak_seller_count integer not null default 0,
  product_transition_score numeric not null default 0 check (product_transition_score between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,drop_id,finish)
);
alter table public.secret_lair_market_transition_state enable row level security;
drop policy if exists secret_lair_market_transition_state_own on public.secret_lair_market_transition_state;
create policy secret_lair_market_transition_state_own on public.secret_lair_market_transition_state for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create index if not exists secret_lair_market_transition_release_idx on public.secret_lair_market_transition_state(user_id,release_id,latest_observed_at desc);

create table if not exists public.secret_lair_release_market_transition_state (
  release_transition_state_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  first_listing_at timestamptz,
  first_sale_at timestamptz,
  broad_market_candidate_at timestamptz,
  broad_market_confidence numeric not null default 0 check (broad_market_confidence between 0 and 1),
  active_product_count integer not null default 0,
  products_with_listings integer not null default 0,
  products_with_three_sellers integer not null default 0,
  products_with_five_listings integer not null default 0,
  products_with_sales integer not null default 0,
  total_listings integer not null default 0,
  total_sellers integer not null default 0,
  evidence_summary text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(user_id,release_id)
);
alter table public.secret_lair_release_market_transition_state enable row level security;
drop policy if exists secret_lair_release_market_transition_state_own on public.secret_lair_release_market_transition_state;
create policy secret_lair_release_market_transition_state_own on public.secret_lair_release_market_transition_state for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

create or replace function public.observe_secret_lair_market_transition(
  p_user_id uuid,p_release_id uuid,p_drop_id uuid,p_finish text,p_product_id text,
  p_observed_at timestamptz,p_listing_count integer,p_seller_count integer,p_sales_count integer default null
) returns void language plpgsql security definer set search_path=public as $$
declare l integer:=greatest(coalesce(p_listing_count,0),0); s integer:=greatest(coalesce(p_seller_count,0),0); x integer:=greatest(coalesce(p_sales_count,0),0); score numeric;
begin
  score:=least(1,
    (case when l>=1 and s>=1 then .20 else 0 end)+
    (case when s>=3 then .15 else 0 end)+
    (case when l>=5 then .15 else 0 end)+
    (case when s>=5 then .15 else 0 end)+
    (case when l>=10 then .15 else 0 end)+
    (case when x>=1 then .20 else 0 end));
  insert into public.secret_lair_market_transition_state(user_id,release_id,drop_id,finish,tcgplayer_product_id,first_observed_at,first_listing_at,first_sale_at,first_three_sellers_at,first_five_sellers_at,first_five_listings_at,first_ten_listings_at,latest_observed_at,latest_listing_count,latest_seller_count,latest_sales_count,peak_listing_count,peak_seller_count,product_transition_score,updated_at)
  values(p_user_id,p_release_id,p_drop_id,p_finish,p_product_id,p_observed_at,case when l>=1 then p_observed_at end,case when x>=1 then p_observed_at end,case when s>=3 then p_observed_at end,case when s>=5 then p_observed_at end,case when l>=5 then p_observed_at end,case when l>=10 then p_observed_at end,p_observed_at,p_listing_count,p_seller_count,p_sales_count,l,s,score,now())
  on conflict(user_id,drop_id,finish) do update set
    tcgplayer_product_id=excluded.tcgplayer_product_id,
    first_observed_at=coalesce(secret_lair_market_transition_state.first_observed_at,excluded.first_observed_at),
    first_listing_at=coalesce(secret_lair_market_transition_state.first_listing_at,excluded.first_listing_at),
    first_sale_at=coalesce(secret_lair_market_transition_state.first_sale_at,excluded.first_sale_at),
    first_three_sellers_at=coalesce(secret_lair_market_transition_state.first_three_sellers_at,excluded.first_three_sellers_at),
    first_five_sellers_at=coalesce(secret_lair_market_transition_state.first_five_sellers_at,excluded.first_five_sellers_at),
    first_five_listings_at=coalesce(secret_lair_market_transition_state.first_five_listings_at,excluded.first_five_listings_at),
    first_ten_listings_at=coalesce(secret_lair_market_transition_state.first_ten_listings_at,excluded.first_ten_listings_at),
    latest_observed_at=excluded.latest_observed_at,latest_listing_count=excluded.latest_listing_count,latest_seller_count=excluded.latest_seller_count,latest_sales_count=excluded.latest_sales_count,
    peak_listing_count=greatest(secret_lair_market_transition_state.peak_listing_count,excluded.peak_listing_count),peak_seller_count=greatest(secret_lair_market_transition_state.peak_seller_count,excluded.peak_seller_count),
    product_transition_score=greatest(secret_lair_market_transition_state.product_transition_score,excluded.product_transition_score),updated_at=now();
end $$;
revoke all on function public.observe_secret_lair_market_transition(uuid,uuid,uuid,text,text,timestamptz,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.observe_secret_lair_market_transition(uuid,uuid,uuid,text,text,timestamptz,integer,integer,integer) to service_role;

create or replace function public.reconcile_secret_lair_release_market_transition(p_user_id uuid,p_release_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; conf numeric:=0; cand timestamptz; summary text;
begin
 select count(*)::int active_product_count,
        count(*) filter(where latest_listing_count>=1 and latest_seller_count>=1)::int products_with_listings,
        count(*) filter(where latest_seller_count>=3)::int products_with_three_sellers,
        count(*) filter(where latest_listing_count>=5)::int products_with_five_listings,
        count(*) filter(where first_sale_at is not null)::int products_with_sales,
        coalesce(sum(greatest(coalesce(latest_listing_count,0),0)),0)::int total_listings,
        coalesce(sum(greatest(coalesce(latest_seller_count,0),0)),0)::int total_sellers,
        min(first_listing_at) first_listing_at,min(first_sale_at) first_sale_at
 into a from public.secret_lair_market_transition_state where user_id=p_user_id and release_id=p_release_id;
 conf:=least(1,
   (case when a.products_with_listings>=2 then .15 else 0 end)+
   (case when a.products_with_listings>=4 then .20 else 0 end)+
   (case when a.products_with_three_sellers>=3 then .20 else 0 end)+
   (case when a.products_with_five_listings>=3 then .20 else 0 end)+
   (case when a.products_with_sales>=2 then .15 else 0 end)+
   (case when a.total_sellers>=20 or a.total_listings>=40 then .10 else 0 end));
 if conf>=.70 then cand:=now(); end if;
 summary:=format('%s/%s products listed; %s with >=3 sellers; %s with >=5 listings; %s with sales; %s listings / %s seller-presences',a.products_with_listings,a.active_product_count,a.products_with_three_sellers,a.products_with_five_listings,a.products_with_sales,a.total_listings,a.total_sellers);
 insert into public.secret_lair_release_market_transition_state(user_id,release_id,first_listing_at,first_sale_at,broad_market_candidate_at,broad_market_confidence,active_product_count,products_with_listings,products_with_three_sellers,products_with_five_listings,products_with_sales,total_listings,total_sellers,evidence_summary,updated_at)
 values(p_user_id,p_release_id,a.first_listing_at,a.first_sale_at,cand,conf,a.active_product_count,a.products_with_listings,a.products_with_three_sellers,a.products_with_five_listings,a.products_with_sales,a.total_listings,a.total_sellers,summary,now())
 on conflict(user_id,release_id) do update set first_listing_at=coalesce(secret_lair_release_market_transition_state.first_listing_at,excluded.first_listing_at),first_sale_at=coalesce(secret_lair_release_market_transition_state.first_sale_at,excluded.first_sale_at),broad_market_candidate_at=coalesce(secret_lair_release_market_transition_state.broad_market_candidate_at,excluded.broad_market_candidate_at),broad_market_confidence=greatest(secret_lair_release_market_transition_state.broad_market_confidence,excluded.broad_market_confidence),active_product_count=excluded.active_product_count,products_with_listings=excluded.products_with_listings,products_with_three_sellers=excluded.products_with_three_sellers,products_with_five_listings=excluded.products_with_five_listings,products_with_sales=excluded.products_with_sales,total_listings=excluded.total_listings,total_sellers=excluded.total_sellers,evidence_summary=excluded.evidence_summary,updated_at=now();
 return jsonb_build_object('confidence',conf,'candidate_at',cand,'evidence',summary,'products_with_listings',a.products_with_listings,'products_with_sales',a.products_with_sales);
end $$;
revoke all on function public.reconcile_secret_lair_release_market_transition(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_secret_lair_release_market_transition(uuid,uuid) to service_role;

create or replace function public.secret_lair_market_transition_from_observation()
returns trigger language plpgsql security definer set search_path=public as $$
declare st public.secret_lair_market_transition_state%rowtype; sellers integer; l integer; x integer; pid text;
begin
  if new.source_market <> 'tcgplayer' or new.drop_id is null or new.finish is null then return new; end if;
  if new.observation_type not in ('market_snapshot','sale') then return new; end if;
  select * into st from public.secret_lair_market_transition_state where user_id=new.user_id and drop_id=new.drop_id and finish=new.finish;
  sellers:=case when new.observation_type='market_snapshot' then nullif(new.metadata->>'sellers','')::integer else st.latest_seller_count end;
  l:=case when new.observation_type='market_snapshot' then new.listing_count else st.latest_listing_count end;
  x:=case when new.observation_type='sale' then greatest(coalesce(new.sales_count,0),coalesce(new.quantity,0)::integer,1) else st.latest_sales_count end;
  pid:=coalesce(new.metadata->>'tcgplayer_product_id',st.tcgplayer_product_id);
  perform public.observe_secret_lair_market_transition(new.user_id,new.release_id,new.drop_id,new.finish,pid,new.observed_at,l,sellers,x);
  perform public.reconcile_secret_lair_release_market_transition(new.user_id,new.release_id);
  return new;
end $$;
revoke all on function public.secret_lair_market_transition_from_observation() from public,anon,authenticated;

drop trigger if exists trg_secret_lair_market_transition on public.secret_lair_market_observations;
create trigger trg_secret_lair_market_transition after insert on public.secret_lair_market_observations for each row execute function public.secret_lair_market_transition_from_observation();

do $$ declare r record; begin
  for r in
    select distinct on (o.user_id,o.drop_id,o.finish) o.*
    from public.secret_lair_market_observations o
    where o.source_market='tcgplayer' and o.observation_type='market_snapshot' and o.drop_id is not null and o.finish is not null
    order by o.user_id,o.drop_id,o.finish,o.observed_at desc
  loop
    perform public.observe_secret_lair_market_transition(r.user_id,r.release_id,r.drop_id,r.finish,r.metadata->>'tcgplayer_product_id',r.observed_at,r.listing_count,nullif(r.metadata->>'sellers','')::integer,r.sales_count);
  end loop;
  for r in select distinct user_id,release_id from public.secret_lair_market_transition_state loop perform public.reconcile_secret_lair_release_market_transition(r.user_id,r.release_id); end loop;
end $$;