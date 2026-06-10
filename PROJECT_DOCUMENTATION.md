# BIA CRM — Project Documentation

A personal-lines insurance CRM built for BIA (Bound Insurance Agency) on Next.js 16, React 19, TypeScript, and Material-UI v9. The system sources NJ homeowner leads from the Real Estate API, runs automated carrier eligibility checks and indicative pricing, and routes qualified leads to the producer queue.

**Last updated: June 9, 2026**

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [The Two-Funnel Model](#the-two-funnel-model)
4. [Data Model](#data-model)
5. [Services](#services)
6. [API Routes](#api-routes)
7. [Pages](#pages)
8. [Components](#components)
9. [Database Migrations](#database-migrations)
10. [Environment Variables](#environment-variables)
11. [Getting Started](#getting-started)
12. [Outstanding Work](#outstanding-work)

---

## Architecture Overview

```
REAPI (public records)
        │
        ▼
POST /api/admin/seed         ← one-time seed, locked after first run
        │
        ▼
upsertLeads()                ← dedup by propertyId + owner
        │
        ▼
enrichLeadBatch()
  ├── checkCarrierEligibility()   → travelersEligible / plymouthEligible
  ├── calculateLeadGrade()        → A / B / C / D
  ├── calculateIndicativePremium() → low / expected / high premium
  └── calculateCoastDistance()    → coastDistanceMiles / coastExposure
        │
        ▼
Neon Postgres ("Lead" table)
        │
        ▼
Producer Queue (/queue)      ← Grade A only, sorted by x-date, bound/lost excluded
        │
        ▼
Lead Detail (/leads/[id])    ← producer records contact, authorization, POS quote, bind
        │
        ▼
Dashboard (/dashboard)       ← live funnel counts from getPipelineSummary()
```

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── leads/
│   │   │   ├── route.ts              GET (list) + POST (advanced search)
│   │   │   └── [id]/route.ts         GET (single) + PUT (update + auto-stamps)
│   │   ├── dashboard/route.ts        GET — live pipeline funnel counts
│   │   └── admin/
│   │       ├── seed/route.ts         POST — trigger REAPI seed (locked after first run)
│   │       └── users/                Admin user management
│   ├── dashboard/page.tsx            Live funnel dashboard
│   ├── queue/page.tsx                Producer lead queue (active + closed tabs)
│   ├── leads/
│   │   ├── page.tsx                  Full leads list
│   │   └── [id]/page.tsx             Lead detail + producer workflow
│   ├── login/page.tsx                Authentication
│   ├── layout.tsx                    Root layout (AppRouterCacheProvider + AuthProvider)
│   └── globals.css
│
├── components/
│   ├── LayoutWrapper.tsx             Auth guard + sidebar/navbar shell
│   ├── Navbar.tsx                    Top bar with user info
│   ├── Sidebar.tsx                   Side navigation
│   ├── LeadsTable.tsx                Queue table (status, grade, x-date, carriers, premium)
│   ├── LeadGradeBadge.tsx            A/B/C/D badge
│   ├── CarrierEligibilityBadge.tsx   Travelers / Plymouth Rock chips
│   └── PropertyDetailsContent.tsx   Expanded row detail
│
├── services/
│   ├── storage.service.ts            DB read/write — upsertLeads, getLeadsFromDb, updateLead
│   ├── enrichment.service.ts         Orchestrates carrier + grade + pricing + coast
│   ├── carrier.service.ts            Travelers & Plymouth Rock eligibility rules
│   ├── grade.service.ts              A/B/C/D grading logic
│   ├── pricing.service.ts            Indicative premium calculation
│   ├── pipeline.service.ts           Engine assignment (1=New Purchase, 2=Renewal)
│   └── coastDistance.service.ts     Coastal exposure calculation
│
├── types/
│   ├── lead.ts                       Lead, LeadStatus, LostReason, LostStage, AuthorizationMethod
│   ├── carrier.ts                    CarrierEligibilityResult
│   ├── grade.ts                      LeadGrade
│   ├── pricing.ts                    IndicativePremium
│   └── activity.ts                   Activity log entry
│
├── lib/
│   ├── neon.ts                       Neon Postgres client (sql + pool)
│   ├── auth.ts                       JWT session helpers
│   └── constants.ts                  Target ZIPs, status options, table columns
│
├── context/
│   └── AuthContext.tsx               isAuthenticated, user, login, logout, isLoading
│
└── utils/
    ├── formatAddress.ts              Address + currency formatters
    └── csvExport.ts                  CSV download utility
```

---

## The Two-Funnel Model

Per Frank's *BIA Pipeline Funnel Sizing & CRM Data Requirements* document.

### Funnel 1 — Sourcing (Raw → Quote-Ready)

| Stage | Rate | Cumulative | CRM field |
|-------|------|-----------|-----------|
| Raw records pulled | 100% | 100% | `COUNT(*)` |
| In-appetite | ~40% | 40% | `grade IN ('A','B','C')` |
| Rating-complete | ~60% | 24% | `grade = 'A'` |
| Contactable | ~55% | 13% | `grade='A' AND (phone1 IS NOT NULL OR email1 IS NOT NULL)` |
| = Quote-ready | ~13% of raw | — | `grade = 'A'` |

### Funnel 2 — Producer (Quote-Ready → Bound)

| Stage | Rate | CRM field |
|-------|------|-----------|
| Quote-ready | 100% | `grade = 'A'` |
| Right-party contact | ~40% | `status IN ('contacted',…)` |
| Authorized to quote | ~33% | `authorizationDate IS NOT NULL` |
| Quoted (POS) | ~88% | `posQuoteNumber IS NOT NULL` |
| Bound | 78–95% | `status = 'bound'` |

---

## Data Model

### Lead table — key field groups

#### Identity & Sourcing
| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID |
| `propertyId` | TEXT UNIQUE | REAPI key |
| `sourceVendor` | TEXT | `reapi` / `auto` / `referral` |
| `cohortTag` | TEXT | Monthly batch tag e.g. `2026-06-Monmouth-HO` |
| `createdAt` | TIMESTAMP | When lead entered system |
| `renewalTargetDate` | TIMESTAMP | Estimated x-date — queue sort key |
| `engine` | INTEGER | 1 = New Purchase, 2 = Renewal/Win-Back |

#### Property & Appetite
Key columns: `addressStreet`, `addressCity`, `addressZip`, `yearBuilt`, `squareFeet`, `estimatedValue`, `propertyType`, `propertyUse`, `floodZone`, `floodZoneType`, `ownerOccupied`, `corporateOwned`, `vacant`, `foreclosure`, `reo`

Rating fields (§10B): `roofYear`, `constructionType`, `protectionClass`, `priorCarrier`, `priorPremium`, `indicativeBasis`

#### Carrier Eligibility & Grade
| Column | Type | Values |
|--------|------|--------|
| `travelersEligible` | TEXT | `eligible` / `ineligible` / `review` |
| `travelersNotes` | JSONB | Array of reason strings |
| `plymouthEligible` | TEXT | `eligible` / `ineligible` / `review` |
| `plymouthNotes` | JSONB | Array of reason strings |
| `grade` | TEXT | `A` / `B` / `C` / `D` |

#### Indicative Pricing
| Column | Type | Notes |
|--------|------|-------|
| `lowPremium` | FLOAT | Conservative estimate |
| `expectedPremium` | FLOAT | Mid-point estimate — shown to producer |
| `highPremium` | FLOAT | High-end estimate |
| `pricingConfidence` | INTEGER | 0–100 based on available inputs |

#### Contact (skip trace)
`phone1`, `phone2`, `email1`, `email2`, `skipTraced`, `skipTracedAt`

Pending: `phoneLineType`, `dncStatus`, `consentStatus`, `emailValid`

#### Producer Workflow (§10D)
| Column | Type | Set by |
|--------|------|--------|
| `status` | TEXT | Producer — new/contacted/qualified/quote_sent/bound/lost |
| `queueEnteredAt` | TIMESTAMP | Auto — when grade first = A |
| `firstRpcAt` | TIMESTAMP | Auto — first `new → contacted` transition |
| `contactAttempts` | INTEGER | Auto-incremented on each contact transition |
| `authorizationDate` | TIMESTAMP | Producer |
| `authorizationMethod` | TEXT | Producer — verbal/web/email |

#### Quote, Bind & Variance Loop — The Moat (§10E)
| Column | Type | Notes |
|--------|------|-------|
| `posQuoteNumber` | TEXT | POS quote reference |
| `posCarrier` | TEXT | Carrier quoted |
| `posQuotePremium` | FLOAT | **Actual POS dollar quote** — left side of variance |
| `quotedAt` | TIMESTAMP | Auto-stamped when posQuoteNumber first saved |
| `boundPremium` | FLOAT | Final bound premium |
| `boundDate` | TIMESTAMP | Auto-stamped on `→ bound` transition |
| `varianceAmount` | FLOAT | `boundPremium − expectedPremium` ($) |
| `variancePct` | FLOAT | `(posQuotePremium − expectedPremium) / expectedPremium` (%) — auto-computed |
| `varianceReason` | TEXT | roof_age / prior_claims / coastal_surcharge / etc. |
| `varianceNotes` | TEXT | Free-text producer note |

#### Disposition (§10E — non-negotiable)
| Column | Type | Values |
|--------|------|--------|
| `lostReason` | TEXT | price / no_contact / not_authorized / out_of_appetite / bought_elsewhere / not_interested / other |
| `lostStage` | TEXT | in_appetite / rating_complete / right_party / authorization / quoted / unknown |

#### Activity log (`Activity` table)
Every status change, note, and bound event is logged. Columns: `id`, `leadId`, `type`, `content`, `metadata` (JSONB), `createdBy`, `createdAt`.

---

## Services

### `carrier.service.ts`
Implements Travelers Quantum Home 2.0 and Plymouth Rock (AtHome Insurance) NJ eligibility rules. Hard disqualifiers: non-residential, corporate-owned, vacant, foreclosure, REO, SFHA flood zones. Review flags: high value, pre-1940 construction, investor/absentee owner.

### `grade.service.ts`
- **D** — fails all carriers
- **C** — passes ≥1 carrier, 2+ critical fields missing
- **B** — passes ≥1 carrier, exactly 1 critical field missing
- **A** — passes ≥1 carrier, all critical fields present (Quote-Ready)

Critical fields: owner last name, street, ZIP, estimated value, year built, square feet. Non-critical (grade B): city, property type, bedrooms.

### `pricing.service.ts`
Rule-based indicative premium. Inputs: `estimatedValue` (base rate 0.5%), `yearBuilt` (age factor), `squareFeet` (size factor), `floodZone/Type` (flood factor), `pool` (liability), `ownerOccupied` (occupancy discount). Confidence score 0–100 based on available inputs.

### `pipeline.service.ts`
- **Engine 1** — New Purchase: mortgage recording date ≤ 90 days ago
- **Engine 2** — Renewal/Win-Back: mortgage date 2022–2025, contact 90 days before anniversary

### `storage.service.ts`
- `upsertLeads()` — dedup by propertyId + owner; CRM fields protected from API overwrites
- `getLeadsFromDb()` — supports engine/grade/status filters, `excludeStatuses` (active queue), `orderBy: 'xdate'` (producer priority sort)
- `updateLead()` — all CRM-managed fields
- `getPipelineSummary()` — single query returning all funnel stage counts for dashboard
- `addActivity()` — append to activity log

### `enrichment.service.ts`
Orchestrator called after every REAPI ingest. Runs carrier check → grading → pricing → coast distance → writes results back to DB.

---

## API Routes

### `GET /api/leads`
| Param | Values | Effect |
|-------|--------|--------|
| `source` | `db` | Skip REAPI, return from DB |
| `active` | `true` | Exclude `bound` and `lost` (active queue) |
| `closed` | `true` | Return only `bound` and `lost` |
| `orderBy` | `xdate` | Sort by `renewalTargetDate ASC NULLS LAST` |
| `grade` | `A/B/C/D` | Filter by grade |
| `status` | any status | Filter by status |
| `size` | integer | Limit (default 100) |

### `PUT /api/leads/[id]`
Auto-stamps on save:
- `firstRpcAt` — when status moves `new → contacted` for the first time
- `contactAttempts` — incremented on each `contacted`/`qualified` transition
- `quotedAt` — when `posQuoteNumber` is first set
- `variancePct` — computed from `posQuotePremium` and `expectedPremium`
- `boundDate` — when status moves to `bound` for the first time

### `GET /api/dashboard`
Returns `getPipelineSummary()` — all funnel stage counts in one DB query.

---

## Pages

### `/dashboard`
Live pipeline dashboard with:
- 4 KPI cards: Raw / In-Appetite / Quote-Ready / Bound
- Funnel 1 table (Sourcing) with step rates, cumulative %, and actual counts
- Funnel 2 table (Producer) with same structure
- Grade breakdown card (A/B/C/D)
- Engine breakdown card (Engine 1 / Engine 2 / Unassigned) + producer progress

### `/queue`
Three tabs:
- **Quote Ready** — Grade A, active (not bound/lost), sorted by x-date proximity
- **Needs Information** — Grade B/C, active, sorted by x-date
- **Closed** — Bound + lost leads for variance review

Table columns: Status (color-coded chip) · Grade · Owner · Address · City/State · X-Date (red + ⚠ if ≤30 days) · Pipeline · Carriers · Est. Premium · Est. Value · Sq Ft · Actions

### `/leads/[id]`
Three-column layout:
1. **Property Details** + Financials
2. **Carrier Eligibility** + Indicative Premium + Coastal Exposure
3. **Pipeline info** + **Producer Workflow**

Producer Workflow section:
- Lead Status dropdown
- POS Quote #, Carrier, POS Quote Premium (with live POS vs indicative variance preview)
- Authorization Method (visible when status ≥ qualified)
- Bound Premium + variance tracking
- **Lost Reason + Lost Stage** (required dropdowns — visible only when status = lost)
- Producer Note (logged to activity)
- **Save** (stay) + **Save & Next** (save and navigate to next priority lead)

---

## Components

### `LeadsTable`
- Status column with color-coded chips and row background tinting by status
- Left border accent on all touched (non-new) leads
- X-date column with urgency highlighting (≤30 days = red + ⚠)
- Expandable rows for full property detail
- Pagination, CSV export

### `LayoutWrapper`
- Auth guard: redirects unauthenticated users to `/login`
- `mounted` + `isLoading` guard prevents hydration mismatch
- Renders Navbar + Sidebar only when authenticated

---

## Database Migrations

| Migration | Date | Changes |
|-----------|------|---------|
| `20260605111932_init_neon_postgres` | Jun 5 2026 | Initial schema — Lead + Activity tables |
| `20260609000001_add_funnel_fields` | Jun 9 2026 | 17 new columns: `sourceVendor`, `cohortTag`, `roofYear`, `constructionType`, `protectionClass`, `priorCarrier`, `priorPremium`, `indicativeBasis`, `queueEnteredAt`, `firstRpcAt`, `contactAttempts`, `authorizationMethod`, `posQuotePremium`, `quotedAt`, `variancePct`, `lostReason`, `lostStage` |

---

## Environment Variables

| Variable | Location | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | `.env` | Neon Postgres connection string |
| `NEXT_PUBLIC_REAL_ESTATE_API_KEY` | `.env.local` | REAPI public key |
| `NEXT_PUBLIC_REAL_ESTATE_USER_ID` | `.env.local` | REAPI user identifier |
| `JWT_SECRET` | `.env` | Session token signing |

---

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Production build
npm run build
npm start
```

Navigate to `http://localhost:3000`. Login with admin credentials, then:
1. Go to `/admin/seed` to trigger the one-time REAPI data pull (locked after first run)
2. Go to `/queue` to see the producer queue
3. Go to `/dashboard` to see live funnel metrics

---

