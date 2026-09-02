create or replace function public.ask_mtgstocks_interests_vetted_v1(
  p_source_date text default null,
  p_finish text default 'regular',
  p_price_type text default 'average',
  p_window text default '24h',
  p_limit integer default 40
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  d jsonb;
  kept_movers jsonb;
  demoted_noise jsonb;
  merged_noise jsonb;
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
  d := jsonb_set(d,'{early_movers}',kept_movers,true);
  d := jsonb_set(d,'{noise}',merged_noise,true);
  return d;
end;
$function$;
