-- Lebu 1.22.0 — FUDO Connect
-- Credenciales cifradas server-side + origen externo de ventas.

create table if not exists public.business_fudo_connections (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  api_key_ciphertext text not null,
  api_secret_ciphertext text not null,
  access_token_ciphertext text,
  access_token_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected','error','disconnected')),
  last_sync_at timestamptz,
  last_error text,
  last_sync_sales_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_fudo_connections enable row level security;
revoke all on table public.business_fudo_connections from anon, authenticated;

alter table public.business_sales
  add column if not exists source text not null default 'manual',
  add column if not exists external_id text,
  add column if not exists source_updated_at timestamptz,
  add column if not exists source_metadata jsonb,
  add column if not exists payment_breakdown jsonb;

create unique index if not exists business_sales_external_source_unique
  on public.business_sales (business_id, source, external_id);

create index if not exists business_sales_source_idx
  on public.business_sales (business_id, source, sale_date)
  where deleted_at is null;

comment on column public.business_sales.source is 'manual, fudo u otro origen operativo';
comment on column public.business_sales.external_id is 'ID estable en el sistema de origen; evita duplicados al resincronizar';
comment on column public.business_sales.payment_breakdown is 'Detalle normalizado de pagos/medios del origen; no altera el total económico de la venta';
