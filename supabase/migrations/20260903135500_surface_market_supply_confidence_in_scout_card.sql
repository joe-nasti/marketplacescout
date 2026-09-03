-- Promote market-wide supply proof/confidence semantics onto the Scout card
-- payload so Ask does not need to infer them from nested evidence.

create or replace function public.ask_collectish_get_scout_card(
  p_product_id text default null,
  p_sku_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  b jsonb;
  c jsonb;
  s jsonb;
  pid text;
  sid text;
  sns jsonb;
  variants jsonb;
  scope_note text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  b:=public.ask_collectish_get_scout_card_base_v1(p_product_id,p_sku_id);
  if not coalesce((b->>'found')::boolean,false) then return b; end if;
  c:=coalesce(b->'card','{}'::jsonb);
  pid:=coalesce(nullif(c->>'product_id',''),p_product_id);
  sid:=coalesce(nullif(c->>'sku_id',''),p_sku_id);
  s:=public.ask_collectish_market_supply_v1(pid,sid);

  scope_note:=case coalesce(s->>'claim_basis','')
    when 'TCGPLAYER_DEPTH_DISPROVES_GLOBAL_THINNESS' then
      'Fresh complete exact-SKU TCGplayer depth disproves a global thin-supply claim. Direct is only a subset; retailer stock counts are separate corroborating context.'
    when 'TCGPLAYER_THINNESS_CORROBORATED_BY_CK_AND_MANAPOOL' then
      'Exact-SKU TCGplayer thinness is corroborated by fresh Card Kingdom and ManaPool total-stock depth, so broader-market thinness is supported.'
    when 'RETAILER_DEPTH_REJECTS_TCGPLAYER_THINNESS' then
      'TCGplayer is tight, but fresh retailer stock depth shows meaningful supply outside TCGplayer; do not describe the broader market as thin.'
    when 'TCGPLAYER_THIN_RETAILER_CORROBORATION_INCOMPLETE' then
      'Exact-SKU TCGplayer supply is thin, but fresh retailer corroboration is incomplete or not uniformly thin; broader-market thinness remains unproven.'
    when 'TCGPLAYER_STALE_OR_INCOMPLETE' then
      'The exact-SKU TCGplayer snapshot is stale or incomplete, so broader-market supply is unproven.'
    else
      case when coalesce((s->>'available')::boolean,false)
        then 'Market supply uses exact-SKU TCGplayer marketplace depth plus independently measured retailer stock where available. Retailer price presence alone is never inventory depth.'
        else coalesce(c->>'supply_scope_note','Direct inventory alone cannot prove market-wide supply.') end
  end;

  c:=c || jsonb_build_object(
    'market_supply',s,
    'tcgplayer_supply_classification',coalesce(s->>'tcgplayer_supply_classification','UNPROVEN'),
    'global_supply_classification',coalesce(s->>'global_supply_classification','UNPROVEN'),
    'market_supply_confidence',coalesce(s->>'market_supply_confidence','UNPROVEN'),
    'market_wide_thinness_proven',coalesce((s->>'market_wide_thinness_proven')::boolean,false),
    'market_supply_claim_basis',coalesce(s->>'claim_basis','UNPROVEN'),
    'supply_scope',case when coalesce((s->>'available')::boolean,false) then 'EXACT_SKU_MARKET_DEPTH' else coalesce(c->>'supply_scope','DIRECT_ONLY') end,
    'supply_scope_note',scope_note
  );

  if b ? 'same_name_scope' then
    sns:=coalesce(b->'same_name_scope','{}'::jsonb);
    select coalesce(jsonb_agg(
      case
        when (coalesce(v->>'sku_id','')=coalesce(sid,'') or (coalesce(v->>'product_id','')=coalesce(pid,'') and coalesce(sid,'')=''))
        then v || jsonb_build_object(
          'tcgplayer_supply_classification',coalesce(s->>'tcgplayer_supply_classification','UNPROVEN'),
          'global_supply_classification',coalesce(s->>'global_supply_classification','UNPROVEN'),
          'market_supply_confidence',coalesce(s->>'market_supply_confidence','UNPROVEN'),
          'market_wide_thinness_proven',coalesce((s->>'market_wide_thinness_proven')::boolean,false),
          'market_supply_claim_basis',coalesce(s->>'claim_basis','UNPROVEN'),
          'supply_scope',case when coalesce((s->>'available')::boolean,false) then 'EXACT_SKU_MARKET_DEPTH' else coalesce(v->>'supply_scope','DIRECT_ONLY') end,
          'supply_scope_note',scope_note,
          'market_supply',s
        )
        else v
      end
    ),'[]'::jsonb) into variants
    from jsonb_array_elements(coalesce(sns->'variants','[]'::jsonb)) v;
    sns:=jsonb_set(sns,'{variants}',variants,true);
    b:=jsonb_set(b,'{same_name_scope}',sns,true);
  end if;

  return jsonb_set(b,'{card}',c,true);
end
$$;

revoke all on function public.ask_collectish_get_scout_card(text,text) from public,anon;
grant execute on function public.ask_collectish_get_scout_card(text,text) to authenticated,service_role;

notify pgrst,'reload schema';
