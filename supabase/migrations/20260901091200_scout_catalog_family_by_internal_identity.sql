create or replace function public.scout_catalog_family(p_sku_id text, p_card_name text, p_limit integer default 200)
returns table(sku_id text, product_id text, scryfall_id uuid, oracle_id uuid, card_name text, set_code text, collector_number text, printing text, finish text, condition text, language text, release_date date, coverage_state text, last_score integer, last_grade text, last_evaluated_at timestamptz, refresh_requested_at timestamptz, wake_reason text, scout_score integer, scout_grade text, cheapest_buy numeric, cheapest_source text, direct_low numeric, direct_net_profit numeric, buylist_roi_pct numeric, ck_buylist numeric, avg_daily_qty_sold numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with target as (
    select i.scryfall_oracle_id as oracle_id
    from public.mtgjson_sku_commerce_identity i
    where i.sku_id = nullif(trim(p_sku_id),'')
    limit 1
  )
  select
    c.sku_id,
    c.product_id,
    i.scryfall_id,
    i.scryfall_oracle_id as oracle_id,
    c.card_name,
    c.set_code,
    c.collector_number,
    c.printing,
    c.finish,
    c.condition,
    c.language,
    c.release_date,
    coalesce(s.coverage_state,'catalog') as coverage_state,
    s.last_score,
    s.last_grade,
    s.last_evaluated_at,
    s.refresh_requested_at,
    s.wake_reason,
    coalesce(v.promoted_score,v.v5_shadow_score,v.opportunity_score,s.last_score) as scout_score,
    coalesce(v.promoted_grade,v.v5_shadow_grade,v.grade,s.last_grade) as scout_grade,
    v.cheapest_buy,
    v.cheapest_source,
    v.direct_low,
    v.direct_net_profit,
    v.buylist_roi_pct,
    v.ck_buylist,
    v.avg_daily_qty_sold
  from public.scout_card_catalog c
  join public.mtgjson_sku_commerce_identity i on i.sku_id=c.sku_id
  left join public.scout_card_state s on s.sku_id=c.sku_id and s.user_id=auth.uid()
  left join public.scout_opportunities_v5_cache v on v.sku_id=c.sku_id and v.user_id=auth.uid()
  cross join target t
  where auth.uid() is not null
    and (
      (t.oracle_id is not null and i.scryfall_oracle_id=t.oracle_id)
      or (t.oracle_id is null and lower(c.card_name)=lower(trim(p_card_name)))
    )
  order by c.release_date desc nulls last,c.set_code,c.collector_number,c.printing,c.condition
  limit greatest(1,least(coalesce(p_limit,200),2000));
$$;

revoke all on function public.scout_catalog_family(text,text,integer) from public;
revoke all on function public.scout_catalog_family(text,text,integer) from anon;
grant execute on function public.scout_catalog_family(text,text,integer) to authenticated;
