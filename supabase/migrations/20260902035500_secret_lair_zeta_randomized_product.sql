alter table public.secret_lair_releases add column if not exists product_structure text not null default 'fixed_contents';

do $$ begin
  if not exists (select 1 from pg_constraint where conname='secret_lair_releases_product_structure_check') then
    alter table public.secret_lair_releases add constraint secret_lair_releases_product_structure_check check (product_structure in ('fixed_contents','randomized_booster'));
  end if;
end $$;

create table if not exists public.secret_lair_randomized_products (
  randomized_product_id uuid primary key default gen_random_uuid(), user_id uuid not null,
  release_id uuid not null references public.secret_lair_releases(release_id) on delete cascade,
  product_name text not null, pack_msrp numeric(10,2), currency text not null default 'USD',
  cards_per_pack integer not null, total_distinct_cards integer not null,
  print_run_known boolean not null default false, official_url text, model_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id,release_id,product_name)
);
create table if not exists public.secret_lair_randomized_rarity_odds (
  rarity_odds_id uuid primary key default gen_random_uuid(), user_id uuid not null,
  randomized_product_id uuid not null references public.secret_lair_randomized_products(randomized_product_id) on delete cascade,
  rarity text not null check(rarity in('common','uncommon','rare','mythic')), pool_size integer not null check(pool_size>0),
  expected_cards_per_pack numeric(12,8) not null, specific_card_probability numeric(14,10) not null,
  packs_per_specific_card numeric(14,4) not null, provenance_url text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), unique(user_id,randomized_product_id,rarity)
);
create table if not exists public.secret_lair_randomized_treatments (
  treatment_id uuid primary key default gen_random_uuid(), user_id uuid not null,
  randomized_product_id uuid not null references public.secret_lair_randomized_products(randomized_product_id) on delete cascade,
  treatment_name text not null, canonical_name text not null, probability numeric(12,8) not null,
  aliases text[] not null default '{}'::text[], provenance_url text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), unique(user_id,randomized_product_id,treatment_name)
);
create table if not exists public.secret_lair_randomized_cards (
  randomized_card_id uuid primary key default gen_random_uuid(), user_id uuid not null,
  randomized_product_id uuid not null references public.secret_lair_randomized_products(randomized_product_id) on delete cascade,
  card_name text not null, rarity text not null check(rarity in('common','uncommon','rare','mythic')),
  oracle_id uuid, tcgplayer_product_id text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id,randomized_product_id,card_name)
);
create table if not exists public.secret_lair_randomized_pack_ev_snapshots (
  pack_ev_snapshot_id uuid primary key default gen_random_uuid(), user_id uuid not null,
  randomized_product_id uuid not null references public.secret_lair_randomized_products(randomized_product_id) on delete cascade,
  observed_at timestamptz not null, gross_mean_ev numeric, gross_median_ev numeric, net_mean_ev_after_fees numeric,
  break_even_probability numeric, two_x_probability numeric, five_x_probability numeric, ten_x_probability numeric,
  top5_ev_share numeric, top10_ev_share numeric, chase_compression_25_ev numeric, chase_compression_50_ev numeric,
  chase_compression_75_ev numeric, model_version text not null default 'zeta-pack-ev-v1', metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.secret_lair_randomized_products enable row level security;
alter table public.secret_lair_randomized_rarity_odds enable row level security;
alter table public.secret_lair_randomized_treatments enable row level security;
alter table public.secret_lair_randomized_cards enable row level security;
alter table public.secret_lair_randomized_pack_ev_snapshots enable row level security;

do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='secret_lair_randomized_products' and policyname='secret_lair_randomized_products_own') then create policy secret_lair_randomized_products_own on public.secret_lair_randomized_products for all using(user_id=auth.uid()) with check(user_id=auth.uid()); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='secret_lair_randomized_rarity_odds' and policyname='secret_lair_randomized_rarity_odds_own') then create policy secret_lair_randomized_rarity_odds_own on public.secret_lair_randomized_rarity_odds for all using(user_id=auth.uid()) with check(user_id=auth.uid()); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='secret_lair_randomized_treatments' and policyname='secret_lair_randomized_treatments_own') then create policy secret_lair_randomized_treatments_own on public.secret_lair_randomized_treatments for all using(user_id=auth.uid()) with check(user_id=auth.uid()); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='secret_lair_randomized_cards' and policyname='secret_lair_randomized_cards_own') then create policy secret_lair_randomized_cards_own on public.secret_lair_randomized_cards for all using(user_id=auth.uid()) with check(user_id=auth.uid()); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='secret_lair_randomized_pack_ev_snapshots' and policyname='secret_lair_randomized_pack_ev_snapshots_own') then create policy secret_lair_randomized_pack_ev_snapshots_own on public.secret_lair_randomized_pack_ev_snapshots for all using(user_id=auth.uid()) with check(user_id=auth.uid()); end if;
end $$;

