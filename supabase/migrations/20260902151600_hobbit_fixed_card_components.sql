create table if not exists public.sealed_product_fixed_card_components(
 component_id uuid primary key default gen_random_uuid(),
 sealed_uuid uuid not null references public.mtgjson_sealed_products(uuid) on delete cascade,
 card_uuid uuid not null references public.mtgjson_cards(uuid) on delete cascade,
 finish text not null check(finish in ('normal','foil')),
 quantity numeric not null check(quantity>0),
 component_type text not null,
 provenance text not null,
 notes text,
 created_at timestamptz not null default now(),
 unique(sealed_uuid,card_uuid,finish,component_type)
);
alter table public.sealed_product_fixed_card_components enable row level security;
drop policy if exists sealed_product_fixed_card_components_read on public.sealed_product_fixed_card_components;
create policy sealed_product_fixed_card_components_read on public.sealed_product_fixed_card_components for select to authenticated using(true);
grant select on public.sealed_product_fixed_card_components to authenticated;

-- Product-specific card maps from Wizards product contents + MTGJSON collector identities.
insert into public.sealed_product_fixed_card_components(sealed_uuid,card_uuid,finish,quantity,component_type,provenance,notes)
select p.uuid,c.uuid,x.finish,x.quantity,x.component_type,'wizards_collecting_hobbit_2026-07-18','Exact HOB collector identity'
from public.mtgjson_sealed_products p
join (values
 ('189','normal',2::numeric,'basic_land'),('190','normal',2,'basic_land'),('191','normal',2,'basic_land'),('192','normal',2,'basic_land'),('193','normal',2,'basic_land'),
 ('194','normal',1,'journey_land'),('195','normal',1,'journey_land'),('196','normal',1,'journey_land'),('197','normal',1,'journey_land'),('198','normal',1,'journey_land'),
 ('189','foil',2,'basic_land'),('190','foil',2,'basic_land'),('191','foil',2,'basic_land'),('192','foil',2,'basic_land'),('193','foil',2,'basic_land'),
 ('194','foil',1,'journey_land'),('195','foil',1,'journey_land'),('196','foil',1,'journey_land'),('197','foil',1,'journey_land'),('198','foil',1,'journey_land'),
 ('313','foil',1,'seasonal_land'),('314','foil',1,'seasonal_land'),('315','foil',1,'seasonal_land'),('316','foil',1,'seasonal_land'),('321','foil',1,'bundle_promo')
) x(collector_number,finish,quantity,component_type) on true
join public.mtgjson_cards c on upper(c.set_code)='HOB' and c.collector_number=x.collector_number
where p.name='The Hobbit Bundle' on conflict do nothing;

insert into public.sealed_product_fixed_card_components(sealed_uuid,card_uuid,finish,quantity,component_type,provenance,notes)
select p.uuid,c.uuid,x.finish,x.quantity,x.component_type,'wizards_collecting_hobbit_2026-07-18','Exact HOB collector identity'
from public.mtgjson_sealed_products p
join (values
 ('189','normal',2::numeric,'basic_land'),('190','normal',2,'basic_land'),('191','normal',2,'basic_land'),('192','normal',2,'basic_land'),('193','normal',2,'basic_land'),
 ('194','normal',1,'journey_land'),('195','normal',1,'journey_land'),('196','normal',1,'journey_land'),('197','normal',1,'journey_land'),('198','normal',1,'journey_land'),
 ('189','foil',2,'basic_land'),('190','foil',2,'basic_land'),('191','foil',2,'basic_land'),('192','foil',2,'basic_land'),('193','foil',2,'basic_land'),
 ('194','foil',1,'journey_land'),('195','foil',1,'journey_land'),('196','foil',1,'journey_land'),('197','foil',1,'journey_land'),('198','foil',1,'journey_land'),
 ('317','foil',1,'seasonal_land_surge'),('318','foil',1,'seasonal_land_surge'),('319','foil',1,'seasonal_land_surge'),('320','foil',1,'seasonal_land_surge'),('321','foil',1,'bundle_promo')
) x(collector_number,finish,quantity,component_type) on true
join public.mtgjson_cards c on upper(c.set_code)='HOB' and c.collector_number=x.collector_number
where p.name='The Hobbit Gift Bundle' on conflict do nothing;

insert into public.sealed_product_fixed_card_components(sealed_uuid,card_uuid,finish,quantity,component_type,provenance,notes)
select p.uuid,c.uuid,'normal',1,'seasonal_land','wizards_collecting_hobbit_2026-07-18','Prerelease includes one of each seasonal Hobbit land'
from public.mtgjson_sealed_products p join public.mtgjson_cards c on upper(c.set_code)='HOB' and c.collector_number in ('313','314','315','316') where p.name='The Hobbit Prerelease Pack' on conflict do nothing;

insert into public.sealed_product_fixed_card_components(sealed_uuid,card_uuid,finish,quantity,component_type,provenance,notes)
select p.uuid,c.uuid,'foil',1,'scene_card','wizards_all_scene_cards_hobbit_2026-07-31','Crack the Plates scene'
from public.mtgjson_sealed_products p join public.mtgjson_cards c on upper(c.set_code)='HOC' and c.collector_number::int between 1 and 6 where p.name='The Hobbit Scene Box Crack the Plates' on conflict do nothing;
insert into public.sealed_product_fixed_card_components(sealed_uuid,card_uuid,finish,quantity,component_type,provenance,notes)
select p.uuid,c.uuid,'foil',1,'scene_card','wizards_all_scene_cards_hobbit_2026-07-31','Treasures of Smaug scene'
from public.mtgjson_sealed_products p join public.mtgjson_cards c on upper(c.set_code)='HOC' and c.collector_number::int between 7 and 12 where p.name='The Hobbit Scene Box Treasures of Smaug' on conflict do nothing;

create or replace view public.sealed_product_fixed_card_ev as
select fc.sealed_uuid,count(*)::int fixed_component_rows,sum(fc.quantity)::numeric fixed_card_count,
 sum(fc.quantity*coalesce(v.mtgjson_tcgplayer_retail,0))::numeric fixed_tcg_market_ev,
 sum(fc.quantity*coalesce(v.cardkingdom_buylist,0))::numeric fixed_ck_buylist_ev,
 count(*) filter(where v.mtgjson_tcgplayer_retail is not null)::int fixed_priced_rows
from public.sealed_product_fixed_card_components fc
left join public.mtgjson_vendor_price_pivot_current v on v.mtgjson_uuid=fc.card_uuid and v.finish=fc.finish
group by fc.sealed_uuid;
grant select on public.sealed_product_fixed_card_ev to authenticated;
