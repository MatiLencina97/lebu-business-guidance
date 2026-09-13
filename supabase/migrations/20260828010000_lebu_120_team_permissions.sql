-- Lebu 1.20 — Equipo & Permisos
-- Carga puede crear ventas/gastos, pero sólo editar o borrar (soft-delete) los que creó.
-- Dueño/Admin mantienen control total. Viewer sigue siendo sólo lectura.

begin;

create or replace function public.lebu_audit_movement()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
  mail text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    if uid is not null then
      -- La autoría no se acepta desde el cliente: el usuario autenticado es la fuente de verdad.
      new.created_by := uid;
      new.created_by_email := mail;
    end if;
  else
    -- La autoría original es inmutable incluso para administradores.
    new.created_by := old.created_by;
    new.created_by_email := old.created_by_email;
    new.created_at := old.created_at;
  end if;

  if uid is not null then
    new.updated_by := uid;
    new.updated_by_email := mail;
  end if;
  return new;
end;
$function$;

-- Ventas: Carga sólo toca movimientos propios.
drop policy if exists sales_insert_operator on public.business_sales;
drop policy if exists sales_update_operator on public.business_sales;

create policy sales_insert_operator
on public.business_sales
for insert
to authenticated
with check (
  public.my_business_role(business_id) in ('owner', 'admin')
  or (
    public.my_business_role(business_id) = 'operator'
    and created_by = auth.uid()
  )
);

create policy sales_update_operator
on public.business_sales
for update
to authenticated
using (
  public.my_business_role(business_id) in ('owner', 'admin')
  or (
    public.my_business_role(business_id) = 'operator'
    and created_by = auth.uid()
  )
)
with check (
  public.my_business_role(business_id) in ('owner', 'admin')
  or (
    public.my_business_role(business_id) = 'operator'
    and created_by = auth.uid()
  )
);

-- Gastos: misma regla que ventas.
drop policy if exists expenses_insert_operator on public.business_expenses;
drop policy if exists expenses_update_operator on public.business_expenses;

create policy expenses_insert_operator
on public.business_expenses
for insert
to authenticated
with check (
  public.my_business_role(business_id) in ('owner', 'admin')
  or (
    public.my_business_role(business_id) = 'operator'
    and created_by = auth.uid()
  )
);

create policy expenses_update_operator
on public.business_expenses
for update
to authenticated
using (
  public.my_business_role(business_id) in ('owner', 'admin')
  or (
    public.my_business_role(business_id) = 'operator'
    and created_by = auth.uid()
  )
)
with check (
  public.my_business_role(business_id) in ('owner', 'admin')
  or (
    public.my_business_role(business_id) = 'operator'
    and created_by = auth.uid()
  )
);

commit;