create or replace view public.secret_lair_randomized_variant_odds with(security_invoker=true) as
select c.user_id,c.randomized_product_id,c.randomized_card_id,c.card_name,c.rarity,t.treatment_name,t.canonical_name treatment_canonical_name,
 r.specific_card_probability*t.probability specific_variant_probability,
 1/nullif(r.specific_card_probability*t.probability,0) packs_per_specific_variant,
 100000*r.specific_card_probability*t.probability expected_copies_per_100k_packs,
 rp.pack_msrp,rp.pack_msrp/nullif(r.specific_card_probability*t.probability,0) naive_expected_pack_spend_per_hit
from public.secret_lair_randomized_cards c
join public.secret_lair_randomized_rarity_odds r on r.user_id=c.user_id and r.randomized_product_id=c.randomized_product_id and r.rarity=c.rarity
join public.secret_lair_randomized_treatments t on t.user_id=c.user_id and t.randomized_product_id=c.randomized_product_id
join public.secret_lair_randomized_products rp on rp.user_id=c.user_id and rp.randomized_product_id=c.randomized_product_id;

insert into public.secret_lair_releases(user_id,release_name,release_slug,official_url,announced_at,sale_start_at,sale_format,supply_confidence,supply_notes,preorder_or_queue_notes,lifecycle_state,product_structure)
select user_id,'Secret Lair x MSCHF: The Zeta Set','secret-lair-x-mschf-the-zeta-set','https://magic.wizards.com/en/news/announcements/chaos-vault-the-zeta-set-puts-the-playtest-in-your-hands','2026-09-01T12:00:00Z','2026-09-02T16:00:00Z','fixed_quantity',.20,'Total pack print run is not public. Do not infer unit counts from rarity/treatment odds or hypothetical pack scenarios.','Pre-queue opens 8 a.m. PT; sale opens 9 a.m. PT. Cart does not reserve product.','pre_sale','randomized_booster'
from public.secret_lair_releases where release_name='Secret Lair: A Perfectly Normal Superdrop'
on conflict(user_id,release_name) do update set official_url=excluded.official_url,sale_start_at=excluded.sale_start_at,sale_format=excluded.sale_format,supply_confidence=excluded.supply_confidence,supply_notes=excluded.supply_notes,preorder_or_queue_notes=excluded.preorder_or_queue_notes,lifecycle_state=excluded.lifecycle_state,product_structure=excluded.product_structure,updated_at=now();

insert into public.secret_lair_randomized_products(user_id,release_id,product_name,pack_msrp,currency,cards_per_pack,total_distinct_cards,print_run_known,official_url,model_notes)
select user_id,release_id,'Zeta Booster',19.92,'USD',7,121,false,official_url,'Model pack EV as a probability distribution, not fixed-content EV. Scenario copy counts are conditional only.' from public.secret_lair_releases where release_name='Secret Lair x MSCHF: The Zeta Set'
on conflict(user_id,release_id,product_name) do update set pack_msrp=excluded.pack_msrp,cards_per_pack=excluded.cards_per_pack,total_distinct_cards=excluded.total_distinct_cards,print_run_known=false,official_url=excluded.official_url,model_notes=excluded.model_notes,updated_at=now();

insert into public.secret_lair_randomized_rarity_odds(user_id,randomized_product_id,rarity,pool_size,expected_cards_per_pack,specific_card_probability,packs_per_specific_card,provenance_url,metadata)
select rp.user_id,rp.randomized_product_id,x.rarity,x.pool_size,x.expected_per_pack,x.expected_per_pack/x.pool_size,1/(x.expected_per_pack/x.pool_size),rp.official_url,jsonb_build_object('source','official_wizards')
from public.secret_lair_randomized_products rp cross join(values('common'::text,52::int,3.6::numeric),('uncommon',39,2.3),('rare',20,.825),('mythic',10,.275))x(rarity,pool_size,expected_per_pack)
where rp.product_name='Zeta Booster'
on conflict(user_id,randomized_product_id,rarity) do update set pool_size=excluded.pool_size,expected_cards_per_pack=excluded.expected_cards_per_pack,specific_card_probability=excluded.specific_card_probability,packs_per_specific_card=excluded.packs_per_specific_card,provenance_url=excluded.provenance_url,metadata=excluded.metadata;

