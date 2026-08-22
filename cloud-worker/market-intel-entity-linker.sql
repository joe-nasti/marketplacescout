-- MarketplaceScout card-signal entity linker.
-- Production migration: market_intel_entity_linker

create or replace function public.resolve_market_intel_entity_link()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare c record;
begin
  if new.entity_type <> 'card' or new.product_id is not null then return new; end if;

  select r.product_id,r.set_code,r.scryfall_id into c
  from public.marketplace_scan_rows r
  join public.marketplace_scans s on s.scan_id=r.scan_id
  where r.user_id=new.user_id
    and (
      (new.scryfall_id is not null and r.scryfall_id=new.scryfall_id)
      or (lower(r.product_name)=lower(new.entity_name) and new.set_code is not null and lower(coalesce(r.set_code,''))=lower(new.set_code))
      or (lower(r.product_name)=lower(new.entity_name) and (select count(distinct r2.product_id) from public.marketplace_scan_rows r2 where r2.user_id=new.user_id and lower(r2.product_name)=lower(new.entity_name))=1)
    )
  order by
    case when new.scryfall_id is not null and r.scryfall_id=new.scryfall_id then 0 when new.set_code is not null and lower(coalesce(r.set_code,''))=lower(new.set_code) then 1 else 2 end,
    case when r.condition='Near Mint' and r.language='English' and r.printing='Normal' then 0 else 1 end,
    s.captured_at desc
  limit 1;

  if c.product_id is not null then
    new.product_id:=c.product_id;
    new.set_code:=coalesce(new.set_code,c.set_code);
    new.scryfall_id:=coalesce(new.scryfall_id,c.scryfall_id);
    new.confidence:=greatest(new.confidence,0.99);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_market_intel_entity_link on public.market_intel_entities;
create trigger trg_market_intel_entity_link
before insert or update of entity_name,scryfall_id,set_code,product_id on public.market_intel_entities
for each row execute function public.resolve_market_intel_entity_link();

create or replace function public.refresh_market_intel_entity_links()
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare v_user uuid:=auth.uid(); v_count integer:=0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  with candidates as (
    select e.intel_entity_id,c.product_id,c.set_code,c.scryfall_id
    from public.market_intel_entities e
    left join lateral (
      select r.product_id,r.set_code,r.scryfall_id
      from public.marketplace_scan_rows r
      join public.marketplace_scans s on s.scan_id=r.scan_id
      where r.user_id=e.user_id
        and (
          (e.scryfall_id is not null and r.scryfall_id=e.scryfall_id)
          or (lower(r.product_name)=lower(e.entity_name) and e.set_code is not null and lower(coalesce(r.set_code,''))=lower(e.set_code))
          or (lower(r.product_name)=lower(e.entity_name) and (select count(distinct r2.product_id) from public.marketplace_scan_rows r2 where r2.user_id=e.user_id and lower(r2.product_name)=lower(e.entity_name))=1)
        )
      order by
        case when e.scryfall_id is not null and r.scryfall_id=e.scryfall_id then 0 when e.set_code is not null and lower(coalesce(r.set_code,''))=lower(e.set_code) then 1 else 2 end,
        case when r.condition='Near Mint' and r.language='English' and r.printing='Normal' then 0 else 1 end,
        s.captured_at desc
      limit 1
    ) c on true
    where e.user_id=v_user and e.entity_type='card' and e.product_id is null and c.product_id is not null
  )
  update public.market_intel_entities e
  set product_id=c.product_id,set_code=coalesce(e.set_code,c.set_code),scryfall_id=coalesce(e.scryfall_id,c.scryfall_id),confidence=greatest(e.confidence,0.99)
  from candidates c where e.intel_entity_id=c.intel_entity_id;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
