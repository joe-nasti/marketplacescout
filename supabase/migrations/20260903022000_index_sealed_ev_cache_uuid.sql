-- Cover the sealed product foreign key and the primary Scout cache lookup path.
create index if not exists sealed_product_executable_ev_cache_sealed_uuid_idx
  on public.sealed_product_executable_ev_cache(sealed_uuid);

