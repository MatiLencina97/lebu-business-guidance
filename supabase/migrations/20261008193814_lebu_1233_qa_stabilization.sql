-- Lebu 1.23.3 — QA stabilization: atomic production flows + safety/performance fixes.

create index if not exists business_production_events_business_product_idx
  on public.business_production_events (business_id, product_id);

create unique index if not exists business_production_opening_unique_idx
  on public.business_production_events (business_id, production_date, product_id)
  where event_type = 'opening';

create unique index if not exists business_production_closure_unique_idx
  on public.business_production_events (business_id, production_date, product_id, event_type)
  where note = 'Cierre del día' and event_type in ('waste', 'carry');

create or replace function public.lebu_start_production_day(
  target_business_id uuid,
  target_date date,
  opening_rows jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  item record;
  existing_closed_at timestamptz;
begin
  if coalesce(public.my_business_role(target_business_id), '') not in ('owner','admin','operator','loader') then
    raise exception 'No tenés permiso para modificar Producción.' using errcode = '42501';
  end if;

  insert into public.business_production_days (business_id, production_date, updated_at)
  values (target_business_id, target_date, now())
  on conflict (business_id, production_date)
  do update set updated_at = excluded.updated_at;

  perform 1
  from public.business_production_days
  where business_id = target_business_id and production_date = target_date
  for update;

  select closed_at into existing_closed_at
  from public.business_production_days
  where business_id = target_business_id and production_date = target_date;

  if existing_closed_at is not null then
    raise exception 'La jornada ya está cerrada. Reabrila antes de modificar la apertura.';
  end if;

  for item in
    select *
    from jsonb_to_recordset(coalesce(opening_rows, '[]'::jsonb))
      as x(id bigint, product_id bigint, quantity numeric)
  loop
    if item.id is null or item.product_id is null or coalesce(item.quantity, 0) <= 0 then
      continue;
    end if;

    insert into public.business_production_events (
      id, business_id, product_id, production_date, event_type,
      quantity, occurred_at, note, created_by, updated_at
    )
    values (
      item.id, target_business_id, item.product_id, target_date, 'opening',
      item.quantity, now(), 'Disponibilidad al abrir', auth.uid(), now()
    )
    on conflict do nothing;
  end loop;
end;
$function$;

create or replace function public.lebu_close_production_day(
  target_business_id uuid,
  target_date date,
  closure_rows jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  item record;
  existing_closed_at timestamptz;
  closed_now timestamptz := now();
begin
  if coalesce(public.my_business_role(target_business_id), '') not in ('owner','admin','operator','loader') then
    raise exception 'No tenés permiso para modificar Producción.' using errcode = '42501';
  end if;

  insert into public.business_production_days (business_id, production_date, updated_at)
  values (target_business_id, target_date, closed_now)
  on conflict (business_id, production_date)
  do update set updated_at = excluded.updated_at;

  perform 1
  from public.business_production_days
  where business_id = target_business_id and production_date = target_date
  for update;

  select closed_at into existing_closed_at
  from public.business_production_days
  where business_id = target_business_id and production_date = target_date;

  if existing_closed_at is not null then
    return;
  end if;

  for item in
    select *
    from jsonb_to_recordset(coalesce(closure_rows, '[]'::jsonb))
      as x(product_id bigint, waste numeric, carry numeric, waste_id bigint, carry_id bigint)
  loop
    if item.product_id is null then
      continue;
    end if;

    if coalesce(item.waste, 0) > 0 and item.waste_id is not null then
      insert into public.business_production_events (
        id, business_id, product_id, production_date, event_type,
        quantity, occurred_at, note, created_by, updated_at
      )
      values (
        item.waste_id, target_business_id, item.product_id, target_date, 'waste',
        item.waste, closed_now, 'Cierre del día', auth.uid(), closed_now
      )
      on conflict do nothing;
    end if;

    if coalesce(item.carry, 0) > 0 and item.carry_id is not null then
      insert into public.business_production_events (
        id, business_id, product_id, production_date, event_type,
        quantity, occurred_at, note, created_by, updated_at
      )
      values (
        item.carry_id, target_business_id, item.product_id, target_date, 'carry',
        item.carry, closed_now, 'Cierre del día', auth.uid(), closed_now
      )
      on conflict do nothing;
    end if;
  end loop;

  update public.business_production_days
  set closed_at = closed_now, updated_at = closed_now
  where business_id = target_business_id and production_date = target_date;
end;
$function$;

create or replace function public.lebu_reopen_production_day(
  target_business_id uuid,
  target_date date
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if coalesce(public.my_business_role(target_business_id), '') not in ('owner','admin','operator','loader') then
    raise exception 'No tenés permiso para modificar Producción.' using errcode = '42501';
  end if;

  perform 1
  from public.business_production_days
  where business_id = target_business_id and production_date = target_date
  for update;

  delete from public.business_production_events
  where business_id = target_business_id
    and production_date = target_date
    and note = 'Cierre del día'
    and event_type in ('waste','carry');

  update public.business_production_days
  set closed_at = null, updated_at = now()
  where business_id = target_business_id and production_date = target_date;
end;
$function$;

revoke all on function public.lebu_start_production_day(uuid,date,jsonb) from PUBLIC, anon;
revoke all on function public.lebu_close_production_day(uuid,date,jsonb) from PUBLIC, anon;
revoke all on function public.lebu_reopen_production_day(uuid,date) from PUBLIC, anon;
grant execute on function public.lebu_start_production_day(uuid,date,jsonb) to authenticated;
grant execute on function public.lebu_close_production_day(uuid,date,jsonb) to authenticated;
grant execute on function public.lebu_reopen_production_day(uuid,date) to authenticated;

revoke execute on function public.lebu_guard_cash_effects() from PUBLIC, anon, authenticated, service_role;

drop policy if exists sales_insert_operator on public.business_sales;
create policy sales_insert_operator
on public.business_sales for insert
to authenticated
with check (
  public.my_business_role(business_id) = any (array['owner'::text,'admin'::text])
  or (public.my_business_role(business_id) = 'operator'::text and created_by = (select auth.uid()))
);

drop policy if exists sales_update_operator on public.business_sales;
create policy sales_update_operator
on public.business_sales for update
to authenticated
using (
  public.my_business_role(business_id) = any (array['owner'::text,'admin'::text])
  or (public.my_business_role(business_id) = 'operator'::text and created_by = (select auth.uid()))
)
with check (
  public.my_business_role(business_id) = any (array['owner'::text,'admin'::text])
  or (public.my_business_role(business_id) = 'operator'::text and created_by = (select auth.uid()))
);

drop policy if exists expenses_insert_operator on public.business_expenses;
create policy expenses_insert_operator
on public.business_expenses for insert
to authenticated
with check (
  public.my_business_role(business_id) = any (array['owner'::text,'admin'::text])
  or (public.my_business_role(business_id) = 'operator'::text and created_by = (select auth.uid()))
);

drop policy if exists expenses_update_operator on public.business_expenses;
create policy expenses_update_operator
on public.business_expenses for update
to authenticated
using (
  public.my_business_role(business_id) = any (array['owner'::text,'admin'::text])
  or (public.my_business_role(business_id) = 'operator'::text and created_by = (select auth.uid()))
)
with check (
  public.my_business_role(business_id) = any (array['owner'::text,'admin'::text])
  or (public.my_business_role(business_id) = 'operator'::text and created_by = (select auth.uid()))
);