insert into public.secret_lair_randomized_treatments(user_id,randomized_product_id,treatment_name,canonical_name,probability,aliases,provenance_url,metadata)
select rp.user_id,rp.randomized_product_id,x.name,x.canonical,x.prob,x.aliases,rp.official_url,jsonb_build_object('source','official_wizards') from public.secret_lair_randomized_products rp
cross join(values('photocopy'::text,'Photocopy'::text,.85::numeric,array['normal','standard']::text[]),('negative','Photocopy Negative',.10,array['negative']::text[]),('color_banding','Color Banding',.05,array['rainbow','cmyk']::text[]))x(name,canonical,prob,aliases)
where rp.product_name='Zeta Booster'
on conflict(user_id,randomized_product_id,treatment_name) do update set canonical_name=excluded.canonical_name,probability=excluded.probability,aliases=excluded.aliases,provenance_url=excluded.provenance_url,metadata=excluded.metadata;

insert into public.secret_lair_evidence(user_id,release_id,source_type,source_name,source_url,author,evidence_class,claim_dimension,direction,confidence,summary,metadata)
select user_id,release_id,'official','Wizards of the Coast',official_url,'Wizards of the Coast','known_fact','distribution','neutral',1,
'7 cards: 3 commons/52, 2 uncommons/39, wildcard 60/30/7.5/2.5%, rare-mythic slot 75/25%; 121-card pool; treatments 85% Photocopy, 10% Negative, 5% Color Banding; MSRP $19.92.',jsonb_build_object('canonical_seed','zeta_official_odds','print_run_known',false)
from public.secret_lair_releases r where release_name='Secret Lair x MSCHF: The Zeta Set' and not exists(select 1 from public.secret_lair_evidence e where e.user_id=r.user_id and e.release_id=r.release_id and e.metadata->>'canonical_seed'='zeta_official_odds');

insert into public.secret_lair_evidence(user_id,release_id,source_type,source_name,evidence_class,claim_dimension,direction,confidence,normalized_score,summary,raw_rating,raw_rating_scale,metadata)
select user_id,release_id,'expert_review','Discord expert review','expert_opinion','other','bullish',.80,90,'Rating 9/10. Big-success thesis with strong cracking appeal and scarce chase treatments; risks include unknown total print run, chase-concentrated EV, underappreciated treatment scarcity, and hype fade.',9,10,jsonb_build_object('canonical_seed','zeta_friend_review')
from public.secret_lair_releases r where release_name='Secret Lair x MSCHF: The Zeta Set' and not exists(select 1 from public.secret_lair_evidence e where e.user_id=r.user_id and e.release_id=r.release_id and e.metadata->>'canonical_seed'='zeta_friend_review');

insert into public.secret_lair_predictions(user_id,release_id,source_type,source_name,prediction_type,prediction_label,claim,predicted_rating,predicted_rating_scale,confidence,frozen_at,metadata)
select r.user_id,r.release_id,'expert_review','Discord expert review',x.ptype,x.label,x.claim,x.rating,x.scale,x.confidence,now(),jsonb_build_object('canonical_seed',x.seed,'append_only',true)
from public.secret_lair_releases r cross join(values
('rating'::text,'9/10','Overall rating: 9/10.',9::numeric,10::numeric,.90::numeric,'zeta_rating_9'),
('collector_demand','Big success','The limited-distribution randomized Secret Lair booster will be a big success.',null,null,.80,'zeta_big_success'),
('collector_demand','Cracking appeal','At $19.92, Zeta boosters will have strong cracking appeal.',null,null,.75,'zeta_cracking_appeal'),
('other','Chase scarcity','Specific Photocopy Negative and Color Banding chase versions will be very rare.',null,null,.90,'zeta_chase_scarcity'),
('other','Hype fade','Chase cards may spike initially and fade as hype cools and supply reaches market.',null,null,.75,'zeta_hype_fade'),
('other','Print-run risk','Unknown total pack print run is a material downside.',null,null,.85,'zeta_print_run_risk'),
('resale_opportunity','EV concentration risk','Pack EV may lean heavily on chase cards.',null,null,.85,'zeta_ev_concentration'),
('other','Scarcity awareness','The public may initially underappreciate Negative and Color Banding scarcity.',null,null,.70,'zeta_scarcity_awareness'))x(ptype,label,claim,rating,scale,confidence,seed)
where r.release_name='Secret Lair x MSCHF: The Zeta Set' and not exists(select 1 from public.secret_lair_predictions p where p.user_id=r.user_id and p.release_id=r.release_id and p.metadata->>'canonical_seed'=x.seed);
