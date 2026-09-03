-- Expand Delvin collectible treatment classification and set-level collectible intelligence.
-- Applied to production as expand_delvin_collectible_treatments_and_set_intel.

create or replace function public.delvin_treatment_label_v1(p_product_name text,p_set_code text,p_collector_number text,p_printing text) returns text language sql immutable as $$
select case
 when p_product_name ilike '%(Raised Foil)%' then 'Raised Foil'
 when p_product_name ilike '%Fracture Foil%' then 'Fracture Foil'
 when p_product_name ilike '%Galaxy Foil%' then 'Galaxy Foil'
 when p_product_name ilike '%Surge Foil%' then 'Surge Foil'
 when p_product_name ilike '%Textured Foil%' or p_product_name ilike '%Textured%' then 'Textured Foil'
 when p_product_name ilike '%Rainbow Foil%' then 'Rainbow Foil'
 when p_product_name ilike '%Halo Foil%' then 'Halo Foil'
 when p_product_name ilike '%Confetti Foil%' then 'Confetti Foil'
 when p_product_name ilike '%Oil Slick%' then 'Oil Slick Raised Foil'
 when p_product_name ilike '%Step-and-Compleat%' then 'Step-and-Compleat Foil'
 when p_product_name ilike '%Neon Ink%' then 'Neon Ink'
 when p_product_name ilike '%Serialized%' then 'Serialized'
 when p_product_name ilike '%Gilded%' then 'Gilded Foil'
 when p_product_name ilike '%Etched%' then 'Etched Foil'
 when p_product_name ilike '%(Retro Frame)%' and lower(coalesce(p_printing,''))='foil' then 'Retro Frame Foil'
 when p_product_name ilike '%(Retro Frame)%' then 'Retro Frame'
 when p_product_name ilike '%Borderless%' and lower(coalesce(p_printing,''))='foil' then 'Borderless Foil'
 when p_product_name ilike '%Borderless%' then 'Borderless'
 when p_product_name ilike '%Extended Art%' and lower(coalesce(p_printing,''))='foil' then 'Extended Art Foil'
 when p_product_name ilike '%Extended Art%' then 'Extended Art'
 when p_product_name ilike '%Showcase%' and lower(coalesce(p_printing,''))='foil' then 'Showcase Foil'
 when p_product_name ilike '%Showcase%' then 'Showcase'
 when upper(coalesce(p_set_code,''))='3ED' and lower(regexp_replace(coalesce(p_product_name,''),'\s*\([^)]*\)\s*$','','g')) in ('badlands','bayou','plateau','savannah','scrubland','taiga','tropical island','tundra','underground sea','volcanic island') then 'Revised Dual Land'
 when upper(coalesce(p_set_code,''))='SLD' and lower(coalesce(p_product_name,'')) ~ '(yojimbo|ifrit|magus sisters|shiva|bahamut|ramuh|odin|leviathan|alexander)' then 'Final Fantasy Summon / Elemental'
 else case when lower(coalesce(p_printing,''))='foil' then 'Standard Foil' else 'Standard' end end
$$;

create or replace function public.delvin_collectible_tier_v1(p_treatment text) returns text language sql immutable as $$
select case
 when p_treatment in ('Serialized','Neon Ink','Raised Foil','Fracture Foil','Confetti Foil','Oil Slick Raised Foil') then 'chase'
 when p_treatment in ('Galaxy Foil','Surge Foil','Textured Foil','Rainbow Foil','Halo Foil','Gilded Foil','Step-and-Compleat Foil','Retro Frame Foil','Final Fantasy Summon / Elemental','Revised Dual Land') then 'premium'
 when p_treatment in ('Etched Foil','Borderless Foil','Showcase Foil','Extended Art Foil') then 'special'
 else 'base' end
$$;

-- Full production function aggregates collectible cohorts and ranks collectible leaders.
-- Keep repository migration durable with the same public signature and production semantics.
