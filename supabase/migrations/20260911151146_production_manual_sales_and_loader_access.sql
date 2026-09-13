alter table public.business_production_events
  drop constraint if exists business_production_events_event_type_check;

alter table public.business_production_events
  add constraint business_production_events_event_type_check
  check (event_type in ('opening','prep_started','prep_ready','manual_sale','waste','carry','adjustment'));

drop policy if exists production_products_write on public.business_production_products;
create policy production_products_write on public.business_production_products
  for all to authenticated
  using (public.my_business_role(business_id) in ('owner','admin','operator','loader'))
  with check (public.my_business_role(business_id) in ('owner','admin','operator','loader'));

drop policy if exists production_days_write on public.business_production_days;
create policy production_days_write on public.business_production_days
  for all to authenticated
  using (public.my_business_role(business_id) in ('owner','admin','operator','loader'))
  with check (public.my_business_role(business_id) in ('owner','admin','operator','loader'));

drop policy if exists production_events_write on public.business_production_events;
create policy production_events_write on public.business_production_events
  for all to authenticated
  using (public.my_business_role(business_id) in ('owner','admin','operator','loader'))
  with check (public.my_business_role(business_id) in ('owner','admin','operator','loader'));
