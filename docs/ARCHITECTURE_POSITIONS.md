# Architecture positions — Pivot Directive Sec. 11.5

**Prepared for:** Frank
**Date:** 21 Sep 2026
**Covers:** the six questions in Sec. 11.5, each answered as a position with its reasoning, its cost, and what it means for the ribbon.

Every number in this document is measured from the live database today, not estimated. Where I don't know something, it says so.

---

## The state of the record, as of today

Worth having before the answers, because two of the questions assume things about the schema.

| Table | Rows | Size | What it holds |
|---|---:|---:|---|
| `Lead` | 9,937 | 42 MB | the card — current state, 238 columns |
| `Activity` | 4,025 | 2.4 MB | the narrative log, every action |
| `GradeChange` | 417 | 336 kB | grade transitions, from/to/when/why |
| `CallAttempt` | 1 | 80 kB | call dispositions (panel went live today) |
| `OutreachEvent` | 0 | 160 kB | sends, opens, clicks, replies, bounces |
| `CtaResponse` | 0 | 80 kB | CTA link clicks and address confirmations |
| `Suppression` | 0 | 80 kB | do-not-contact, scoped to person or household |
| `CampaignPause` | 0 | 48 kB | sequence holds |

The four empty tables are built, indexed and wired to the webhook receiver. They are empty because no tranche has been sent yet — they fill the moment the first campaign fires. They are not dead code.

`Activity` grows at 250–1,200 rows a week today with **no** email traffic at all. That is the baseline the volume question below is measured against.

---

## 1. Where outreach events live

**Position: a separate append-only event store, joined on lead ID. Not more columns on the lead table.** This is already how it is built, and I would defend it rather than change it.

**Why not extend the lead table.** `Lead` is 238 columns and 42 MB across 9,937 rows — roughly 3 KB per row. Forty-three of those columns are already outreach-shaped (`currentEmailStep`, `campaignLastSentAt`, `campaignRepliedAt`, `bandHit`, `lostReason`, and so on). Two problems with adding more:

- **Mechanical.** Postgres rewrites the entire row on every update. A wider lead table makes every unrelated edit — a producer changing a phone number — more expensive, forever.
- **Structural, and this is the real one.** A column holds only the *last* value. `campaignRepliedAt` holds one reply; a second reply overwrites the first and the first is gone. Every question the directive asks about outreach is a question about a *sequence* — how many attempts, on how many days, in what order, through which mailbox. Columns cannot answer those. Rows can.

**The division of labour.** The lead table holds current state: what a producer needs when they open a card, in one fast row read. The event store holds history: append-only, never updated in place. Current state is a **cache** of the event stream. When the two disagree, the events win and the cached column is rebuilt from them.

That rule matters, because "two places computing the same number and disagreeing" has been the recurring defect in this codebase — the ledger's Recovered column, the household key, and the premium gap were all instances of it. Naming one side authoritative is how you stop having the argument.

**Query performance at hundreds of thousands of events.**

Forecast: about 250 leads pulled a week × 3 email steps × roughly 4 events each (send, open, click, reply-or-bounce) ≈ **3,000 events a week**, plus call attempts. That is ~150,000 a year and ~500,000 in three years. So the question is the right one to ask, on roughly that timescale.

At that size:

- **The card read is a non-issue.** `OutreachEvent` has a btree on `leadId`; fetching one lead's forty events out of 500,000 is an index lookup — sub-millisecond, and it does not degrade with table size in any way you would notice.
- **The aggregates are where the cost lands** — the cohort ledger, the Sec. 10.7 dashboard, band accuracy. Those group across the whole table. Three mitigations, in the order we will actually need them:
  1. **Now, done:** the composite and partial indexes already in place — `(vendorCampaignId, recipientEmail)`, `cohort`, and a partial index on `(vendorCampaignId, leadId, personRole, emailStep)` that enforces no-double-send.
  2. **At the dashboard (Sec. 10.7):** a nightly rollup keyed by `(cohort, step, day)`, so the dashboard reads hundreds of rows rather than hundreds of thousands. Half a day's work, and it also makes the numbers stable — a dashboard that re-computes from raw events gives a slightly different answer on every refresh.
  3. **Past a few million rows:** partition by month. We will not reach this at New Jersey volume inside the plan horizon, and I would rather not build it speculatively.

**One thing to fix now, and it is cheap.** `Activity` has **only a primary-key index** — nothing on `leadId`, nothing on `createdAt`. Every lead card opens by filtering it on `leadId`. At 4,025 rows that is invisible; at 100,000 it is a full table scan on every card open, and the page will feel slow with no obvious cause. Two indexes, about ten minutes. I would like to do this regardless of what else is decided here.

---

## 2. How the household is modelled

**Position: a stored parent record, materialised by the algorithm that currently derives it.** Today it is neither of the two options in the question — it is derived at read time — and that should change, though not this week.

