create table if not exists public.business_production_products (
  id bigint primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  unit_cost numeric(14,2),
  shelf_life text not null default 'same_day' check (shelf_life in ('same_day','carry','durable')),
  sale_aliases jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create unique index if not exists business_production_products_name_active_idx
  on public.business_production_products (business_id, lower(name))
  where active = true;

create table if not exists public.business_production_days (
  business_id uuid not null references public.businesses(id) on delete cascade,
  production_date date not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, production_date)
);

create table if not exists public.business_production_events (
  id bigint primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id bigint not null,
  production_date date not null,
  event_type text not null check (event_type in ('opening','prep_started','prep_ready','waste','carry','adjustment')),
  quantity numeric(12,3) not null check (quantity <> 0),
  occurred_at timestamptz not null default now(),
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, product_id) references public.business_production_products(business_id, id) on delete cascade
);

create index if not exists business_production_events_business_date_idx
  on public.business_production_events (business_id, production_date, occurred_at);
create index if not exists business_production_events_product_date_idx
  on public.business_production_events (product_id, production_date);

alter table public.business_production_products enable row level security;
alter table public.business_production_days enable row level security;
alter table public.business_production_events enable row level security;

drop policy if exists production_products_select on public.business_production_products;
create policy production_products_select on public.business_production_products
  for select to authenticated using (public.is_business_member(business_id));
drop policy if exists production_products_write on public.business_production_products;
create policy production_products_write on public.business_production_products
  for all to authenticated
  using (public.my_business_role(business_id) in ('owner','admin','operator'))
  with check (public.my_business_role(business_id) in ('owner','admin','operator'));

drop policy if exists production_days_select on public.business_production_days;
create policy production_days_select on public.business_production_days
  for select to authenticated using (public.is_business_member(business_id));
drop policy if exists production_days_write on public.business_production_days;
create policy production_days_write on public.business_production_days
  for all to authenticated
  using (public.my_business_role(business_id) in ('owner','admin','operator'))
  with check (public.my_business_role(business_id) in ('owner','admin','operator'));

drop policy if exists production_events_select on public.business_production_events;
create policy production_events_select on public.business_production_events
  for select to authenticated using (public.is_business_member(business_id));
drop policy if exists production_events_write on public.business_production_events;
create policy production_events_write on public.business_production_events
  for all to authenticated
  using (public.my_business_role(business_id) in ('owner','admin','operator'))
  with check (public.my_business_role(business_id) in ('owner','admin','operator'));
