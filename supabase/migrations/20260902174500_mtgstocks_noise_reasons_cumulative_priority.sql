create or replace function public.ask_mtgstocks_interests_vetted_v1(
  p_source_date text default null::text,
  p_finish text default 'regular'::text,
  p_price_type text default 'average'::text,
  p_window text default '24h'::text,
  p_limit integer default 40
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  d jsonb;
  kept_movers jsonb;
  demoted_noise jsonb;
  merged_noise jsonb;
  normalized_noise jsonb;
begin
  d := public.ask_mtgstocks_interests_vetted_v2_core(
    p_source_date,p_finish,p_price_type,p_window,p_limit
  );

  with movers as (
    select x, ord,
      coalesce(x->>'set_code','') as set_code,
      coalesce(x->>'set_name','') as set_name,
      coalesce(nullif(x->>'avg_daily_qty_sold','')::numeric,0) as sales_day,
      nullif(x->>'market_pct','')::numeric as market_pct,
      nullif(x->>'pct_change','')::numeric as pct_change,
      nullif(x->>'sku_market_price','')::numeric as sku_market_price,
      nullif(x->>'new_price','')::numeric as new_price,
      ms.released_at,
      ms.set_type
    from jsonb_array_elements(coalesce(d->'early_movers','[]'::jsonb)) with ordinality a(x,ord)
    left join magic_set_catalog ms on upper(ms.code)=upper(coalesce(x->>'set_code',''))
  ), judged as (
    select *,
      (set_name ~* '(^|:| )Promo Pack(:| |$)|Prerelease|Pre-Release') as is_promo,
      (coalesce(released_at,date '2100-01-01') < date '2003-01-01'
        or lower(coalesce(set_type,'')) in ('starter','portal','memorabilia')) as is_old_specialty,
      (
        sales_day >= 0.5
        or (market_pct is not null and pct_change is not null and sign(market_pct)=sign(pct_change))
        or (sku_market_price is not null and new_price is not null and new_price>0
            and abs(sku_market_price-new_price)/new_price <= 0.30)
      ) as has_corroboration,
      (
        sales_day >= 1.0
        or (sales_day >= 0.25 and market_pct is not null and pct_change is not null and sign(market_pct)=sign(pct_change))
      ) as has_strong_old_corroboration
    from movers
  )
  select coalesce(jsonb_agg(
    jsonb_set(
      x,
      '{reasons}',
      coalesce((
        select jsonb_agg(r)
        from jsonb_array_elements(coalesce(x->'reasons','[]'::jsonb)) r
        where r #>> '{}' <> 'exact Collectish printing resolved'
      ),'[]'::jsonb),
      true
    ) order by ord
  ),'[]'::jsonb)
  into kept_movers
  from judged
  where not is_promo
    and has_corroboration
    and (not is_old_specialty or has_strong_old_corroboration);

  with movers as (
    select x, ord,
      coalesce(x->>'set_code','') as set_code,
      coalesce(x->>'set_name','') as set_name,
      coalesce(nullif(x->>'avg_daily_qty_sold','')::numeric,0) as sales_day,
      nullif(x->>'market_pct','')::numeric as market_pct,
      nullif(x->>'pct_change','')::numeric as pct_change,
      nullif(x->>'sku_market_price','')::numeric as sku_market_price,
      nullif(x->>'new_price','')::numeric as new_price,
      ms.released_at,
      ms.set_type
    from jsonb_array_elements(coalesce(d->'early_movers','[]'::jsonb)) with ordinality a(x,ord)
    left join magic_set_catalog ms on upper(ms.code)=upper(coalesce(x->>'set_code',''))
  ), judged as (
    select *,
      (set_name ~* '(^|:| )Promo Pack(:| |$)|Prerelease|Pre-Release') as is_promo,
      (coalesce(released_at,date '2100-01-01') < date '2003-01-01'
        or lower(coalesce(set_type,'')) in ('starter','portal','memorabilia')) as is_old_specialty,
      (
        sales_day >= 0.5
        or (market_pct is not null and pct_change is not null and sign(market_pct)=sign(pct_change))
        or (sku_market_price is not null and new_price is not null and new_price>0
            and abs(sku_market_price-new_price)/new_price <= 0.30)
      ) as has_corroboration,
      (
        sales_day >= 1.0
        or (sales_day >= 0.25 and market_pct is not null and pct_change is not null and sign(market_pct)=sign(pct_change))
      ) as has_strong_old_corroboration
    from movers
  )
  select coalesce(jsonb_agg(
    jsonb_set(
      jsonb_set(
        x,
        '{vet_class}',
        to_jsonb(case
          when is_promo then 'promo_printing'
          when is_old_specialty and not has_strong_old_corroboration then 'old_thin_unconfirmed'
          else 'insufficient_corroboration'
        end::text),
        true
      ),
      '{reasons}',
      to_jsonb(array[case
        when is_promo then 'promo/prerelease printing omitted from early-mover ranking'
        when is_old_specialty and not has_strong_old_corroboration then 'old/specialty printing lacks strong liquidity or same-print market confirmation'
        else 'move lacks sales or same-print price corroboration'
      end]::text[]),
      true
    ) order by ord
  ),'[]'::jsonb)
  into demoted_noise
  from judged
  where is_promo
     or not has_corroboration
     or (is_old_specialty and not has_strong_old_corroboration);

  merged_noise := coalesce(d->'noise','[]'::jsonb) || demoted_noise;

  with rows as (
    select x, ord,
      coalesce(x->>'card_name','') as card_name,
      coalesce(x->>'set_name','') as set_name,
      coalesce(x->>'set_code','') as set_code
    from jsonb_array_elements(merged_noise) with ordinality a(x,ord)
  ), labeled as (
    select *,
      (card_name ~* 'art card|gold-stamped|planeswalker symbol|ultra pro puzzle|token|emblem|oversize'
       or set_name ~* '^Art Series:|Oversize Cards') as is_non_game,
      (set_name ~* '30th Anniversary Edition|International Edition|Collectors.? Edition|World Championship Decks') as is_non_tournament,
      (set_name ~* '(^|:| )Promo Pack(:| |$)|Prerelease|Pre-Release'
       or upper(set_code) ~ '^PM[0-9A-Z]+$') as is_promo
    from rows
  )
  select coalesce(jsonb_agg(
    jsonb_set(
      jsonb_set(
        x,
        '{vet_class}',
        to_jsonb(case
          when is_non_game then 'non_game'
          when is_non_tournament then 'non_tournament'
          when is_promo then 'promo_printing'
          else coalesce(x->>'vet_class','noise')
        end::text),
        true
      ),
      '{reasons}',
      (
        select coalesce(jsonb_agg(to_jsonb(reason) order by priority, seq),'[]'::jsonb)
        from (
          select reason, priority, min(seq) as seq
          from (
            select 'non-game / non-playable object'::text reason, 10 priority, 0::bigint seq where is_non_game
            union all
            select 'non-tournament printing', 20, 0 where is_non_tournament
            union all
            select 'promo/prerelease printing omitted from early-mover ranking', 30, 0 where is_promo
            union all
            select r #>> '{}',
                   case
                     when (r #>> '{}') ilike '%tiny starting price%' then 40
                     when (r #>> '{}') ilike '%extreme move%' then 50
                     when (r #>> '{}') ilike '%old/%' or (r #>> '{}') ilike '%old/specialty%' then 60
                     when (r #>> '{}') ilike '%lacks sales%' then 70
                     else 80
                   end,
                   r_ord
            from jsonb_array_elements(coalesce(x->'reasons','[]'::jsonb)) with ordinality rr(r,r_ord)
            where r #>> '{}' <> 'exact Collectish printing resolved'
          ) q
          group by reason, priority
        ) deduped
      ),
      true
    ) order by ord
  ),'[]'::jsonb)
  into normalized_noise
  from labeled;

  d := jsonb_set(d,'{early_movers}',kept_movers,true);
  d := jsonb_set(d,'{noise}',normalized_noise,true);
  return d;
end;
$function$;