**What exists now.** Household membership is computed on demand: a union-find that joins leads sharing a normalised property address *or* an email address. It was the right call for shipping, and it is the wrong thing to keep.

**Why not a flag on related leads.** A flag gives you N rows that all have to agree, and nothing whose job it is to make them agree. Household-level facts need somewhere to live: the confirmed mailing address, the suppression scope, which person is insured and which is co-insured, the "one household, one conversation" rule. With a flag, each of those is duplicated per lead and drifts.

**Why not keep deriving it.** Derivation means the household key is a *function*, and changing the function silently rewrites history. This already bit us: `normaliseStreet` stripped unit numbers, collapsed five condominium units into a single household, and dropped four real owners — caught, but only by looking. When the key is stored, changing the function is a migration you can see, diff and reverse. When it is derived, yesterday's suppression scope quietly stops matching today's household and nothing raises its hand.

**Shape.** A `Household` record (id, address key, confirmed mailing address and when it was confirmed, suppression scope) with a nullable `householdId` on the lead. The same union-find runs at pull time and whenever an address changes, and a nightly mismatch report re-derives and compares — so a divergence surfaces as a report line rather than as a wrong send.

**One caveat worth stating plainly.** Insured and co-insured are both *leads* today. The data model is a property model with owner names attached; there is no person entity. A household parent record makes the household explicit but does not make people explicit. If the ribbon eventually needs a person's history to follow them between properties — a homeowner who moves and stays a customer — that is a third entity, and I would defer it. It is not needed for anything in this directive, and the underlying property data does not support it well enough to be worth the complexity.

**Cost:** about a day, plus a backfill across 9,937 leads. **Timing:** during a gap between cohorts, not while a tranche is in flight.

---

## 3. Versioning card state for point-in-time reconstruction

**Position: store transitions for the fields that get audited. Do not snapshot the card.**

Snapshotting a 238-column row on every change would multiply the largest table in the database by its edit rate, in order to answer questions nobody asks about most of those columns. Nobody will ever need to audit what square footage we believed on 14 September.

**The rule.** For each field where a question of the form *"what was this on date X"* will genuinely be asked, store the transition — not the state. In practice that is a short list: grade, the band published to the homeowner, campaign step, suppression status, contactability, household membership. Everything else is a property fact, and its current value is the only one that matters.

**We already do this, and it works.** `GradeChange` has 417 rows holding from-grade, to-grade, when, source, and a link to the causing activity. "What grade was this lead when we emailed it" is answerable today by replay. The generalisation is one table shape — `(leadId, field, from, to, changedAt, source, actor, causeEventId)` — so that auditing a new field becomes a row, not a new table and new code.

**Reconstruction cost** is the current value plus the transitions since the target date: for one lead, tens of rows. This is cheap precisely because it is narrow.

**The one place a snapshot is correct, and we already take it.** `publishedBandLow` / `publishedBandHigh` / `publishedBandAt`. When we tell a homeowner "$2,000–2,400", that number must be frozen at the moment we said it — because band accuracy measures the quote against *what the homeowner read*, not against what we would rate them today. The test suite has a case for exactly this: a quote that falls inside the current band still counts as a **miss** against the published one. Without the snapshot, re-rating a lead would silently improve our historical accuracy, which is the kind of number that looks fine and is worthless.

**What this buys and what it does not.** It buys: reconstruct the card as of the day we sent email 2, for the fields the audit is about, at almost no storage cost. It does not buy: byte-exact replay of the whole record. If that is ever genuinely required — a regulatory demand, say — it is a nightly dump to cold storage, which is a job to run, not a constraint to design around.

---

## 4. Address confirmation propagating across active sequences

The honest answer has two halves with different latencies, and the second one is where the risk is.

**Inside the CRM: immediate and atomic.** The webhook receiver writes the confirmation, the household scope and the resulting suppression in a single transaction. From the vendor's POST to the CRM being fully consistent is one round trip — tens of milliseconds. There is no queue and no window in which half a household is suppressed and half is not.

**On the vendor side: seconds, best-effort, and bounded by the send schedule.** The sending tool is a separate system holding its own copy of the recipient list. Stopping a sibling's sequence means an API call per sibling. Three things worth knowing about that:

1. **Normal latency is seconds** — webhook delivery plus our call. But it is best-effort: if the vendor errors we retry, and if the retry also fails, that sibling stays active.
2. **The worst case is set by the send schedule, not by us.** If a confirmation arrives thirty seconds before a sibling's scheduled send, that send may still go. Across three emails in a seven-day window the exposure is small, but it is not zero, and I would rather state it than imply a guarantee we do not have.
3. **Stopping a sibling deletes the vendor's record of it.** Our `OutreachEvent` rows survive, which is the strongest practical argument for the event store being ours rather than the vendor's: their history is mutable by our own stop actions, and ours is not.

