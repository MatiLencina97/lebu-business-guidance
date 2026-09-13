# Architecture overview

Lebu is a production-oriented business guidance application built around a Next.js frontend/server layer and Supabase as the persistence, authentication and authorization platform.

## Main layers

- **Next.js App Router** — UI, server routes and deployment target.
- **Supabase Auth** — account/session identity.
- **PostgreSQL + Row Level Security** — multi-business data isolation and role-aware access.
- **Domain modules** — sales, expenses, recurring costs, cash guidance, production/waste and business insights.
- **Integration layer** — FUDO adapter isolated server-side; credentials are encrypted before persistence.
- **Push/cron layer** — server-side notification snapshots and scheduled delivery.
- **PWA layer** — manifest, service worker, offline shell and installable assets.

## Authorization model

The team model distinguishes business roles such as owner, admin, operator/data-entry and read-only access. Authorization is enforced both in the application and in PostgreSQL RLS policies; UI checks are not treated as the security boundary.

Useful evidence in this repository:

- `supabase/migrations/20260828010000_lebu_120_team_permissions.sql` — role-aware write policies for sales and expenses.
- `supabase/migrations/20260911145709_production_and_waste_v1.sql` — RLS enabled on production domain tables plus select/write policies.
- `supabase/migrations/20260911151146_production_manual_sales_and_loader_access.sql` — policy evolution for operational roles.

## Integration security

FUDO API credentials are handled server-side and are never exposed through `NEXT_PUBLIC_*`. The adapter is isolated in `src/lib/fudo-server.ts`, including credential encryption/decryption and token handling.

## Data integrity patterns

The project includes explicit handling for:

- external IDs and idempotent synchronization;
- recurring-expense reconciliation to avoid double counting;
- cash-impact safety rules;
- historical period comparison without inventing unavailable granularity;
- production/waste events separated from sales truth.

## Repository note

This is a portfolio snapshot of an actively evolving product. Database migrations show the real evolution of the beta schema and security policies; they are included primarily as implementation evidence rather than as a one-command greenfield bootstrap.
