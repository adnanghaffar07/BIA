# Filter Stage — Carrier Appetite (Travelers Quantum Home 2.0, NJ)

**Status: SPEC vs. BUILD gap tracker. Updated 2026-06-15 — Frank's Open Items 7.1 / 7.2 / 7.3 / 7.6 are resolved and shipped.**
This document maps the *"Filter: Carrier Appetite"* spec (Travelers ruleset #1) against
what is implemented today, identifies what is buildable now vs. blocked, and lists the
decisions still needed from Frank before the remaining blocked rules go live.

> Update (2026-06-15): Frank confirmed the eligibility decisions by email. Implemented and
> typecheck-clean: 3–4 family hard-drop (7.2), flood A/V hard-drop (7.3), a coastal/hurricane
> classifier using the **Plymouth Rock distance-to-coast table for both carriers** (7.1), and the
> **Plymouth Rock ruleset #2** (7.6) corrected against the official AtHome/PPCIC UW guides. Both
> carrier rulesets are now validated against their official manuals (Travelers Quantum 2.0 §II;
> Plymouth Rock AtHome 4/2026). Roof rules (§II.W covering, §II.Y 20-yr) are **coded** but fire only
> when roof data is present — today `roofType`/`roofYear` default to "Unknown" and are set manually
> in the Grade Review panel until the 7.5 vendor lands.
>
> Still open: **7.4** (geographic concentration) and **7.5** (roof-age data source / budget).
> Original decision (2026-06-10) to hold code behind these has been lifted for the resolved items.

---

## 1. Where the build stands

| | Spec ("Filter: Carrier Appetite") | Current code ([carrier.service.ts](../src/services/carrier.service.ts)) |
|---|---|---|
| Rule count | ~50 rules (geo + knockouts + referrals + premium-bearing) | ~12 rules |
| Shape | Config-driven (rules-as-data, editable without redeploy) | Hardcoded in TypeScript |
| Output | `PASS / REFER / FAIL` **+ reason code per rule** (e.g. `TR-II-Y`) | `eligible / review / ineligible` + free-text notes (no codes) |
| Sequencing | Cost-ordered: count → bulk detail → geo gate → structural enrichment → appetite → skip-trace last | Single pass; enrich-all then grade; no count mode, no geo-gate-before-enrich |
| Grade tie-in | A/B/C/D = appetite verdict **×** data completeness | A/B/C/D via critical fields ([grade.service.ts](../src/services/grade.service.ts)); roof age (`roofYear`) **is** now a gate, plus a manual grade override |

**Two gaps, not one:** breadth (50 vs 12 rules) *and* architecture (config table + reason codes + ordering).

---

## 2. Rule-by-rule status

Legend: ✅ implemented · 🟡 partial · ❌ not implemented · 🔒 blocked (no data source yet)

### Part 1 — Geographic / Location (§3)

| Spec rule | Action | Status | Data source / note |
|---|---|---|---|
| Not in NJ | FAIL | 🟡 | Sourcing is ZIP-restricted ([`TARGET_ZIPS`](../src/services/carrier.service.ts)); no explicit NJ rule in the engine |
| FEMA flood zone V/A | FAIL | ✅ | **7.3 resolved** — hard-drop for both carriers (Frank: "hard drop for now," revisit NFIP later). Uses REAPI `floodZone` + `floodZoneType` prefix; FEMA NFHL remains a future refinement |
| Coastal / Hurricane classification | FAIL/PASS | ✅ | **7.1 resolved** — Frank: "use same as Plymouth Rock." [`getCoastalAppetite()`](../src/services/coastDistance.service.ts) applied to **both** carriers: barrier-island ZIP + 2–5 mi = ineligible; mandatory hurricane deductible 1%/2%/5% by distance. Fires when lat/lng present |
| > 7 road miles to fire dept | FAIL | ❌🔒 | Routing API / ISO PPC — no source wired |
| Secondary/seasonal in PPC 9/10/X/W | FAIL | ❌🔒 | PPC lookup — no source wired |
| Not accessible year-round | FAIL | ❌ | Confirm at outreach |

### Part 2A — Hard knockouts (§4A)

| Spec rule | Status | Data source / note |
|---|---|---|
| Roof not replaced within 20 yrs (§II.Y) | 🟡 | **Coded** (Travelers-only; tile/slate exempt) — fires when `roofYear` is known. Auto-population still needs the aerial/permit vendor → **Open Item 7.5**; until then `roofYear` is producer-entered in the Grade Review panel, else the lead sits at the B/C roof gate |
| Roof covering (asbestos/T-lock/wood shake/overlay) (§II.W) | 🟡 | **Coded** carrier-specific (`TRAVELERS_HIGH_RISK_ROOF` vs `PR_HIGH_RISK_ROOF` — tile is ineligible for PR but lifetime-exempt for Travelers) — fires when `roofType` is known. Data source still 7.5 |
| > 2 roof layers (§II.X) | ❌🔒 | Permits / aerial |
| Heating age (oil >25 / gas >35) (§II.AA) | ❌🔒 | Permits / listing / confirm |
| No central heat (§II.Z) | ❌ | Confirm |
| Solid-fuel stove, not pro-installed (§II.BB) | ❌ | Confirm at outreach |
| Knob-and-tube / no breakers (§II.CC) | ❌🔒 | Infer from year built (pre-1950) + confirm |
| Lead/galvanized/polybutylene plumbing (§II.DD) | ❌🔒 | Infer (polybutylene ~1978–96) + confirm |
| Open foundation / not on permanent foundation (§II.J) | ❌🔒 | Aerial + coastal proxy + confirm |
| > 2-family dwelling (§II.K) | ✅ | **7.2 resolved** — `unitsCount > 2` hard-dropped for both carriers (Frank: "hard drop 3–4 family, only source 2-family") |
| Mobile / manufactured home (§II.L) | 🟡 | REAPI `propertyType`; not explicitly excluded by current `RESIDENTIAL_USES` logic |
| Log home (§II.V) | ❌ | REAPI/aerial `constructionType` |
| Poor condition / code violations (§II.I) | ❌🔒 | Aerial / confirm |
| Overhanging / dangerous trees (§II.H) | ❌🔒 | Aerial imagery |
| Unsecured pool (§II.G) | 🟡 | REAPI `pool` flag exists; "secured/fenced" not captured |
| Liability hazards (ramps, debris, solar, golf carts) (§II.G) | ❌ | Confirm at outreach |
| Vacant / unoccupied (§II.T) | ✅ | REAPI `vacant` |
| Non-residential use / B&B / >11mo rental (§II.EE) | 🟡 | `isResidential()` covers use type; rental-months not captured |
| Dangerous dog breed / bite history (§II.B) | ❌ | Outreach questionnaire |
| Non-personal entity w/ business exposure (§II.C/D) | 🟡 | `corporateOwned` → FAIL; does not parse Trust/LLC nuance or "2+ entities / spousal trust" |
| Cov A ≥ $1.5M w/o monitored alarm (§II.M) | 🟡 | Currently **REVIEW** at ≥$1.5M; spec treats it as a knockout absent alarm (alarm not captured) |
| AOP deductible < $1,000 (§II.N) | ❌ | Control at quote, not a lead drop — BIA sets ≥$1,000 |
| Loss history matrix (§II.A) | ❌🔒 | CLUE pull at POS — deferred, compliant |
| Owner-occupied w/ >2 rental buildings (§II.F) | ❌ | Confirm |
| Unsatisfied prior Travelers balance (§II.E) | ❌🔒 | Carrier check at quote |

### Part 2B — Referrals (§4B)

Nearly all are CLUE/loss-history or carrier-check driven and **deferred to POS** (compliant):
weather loss ≥$100k/3yr, non-weather ≥$40k/3yr, open liability loss, prior cancel/nonrenew,
business-in-home, held-for-rent >6mo, farming, historic registry, high-value-cannot-bind,
flat/"other" roof shape, secondary/seasonal ≥$500k w/o alarm. **Status: ❌ — none implemented.**
Most are correctly POS-time or outreach-time, not pre-screen.

### Part 2C — Premium-bearing rating variables (§4C)

These don't knock out but **must be captured for Grade A**. Current grade checks only 9 generic
fields and ignores most of these:

| Captured today (REAPI) | Missing for Grade A (🔒 = needs enrichment vendor) |
|---|---|
| year built, sqft, beds, baths, stories, units, garage, pool flag, construction (partial), basement | roof year/material/shape/hail-rating 🔒, siding, PPC 🔒, protective devices, windstorm/IBHS, heating type/age 🔒, residence type detail |

Discounts worth capturing (§4C): Loss-Free, Early-Quote (rewards the 90-day timing), Multi-Policy
(auto bundle), Affinity/Good-Payer/Partner — **none modeled today.**

---

## 3. Buildable now vs. blocked

**Buildable now (data on hand or derivable — no external dependency):**
- Config-driven rules engine (rules-as-data) + `PASS/REFER/FAIL` + reason codes — pure engineering
- NJ scope, >2-family knockout (REAPI `unitsCount`), mobile/manufactured & log-home exclusion (`propertyType`/`constructionType`), occupancy/vacancy, entity-ownership nuance, value tiers, pre-1940 / 25+ modernization flag
- Distance-to-coast as the **interim** hurricane proxy (already computed) — pending Frank's mile-band cutoffs
- SFHA flood from REAPI boolean (interim, pending FEMA NFHL + Open Item 7.3)
- Representing blocked rules as explicit `needs-info` reason codes that drive Grade B/C
- Reconciling Grade A–D to the spec (FAIL→D, PASS-but-missing→B/C, PASS+complete→A; roof age as a gate placeholder)

**Blocked (needs a data source AND/OR a Frank decision):**
- Roof age/material/layers/shape (aerial/permit vendor — 7.5) — the highest-value knockout
- Hurricane UW Classification table (7.1)
- PPC and road-miles-to-fire (PPC/routing vendor)
- Heating age, wiring, plumbing, foundation, condition, trees (permits/aerial/inference)
- FEMA NFHL flood zone (vs current REAPI boolean) + flood FAIL-vs-REFER policy (7.3)
- CLUE / loss history / prior carrier balance (POS, compliant — by design)

---

## 4. Open Items — need Frank to confirm (gates the blocked rules)

| # | Item | What's needed | Status (2026-06-15) |
|---|---|---|---|
| 7.1 | Hurricane UW Classification | Travelers territory table **or** distance-to-coast proxy | ✅ **Resolved** — use Plymouth Rock distance-to-coast table for both carriers |
| 7.2 | 2-family vs 3–4 family | Hard-drop 3–4 family, or REFER? | ✅ **Resolved** — hard-drop `unitsCount > 2` |
| 7.3 | Flood A/V zones | Hard-drop, or REFER with NFIP flood? | ✅ **Resolved** — hard-drop for now (revisit NFIP later) |
| 7.4 | Geographic concentration | Whitelist NJ counties first, or statewide minus coastal? | ⏳ **Open** — not yet decided |
| 7.5 | Roof-age data source & budget | Pick aerial-imagery / permit vendor | ⏳ **Open** — "let's discuss more"; rules coded, awaiting vendor to auto-populate `roofYear`/`roofType` |
| 7.6 | Plymouth Rock NJ HO | PR appetite/UW guide → ruleset #2 | ✅ **Resolved** — guide received; ruleset corrected to official AtHome/PPCIC guides |

---

## 5. Recommended build sequence (once unblocked)

> Progress (2026-06-15): step 1 (config engine) **not started**; steps 2–3 **largely shipped**
> (buildable-now rules encoded, coastal proxy live, roof age as a B/C gate); step 4 (structural
> enrichment) **blocked on 7.5**; step 5 (Plymouth Rock) **shipped & validated**. The engine is still
> the hardcoded `eligible/review/ineligible` shape — the `PASS/REFER/FAIL` + reason-code refactor
> (step 1) remains the main open engineering item.

1. **Config-driven engine + reason codes** (unblocked) — refactor `eligible/review/ineligible`
   to `PASS/REFER/FAIL` with structured codes; rules stored as editable data.
2. **Encode buildable-now rules** + wire distance-to-coast as interim hurricane proxy (after 7.1).
3. **Reconcile Grade A–D** and make roof age a gating placeholder (`needs-info` until 7.5 vendor lands).
4. **Structural-enrichment stage** once the roof/PPC/heating vendors are chosen (7.5).
5. **Plymouth Rock as ruleset #2** on the same engine (7.6).

Nothing in steps 2–5 requires re-architecting after step 1 — the blocker is data + Frank's decisions, not engineering.

---

*Related: [PROJECT_DOCUMENTATION.md](../PROJECT_DOCUMENTATION.md) (funnel + grade overview) ·
[NEON_DATABASE.md](NEON_DATABASE.md) (schema).*