**What I would add to make this a promise rather than a hope:** a reconciliation sweep every fifteen minutes that lists active vendor recipients, diffs them against our suppression set, and stops anything that should already have stopped. That turns "usually within seconds, occasionally never" into "always converged within fifteen minutes" — a weaker-sounding claim that is actually true. About half a day.

**One thing that is already right:** the CTA links are HMAC-signed opaque tokens, so a confirmation arriving by link click is authenticated and cannot be forged by a forwarded email. That matters more than it sounds — a confirmation permanently redirects where a household's mail goes.

---

## 5. What the ribbon needs from HawkSoft, and where the boundary sits

**The boundary I would draw: the CRM owns everything up to bind; HawkSoft owns everything from bind onward; the ribbon is the join, and it flows one direction at a time.**

**CRM owns** the property universe, grading and eligibility, cohorts, outreach and its history, contactability and suppression, call attempts, quotes issued, and losses. All pre-customer. An agency management system has no opinion about a homeowner who never replied, and should not.

**HawkSoft owns** the bound policy, written premium, endorsements, renewals, cancellations, claims. The system of record for an actual customer.

**What the ribbon must bring back from HawkSoft — in priority order:**

1. **Bind confirmation** — policy number, carrier, written premium, effective date, keyed to our lead ID. This single feed closes every open loop in the directive at once: band accuracy stops inferring won-versus-lost, the cohort ledger gets a real conversion rate instead of a proxy, and a bound household drops out of the outreach universe rather than being cold-emailed about a policy we have just written for them.
2. **Renewal dates for the existing book** — so the cohort machinery built for cold leads can work the book too. This is the highest-value item in the entire ribbon and the one nothing has been built for yet.
3. **Cancellation and non-renewal** — a lost customer becomes a lead again and should re-enter at the correct cohort rather than being re-discovered by accident.

**What flows the other way:** the lead record at the moment of bind — owner, property, appended data, and the outreach history that produced the sale. Pushed once, at bind. Not synchronised continuously.

**Why one direction at a time.** Two systems that both believe they own the customer record is the most dependable way to manufacture a data-integrity problem, and it is never noticed until the numbers have been wrong for a month. Bind is a clean handoff: we are authoritative before it, they are after it, and the only continuing flow back is lifecycle events that HawkSoft is unambiguously the source of.

**The blocking unknown — and it is the one question I need answered.** I do not know **what interface we actually have to HawkSoft**. It exposes an API on some plans and a scheduled file export on others, and those are very different builds — days apart in effort and quite different in reliability. I would rather not size this on a guess. If someone can tell me which plan the agency is on, or put me in front of whoever administers it, I can cost it properly.

---

## 6. The minimum viable ribbon before the next cohort cycle

Cohorts are seven-day windows, so the next one opens **Monday 28 September** — five working days. Scoping to that honestly means the first version of the ribbon is manual, and I think that is the right call rather than a concession.

**In scope:**

1. **A stable external key and a `boundPolicy` record.** The thing that makes a bind recordable at all. Does not depend on HawkSoft in any way.
2. **Manual bind entry on the lead card** — policy number, carrier, written premium, effective date. Producers are already in the card logging calls and quote outcomes; this is one more panel beside them.
3. **Bound → suppressed, household-wide.** A customer must stop receiving cold outreach the moment they bind. Of everything here, this is the one whose absence becomes visible to a customer.
4. **The two `Activity` indexes** from question 1.

**Deferred, deliberately:**

- **Any live HawkSoft connection**, until the interface question above is answered.
- **Renewal-date import for the existing book.** The biggest prize in this document — and a data migration with its own QC pass, not a five-day item. It deserves its own plan.
- **Bidirectional sync**, in the continuous form question 5 hints at. Not later — not at all.
- **The household parent record.** I want it, and question 2 argues for it, but it is a schema change with a backfill across 9,937 leads. Running that in the week the first real tranche is in flight is the wrong risk for the return. Target the gap after cohort 2.

**The reasoning behind the manual version.** At current volume the ribbon's value is almost entirely in *closing the measurement loop*, not in saving keystrokes. A handful of binds a week typed into a panel gives a true conversion rate on Monday the 28th. An API integration gives the identical number in November. Build the manual version now and automate it when the book work starts and the volume justifies it.

---

## Open questions I need answers to

1. **Which HawkSoft interface do we have** — API, or file export? Blocks any real sizing of question 5.
2. **Owner-change handling** (directive task 26). The property ID is unique, so when a property changes hands the new owner's record collides with the old one and is currently dropped. It is now *visible* rather than silent, but the schema fix needs a decision: keep one row per property and version the owner, or allow multiple leads per property. That is a modelling call with consequences for the household work in question 2, so the two should be decided together.
