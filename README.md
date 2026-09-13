# Lebu

**Business guidance SaaS for small businesses — built with Next.js, TypeScript, Supabase and Vercel.**

Lebu helps a business owner answer a practical question: **what needs attention today to stay on track toward a profit goal?** It combines sales, expenses, recurring commitments, cash context and operating patterns, then turns them into understandable guidance instead of acting as a traditional accounting or POS system.

> Portfolio snapshot of a real product in active beta. Sensitive credentials, production identifiers and private operational data have been removed from this public repository.

## Why this project matters

Lebu started as a daily sales-target calculator and evolved into a multi-user cloud product with authentication, role-based access, PostgreSQL/RLS security, imports, integrations, scheduled notifications and domain-specific analysis.

The project demonstrates end-to-end product engineering: data modeling, authorization, APIs, external integrations, business rules, frontend UX, PWA behavior and production deployment.

## Tech stack

- **Next.js 16 / React 19 / TypeScript**
- **Supabase** — PostgreSQL, Auth and Row Level Security
- **Vercel** — deployment and scheduled jobs
- **Tailwind CSS 4**
- **Web Push / VAPID**
- **SheetJS** for Excel imports
- **FUDO integration layer** for POS synchronization

## Core capabilities

### Profit goals and dynamic pacing
Users define a weekly, biweekly or monthly profit target and the days the business actually operates. Lebu recalculates the required pace as real sales and expenses arrive.

### Multi-user cloud workspace
Businesses can work with multiple users and roles. Access control is enforced at both application and database level.

Representative RLS implementation:

- [`20260828010000_lebu_120_team_permissions.sql`](supabase/migrations/20260828010000_lebu_120_team_permissions.sql) — role-aware write access for sales and expenses.
- [`20260911145709_production_and_waste_v1.sql`](supabase/migrations/20260911145709_production_and_waste_v1.sql) — RLS-protected production/waste tables.
- [`20260911151146_production_manual_sales_and_loader_access.sql`](supabase/migrations/20260911151146_production_manual_sales_and_loader_access.sql) — policy evolution for operational users.

### Business insight engine — “Mirada”
Lebu compares equivalent periods, evaluates pace, detects recurring patterns and surfaces one primary observation instead of overwhelming the user with dashboards.

The implementation deliberately avoids false precision: when the data is insufficient for a reliable conclusion, the product exposes that uncertainty rather than inventing a recommendation.

Relevant code:

- [`src/app/MiradaView.tsx`](src/app/MiradaView.tsx)
- [`src/app/mirada.ts`](src/app/mirada.ts)
- [`src/app/financial-diagnosis.ts`](src/app/financial-diagnosis.ts)
- [`src/app/commercial-opportunities.ts`](src/app/commercial-opportunities.ts)

### Cash-flow guidance
Economic performance and available cash are modeled separately. Lebu tracks confirmed/estimated cash effects, upcoming recurring commitments and reconciliation adjustments without assuming that gross sales equal available cash.

Relevant code and migrations:

- [`src/app/cashflow.ts`](src/app/cashflow.ts)
- [`20260828112500_add_cashflow_guidance.sql`](supabase/migrations/20260828112500_add_cashflow_guidance.sql)
- [`20260828144500_cash_reconciliation_adjustments.sql`](supabase/migrations/20260828144500_cash_reconciliation_adjustments.sql)

### Excel / POS data ingestion
Users can import historical operational data from spreadsheets. The import path handles normalization and duplicate prevention, while the FUDO integration uses external IDs so repeated synchronization can update existing records instead of duplicating them.

Relevant code:

- [`src/app/MovementImportModal.tsx`](src/app/MovementImportModal.tsx)
- [`src/app/import-utils.ts`](src/app/import-utils.ts)
- [`src/lib/fudo-server.ts`](src/lib/fudo-server.ts)
- [`src/app/api/integrations/fudo/sync/route.ts`](src/app/api/integrations/fudo/sync/route.ts)

### Production and waste tracking
A newer domain module records daily production availability, additions during the day, manual unit sales when product-level POS data is unavailable, and end-of-day waste signals. The goal is to help a business distinguish products that should remain available from those that routinely generate waste.

Relevant code:

- [`src/app/ProductionView.tsx`](src/app/ProductionView.tsx)
- [`src/app/production.ts`](src/app/production.ts)
- [`20260911145709_production_and_waste_v1.sql`](supabase/migrations/20260911145709_production_and_waste_v1.sql)

### PWA and notifications
Lebu is installable as a PWA and includes service-worker/offline support plus configurable web-push notifications driven by server-side canonical snapshots.

Relevant code:

- [`src/app/PwaRegister.tsx`](src/app/PwaRegister.tsx)
- [`public/sw.js`](public/sw.js)
- [`src/lib/push-server.ts`](src/lib/push-server.ts)
- [`src/app/api/cron/morning-push/route.ts`](src/app/api/cron/morning-push/route.ts)

## Architecture

```text
Browser / PWA
     │
     ├── Next.js UI
     │      ├── Goals & movements
     │      ├── Mirada / guidance
     │      ├── Production & waste
     │      └── Team / admin
     │
     ├── Supabase Auth
     │
     └── Next.js server routes
              │
              ├── Supabase PostgreSQL
              │      └── Row Level Security
              │
              ├── FUDO adapter
              └── Web Push / scheduled jobs
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for additional implementation notes.

## Security decisions demonstrated here

- Database authorization through **RLS**, not only hidden UI controls.
- Server-only service-role credentials.
- Server-side encrypted storage for third-party API credentials.
- Explicit business/role checks in privileged API routes.
- Idempotent external synchronization using external identifiers.
- `.env` files excluded from version control; only `.env.example` is public.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open `http://localhost:3000`.

A real Supabase project and the required environment variables are necessary for cloud/authenticated functionality. Optional integrations such as FUDO and Web Push require their own credentials.

## Production

The product is designed for Vercel deployment and a Supabase backend. The public portfolio version intentionally contains no production secrets or private customer data.

## Project status

Active beta / portfolio snapshot. The repository reflects an evolving real-world product, including incremental SQL migrations and production-oriented business rules.

## Author

**Matías Lencina** — Backend / Full-Stack Developer  
Focus: APIs, integrations, business logic, cloud backends and production-oriented web applications.

## License

Copyright © 2026 Matías Lencina. All rights reserved. This repository is shared for portfolio and evaluation purposes; no open-source license is granted.
