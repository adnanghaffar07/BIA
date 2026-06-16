# Neon Database — Setup & Architecture

## Overview

The BIA CRM uses [Neon](https://neon.tech) as its production Postgres database.
Neon is a serverless Postgres platform that scales to zero when idle and scales
up instantly on demand — a perfect fit for a Next.js application.

---

## Connection

### Connection String

The connection string is stored in `.env` at the project root:

```
DATABASE_URL="postgresql://neondb_owner:<password>@ep-nameless-violet-apifeub2-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require"
```

The hostname contains `-pooler`, meaning it routes through Neon's built-in
PgBouncer connection pooler. This is the correct endpoint to use in a
serverless/Next.js environment.

### Driver

We use Neon's own native driver — **`@neondatabase/serverless`** — instead of
a traditional ORM like Prisma.

```ts
// src/lib/neon.ts
import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL!);
```

Every query is a plain HTTP request. There is no persistent TCP connection,
which means:

- No "connection closed" errors from Neon's 5-minute idle timeout
- No connection pool configuration needed
- Works in Edge and Node.js runtimes

---

## Why We Moved Away from Prisma

The project initially used Prisma ORM with SQLite (development), then Prisma
with Neon Postgres. Prisma was removed because:

| Problem | Detail |
|---|---|
| Memory OOM | Node.js heap reached 7.5 GB — Prisma's `rawData` field stored full API objects (salesHistory, taxHistory arrays) of 100 KB+ each |
| Connection closed | `Error { kind: Closed, cause: None }` — Prisma uses a persistent TCP connection; Neon kills idle connections after 5 minutes |
| Weight | Prisma client is 30 MB+ with generated code |
| Complexity | Required `DIRECT_URL` for migrations, `pgbouncer=true` flag, `connection_limit=1` |

`@neondatabase/serverless` replaced all of this with a single 50 KB package and
a one-line client.

---

## Database Schema

> **There is no ORM and no migration tool.** The schema is plain SQL applied
> directly to Neon. The original `Lead`/`Activity` tables came from an early
> Prisma migration that has since been removed; all tables are now created and
> evolved by the bootstrap scripts in `scripts/` (and, for `AppConfig`, by the
> app itself at runtime). This document is the single source of truth for the
> schema — keep it in sync when columns change.

### Schema bootstrap order

Run these once against a fresh Neon database (each is idempotent —
`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`):

| Step | Script / source | Creates |
|---|---|---|
| 1 | `scripts/create-auth-tables.mjs` | `User`, `Session` (+ `Session_token_idx`) |
| 2 | `scripts/seed-superadmin.mjs` | First `superadmin` row in `User` |
| 3 | `scripts/seed-from-reapi.mjs` (or `POST /api/admin/seed`) | `Lead`, `Activity`, `AppConfig`; ingests + enriches leads; sets the `api_seeded` lock |
| 4 | `scripts/add-coast-variance-columns.mjs` | 5 coast/variance columns on `Lead` |

The funnel columns (§10A–§10E) are applied by the SQL in
`scripts/seed-from-reapi.mjs` as part of step 3. `AppConfig` is also created
on demand by `POST /api/admin/seed`, and `GET /api/leads` treats a missing
`AppConfig` table as "not yet seeded", so the app self-heals if a step is skipped.

### Tables

#### `Lead`

Stores every NJ homeowner lead ingested from the Real Estate API.

| Column group | Columns |
|---|---|
| Identity | `id`, `propertyId` (unique) |
| Address | `addressStreet`, `addressCity`, `addressState`, `addressZip`, `addressCounty`, `addressFull` |
| Mail address | `mailStreet`, `mailCity`, `mailState`, `mailZip` |
| Property details | `propertyType`, `propertyUse`, `yearBuilt`, `squareFeet`, `bedrooms`, `bathrooms`, `stories` |
| Amenities | `garage`, `pool`, `deck`, `patio`, `basement`, `airConditioning` |
| Financial | `estimatedValue`, `assessedValue`, `lastSaleAmount`, `openMortgageBalance`, `estimatedEquity` |
| Owner | `owner1LastName`, `owner1FirstName`, `ownerOccupied`, `corporateOwned`, `absenteeOwner` |
| Property conditions | `vacant`, `preForeclosure`, `foreclosure`, `reo`, `floodZone`, `hoa` |
| Skip trace | `skipTraced`, `skipTracedAt`, `phone1`, `phone2`, `email1`, `email2` |
| CRM pipeline | `engine` (1 = New Purchase, 2 = Renewal), `renewalTargetDate`, `grade` (A–D), `status` |
| Sourcing (§10A) | `sourceVendor` (default `reapi`), `cohortTag` |
| Rating readiness (§10B) | `roofYear`, `constructionType`, `protectionClass`, `priorCarrier`, `priorPremium`, `indicativeBasis` |
| Carrier eligibility | `travelersEligible`, `travelersNotes` (JSONB), `plymouthEligible`, `plymouthNotes` (JSONB) |
| Indicative premium | `lowPremium`, `expectedPremium`, `highPremium`, `pricingConfidence` |
| Coastal exposure | `coastDistanceMiles`, `coastExposure` |
| Producer workflow (§10D) | `producerEmail`, `queueEnteredAt`, `firstRpcAt`, `contactAttempts` (default 0), `authorizationDate`, `authorizationMethod` |
| Quote/bind & variance (§10E) | `posQuoteNumber`, `posCarrier`, `posQuotePremium`, `quotedAt`, `boundPremium`, `boundDate`, `variancePct`, `varianceAmount`, `varianceReason`, `varianceNotes`, `lostReason`, `lostStage` |
| Raw API data | `rawData` (JSONB) — slimmed version, large arrays stripped |
| Timestamps | `createdAt`, `updatedAt` |

#### `Activity`

Tracks every action taken on a lead (notes, status changes, quote submissions).

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | UUID generated by `crypto.randomUUID()` |
| `leadId` | TEXT | Foreign key → `Lead.id` |
| `type` | TEXT | Activity type (e.g. `note`, `status_change`, `quote_submitted`) |
| `content` | TEXT | Human-readable description |
| `metadata` | JSONB | Optional structured data |
| `createdBy` | TEXT | Producer email or system identifier |
| `createdAt` | TIMESTAMP | Auto-set on insert |

#### `User`

Application users. Created by `scripts/create-auth-tables.mjs`.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `email` | TEXT UNIQUE | Login identifier (lowercased) |
| `passwordHash` | TEXT | bcrypt hash |
| `name` | TEXT | Display name |
| `role` | TEXT | `admin` or `superadmin` (default `admin`) |
| `isActive` | BOOLEAN | Default `true`; `false` revokes login |
| `createdBy` | TEXT | `id` of the superadmin who created this user |
| `createdAt` / `updatedAt` | TIMESTAMP | Auto-set |

#### `Session`

Server-side session records for JWT revocation. Created by `scripts/create-auth-tables.mjs`.

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID |
| `userId` | TEXT | FK → `User.id` `ON DELETE CASCADE` |
| `token` | TEXT UNIQUE | JWT; indexed via `Session_token_idx` |
| `expiresAt` | TIMESTAMP | Session expiry (7 days) |
| `createdAt` | TIMESTAMP | Auto-set |

Every authenticated request validates the cookie JWT *and* checks that a
matching, unexpired `Session` row exists, so logout / deactivation takes
effect immediately.

#### `AppConfig`

Key/value config store. Created on demand by `POST /api/admin/seed`
(and `scripts/seed-from-reapi.mjs`).

| Column | Type | Description |
|---|---|---|
| `key` | TEXT PK | e.g. `api_seeded` |
| `value` | TEXT | e.g. `'true'` |
| `updatedAt` | TIMESTAMP | Auto-set |

The `api_seeded` row is the **REAPI hard lock** — once set, the app serves
leads from the DB and never calls the Real Estate API again. Reset with
`DELETE /api/admin/seed` or `scripts/reset-lock.mjs`.

---

## Key Design Decisions

### rawData is slimmed before storage

The Real Estate API response includes large nested arrays
(`salesHistory`, `taxHistory`, `priorMortgages`, `ownerHistory`, `liens`)
that can reach 100–200 KB per property. We strip these before writing:

```ts
function slimRawData(property: any) {
  const { salesHistory, taxHistory, priorMortgages, ownerHistory, liens, ...rest } = property;
  return { ...rest, currentMortgage: currentMortgages?.[0] ?? null };
}
```

### rawData excluded from list queries

`getLeadsFromDb()` selects all columns **except** `rawData`. This keeps
list-view payloads small (< 5 KB per lead instead of 100+ KB).
`getLeadByPropertyId()` returns `rawData` for the single-lead detail view.

### Deduplication rule

| Scenario | Action |
|---|---|
| New `propertyId` | INSERT new lead |
| Same `propertyId`, same owner last name | UPDATE — refresh API fields, preserve all CRM fields |
| Same `propertyId`, different owner last name | INSERT new lead with composite id (`propertyId-recordingDate`) |

### Dashboard summary is one query

`getPipelineSummary()` uses a single SQL `COUNT(*) FILTER (WHERE ...)` query
instead of 8 separate round-trips:

```sql
SELECT
  COUNT(*)                                    AS total,
  COUNT(*) FILTER (WHERE "engine" = 1)        AS engine1,
  COUNT(*) FILTER (WHERE "grade" = 'A')       AS "gradeA",
  ...
FROM "Lead"
```

---

## Files

| File | Purpose |
|---|---|
| `.env` | `DATABASE_URL` — Neon connection string |
| `src/lib/neon.ts` | Neon SQL client singleton (`sql` + `pool`) |
| `src/services/storage.service.ts` | All DB read/write operations |
| `scripts/create-auth-tables.mjs` | Creates `User` + `Session` |
| `scripts/seed-superadmin.mjs` | Seeds the first superadmin |
| `scripts/seed-from-reapi.mjs` | Creates `Lead`/`Activity`/`AppConfig`, ingests + enriches, sets lock |
| `scripts/add-coast-variance-columns.mjs` | Adds coast/variance columns to `Lead` |
| `scripts/reset-lock.mjs` | Clears the `api_seeded` REAPI lock |

---

## Replacing Credentials

When production credentials are ready, replace `DATABASE_URL` in `.env`:

```env
DATABASE_URL="postgresql://<user>:<password>@<host>/<dbname>?sslmode=require"
```

No code changes are needed — `src/lib/neon.ts` reads the env var at startup.
