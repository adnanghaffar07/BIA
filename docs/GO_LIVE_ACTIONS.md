# Go-live actions — Frank's directive, 24 September 2026

Working record for the two directive emails of 24 Sep. Every number below was checked against
the live database on 24 Sep; where a check has limits, the limits are stated rather than left
for someone to discover.

Nothing in this document has been built. It is the list, not the work.

---

## A · Answers to the three questions Frank put to Abdullah

These were due today. All three are answered, and two of them stop the send.

### A1 · Is the renewal date sourced from a policy, or computed? — **Computed. Every account.**

Frank checked one account. It holds for the whole book.

| | |
|---|---|
| Renewal date falls on the same month and day as the sale date | **9,767 of 9,923 (98.4%)** |
| Grade A in C1–C7 whose renewal date is the sale anniversary | **850 of 850 (100%)** |

3604 Scarecrow Ct: effective date 11 Nov 2026, sale date 11 Nov 2022 — sale plus four years to
the day, exactly as Frank read it.

**Which field drives what:**

- **Cohort assignment** reads `effectiveDate`, via a database trigger that buckets it to the
  Monday of its week. So cohorts are built on the computed date.
- **The renewal date in the copy** would come from the same `effectiveDate`.
- **`renewalTargetDate` is a second, disagreeing date.** It is set on 7,910 accounts and
  **disagrees with `effectiveDate` on all 7,910**. Frank saw this on one record; it is universal.

**Consequence.** Every email in the campaign opens by stating a renewal date that is an
assumption: that the policy anniversary equals the purchase anniversary. True for a policy
bought at closing and never changed; wrong for anyone who switched carrier mid-term.

**Decision needed from Frank before send:** either the copy changes to "as your renewal
approaches" across all eleven bodies, or we accept the assumption knowingly. This is not a
subset — it is 100% of the campaign.

### A2 · Does enrichment write the fields the rated flag reads? — **No, but the flag still can't be trusted.**

Enrichment writes `travelersEligible` / `plymouthEligible` (an eligibility *status*) and the flood
fields. It does **not** write `travelersPremium` / `plymouthPremium`, which is what the rated flag
reads. So Frank's specific fear does not hold.

**A first pass at this said 405 accounts had premiums from nowhere. That was wrong, and the
correction matters.** It counted accounts whose `lastEditedBy` column was empty — a column added
after most of the rating was already done. The audit trail was in the activity history the whole
time.

Of 778 accounts carrying a carrier premium:

- **709 carry evidence of a person entering it** — an activity row logging a card save that
  updated the premium fields ("Status: new → rated · Updated: Travelers Premium, Plymouth
  Premium"), 316 of them attributed to Ruben by name
- **69 have no trace at all** — no editor, no activity mentioning a premium

**Of those 69, 32 are Grade A inside C1–C3.** Those three cohorts lead with the number on email 1.
They would receive a band price on the strength of a premium nobody can be shown to have entered.

| Cohort | Accounts |
|---|---|
| C1 2026-10-05 | 16 |
| C2 2026-10-12 | 9 |
| C3 2026-10-19 | 7 |

So the rated flag is trustworthy on 91% of accounts, not the 48% a first look suggested. Frank's
requested fix — **a source on the rated flag, producer-entered and system-populated in separate
fields, never merged** — is still right, and should be built so this question cannot be asked
again. The 32 are small enough to eyeball before today's send.

### A3 · How many recovered addresses fail a surname match? — **714 of 2,108 (33.9%) — but treat that as an upper bound.**

Across Grade A in C1–C7, 2,108 addresses checked against the insured and co-insured names.

**The test over-flags, and the failures show it:**

| Address | Name on record | Verdict |
|---|---|---|
| `shirleybouchey@gmail.com` | Syeda / Anthony Carson | genuinely a stranger |
| `lperrone1@cox.net` | Rannie / Angie Haddad | genuinely a stranger |
| `catfal73@gmail.com` | **Cat**herine **Fal**lon | almost certainly hers |
| `leawas@gmail.com` | **Lea** Ann Salmieri | hers — failed only on the middle name |

Nicknames, initials and shortened surnames all trip it. **Do not hold out 714 accounts on this
number** — that would drop a third of the campaign, much of it wrongly.

What is needed is the check Frank specified, built properly, with failures going to a review list
a person clears. The upper bound is useful for sizing that review; it is not a send filter.

3604 Scarecrow Ct is worse than Frank described: it carries **two** addresses,
`qthunni96@aol.com` and `dburnette19@gmail.com`, and **neither** matches Garcia.

---

## B · What Frank's reconciliation query settles

He wrote: *"One query settles most of this."* It does.

**Grade A with no producer premium, and what touched them in the last 14 days:**

| Week | Unrated | Re-graded | Isolated | **Recovered** |
|---|---|---|---|---|
| C1 2026-10-05 | 3 | 1 | 2 | 0 |
| C2 2026-10-12 | 1 | 0 | 0 | 0 |
| C3 2026-10-19 | 2 | 2 | 0 | 0 |
| C4 2026-10-26 | 107 | 3 | 0 | **99** |
| C5 2026-11-02 | 82 | 4 | 0 | **71** |
| C6 2026-11-09 | 37 | 18 | 5 | **35** |
| C7 2026-11-16 | 49 | 0 | 0 | **48** |
| **Total** | **281** | 28 | 7 | **253** |

**253 of 281 — 90% — were touched by a skip-trace recovery in the last fourteen days.** The
"unworked backlog" is overwhelmingly accounts that were recovered and written back as unworked.
Frank's diagnosis is right.

**One correction to his email.** He wrote of C7: *"Rated 80, unworked 113. These sum correctly to
the Grade A total, which suggests real backlog rather than corruption — confirm, don't assume."*
Confirmed, and it is **not** backlog: **48 of C7's 49 unrated accounts were recovered inside 14
days**. Same mechanism as every other cohort. The sum reconciling was a coincidence.

C6's three figures are confirmed exactly as he read them: **257 with no pull record, 18 that
entered Grade A without being in the pull, 22 with emails recovered.**

---

## C · Corrected cohort numbers

The tracker's figures are stale on every cohort — its Cohort 1 reads 74 at pull / 45 worked / 37
with email against a true 78 / 62 / 47. Its send calendar is also still on the old
T-21 / T-14 / T-3 cadence, with C1's first email dated 14 September.

Current truth, with the rated split the campaign structure depends on:

| | Renews | A@pull | A now | Rated | Unrated | Insured | Co-ins | No email |
|---|---|---|---|---|---|---|---|---|
| C1 | 2026-10-05 | 78 | 62 | 59 | 3 | 47 | 40 | 5 |
| C2 | 2026-10-12 | 102 | 65 | 64 | 1 | 47 | 52 | 3 |
| C3 | 2026-10-19 | 89 | 57 | 55 | 2 | 39 | 29 | 2 |
| C4 | 2026-10-26 | 243 | 164 | 57 | 107 | 129 | 116 | 12 |
| C5 | 2026-11-02 | 261 | 174 | 92 | 82 | 132 | 129 | 14 |
| C6 | 2026-11-09 | 201 | 136 | 99 | 37 | 115 | 105 | 5 |
| C7 | 2026-11-16 | 302 | 192 | 143 | 49 | 153 | 147 | 12 |
| **Total** | | **1,276** | **850** | **569** | **281** | **662** | **618** | **53** |

**Frank's 662 insureds is exactly right.** Two things follow that his email does not account for:

1. **Total addresses are 1,280, not "likely 800 or more."** One per person, max two per household.
   At the twenty mailboxes his email assumes × 25/day = 500/day, that is **nearly three days**, not
   Day 1 into Day 2. The platform actually shows **28 live mailboxes**, which at 25/day is 700/day
   and does drain in under two days — but the plan and the reality need reconciling before the
   tranche split is set.
2. **C4 is 57 rated against 107 unrated** — the only cohort where unrated outnumbers rated roughly
   two to one. It is mostly an unrated send.

### C1 "rated 48" — already corrected, but not to Frank's number

Fixed on 23 Sep. It was reading the `status` column, which the skip-trace blast overwrites, **and**
counting every grade rather than Grade A only — which is why C2 showed 82 rated against 65 Grade A.
It now reads a carrier premium, exactly as Frank defines rated.

**It produces 59, not the 61 Frank expects.** The three unrated C1 accounts are all condos: one is
the Grade B that moved up (his "one that hasn't been worked"), and two have a system-generated
price but no carrier premium — one of which was marked rated before being pulled for skip tracing.
**Frank needs to choose: 59, 60 or 61.** Two minutes to change once he says.

---

## D · The list

### D1 · Stops the send

| # | Item | Owner | State |
|---|---|---|---|
| 1 | Reply routing tested end to end with a live send | Adnan | open since 20 Sep |
| 2 | Version tracking live in both logs | Adnan | not started |
| 3 | Combined insured-or-co-insured export | **Abdullah** | **built and pushed 24 Sep** |
| 4 | Renewal-date decision — copy changes, or we send the assumption knowingly | **Frank** | answered, awaiting his call |
| 5 | Surname check built with a review list, failures held out | **Abdullah** | sized, not built |
| 6 | Holdout conflict — §1.9 says no holdout, but 85 Grade A accounts in C1–C7 carry the flag and the push skips them | **Abdullah / Frank** | not started |

Item 3 is done. Item 6 is not in Frank's list because he does not know about it: push today and
those 85 are silently dropped, and the first sign is a send count nobody can explain.

### D2 · Today

| # | Item | Owner |
|---|---|---|
| 7 | Answer: which field drives cohort, which populates the renewal date, is it sourced or computed | **Abdullah** — answered in §A1 |
| 8 | Answer: does enrichment write the fields the rated flag reads | **Abdullah** — answered in §A2 |
| 9 | Answer: how many recovered addresses fail the surname check | **Abdullah** — answered in §A3 |
| 10 | Confirm the Grade B filter field before any list is built | **Abdullah** — answered below |

**Grade B filter (item 10).** Frank's instinct was right. The filter reads *both* facts: it does
require the roof year to be unknown, but it also gates on build year — home older than 20 years,
**with no upper bound**.

- Today: **4,720** accounts
- Frank's criterion, 20 < age ≤ 75: **3,779**
- **941 homes over 75 years old are in the list now**, built between **1850 and 1950**

That is exactly the "list of older homes rather than homes with unknown roofs" he feared.
Separately, **219 homes 20 years or newer** with an unknown roof are excluded today — his wording
does not obviously rule those out, so that is a question back to him.

### D3 · Before the first send

| # | Item | Owner | What changed |
|---|---|---|---|
| 11 | Per-mailbox limit raised 10 → 25 | Adnan | — |
| 12 | Booking link on our own domain, writing back to the CRM | Adnan | — |
| 13 | Segment written to the lead record at list build, from producer-entered premium only | **Abdullah** | Each account's track is decided once, when the list is built, from a producer-entered premium and nothing else — 850 accounts are stamped, 569 rated and 281 not — and the decision is frozen, so an account rated between email 1 and email 2 cannot switch tracks mid-sequence. |
| 14 | Subject and CTA assignment, per person, random, balanced within cohort, written to the lead record | **Abdullah** | Every person on the list carries their own subject line and call to action — the insured and the co-insured assigned separately — dealt out evenly within each renewal week rather than by coin flip, so no week's split differs by more than one person; 1,280 people are assigned. |
| 15 | Seed test across every sending domain; authentication, unsubscribe header, plain-text rendering | Zoya | — |
| 16 | Content Versions tab populated | Zoya | — |

On 13 and 14, two things to say before the send rather than after:

- **The segment is decided by a premium, and 88 of the 569 rated accounts carry one nobody
  can be shown to have entered.** They will each receive a band price on that basis. The
  premiums are probably real — most predate the CRM recording who typed them — but that is
  an assumption, not a record. Sending them as rated, moving them to the unrated track, or
  having a producer confirm the 32 with no trace at all is **Frank's call**.
- **Balance is over people who can actually be mailed, not everyone with a name.** The first
  build balanced over all 1,570 named people, which put 290 who have no address into the
  draw and let one week's real split drift to 57/43 — the very split "balanced, not random"
  exists to prevent. Nothing had sent; it was cleared and rebuilt over the 1,280 reachable
  people, and the worst gap went from 13 to 1.

### D4 · Friday 26 September, in writing — the six fixes

Each needs one sentence saying what changed, not "done". All six are built as of 24 September.

| # | Fix | Owner | What changed |
|---|---|---|---|
| 17 | "Recaptured" becomes its own status, never "new", carrying the date and which process returned it | **Abdullah** | Recaptured is now its own state carrying the date and the process, shown **beside** the status rather than replacing it, so an account that was rated before it went quiet reads "Rated · Recaptured" instead of dropping back to New. |
| 18 | Rated flag gets a source — producer-entered and system-populated in separate fields, never merged | **Abdullah** | Every premium now records where it came from: 653 accounts are on record as producer-entered, 125 carry a premium nobody can be shown to have entered, and only a producer-entered one decides which email an account receives. |
| 19 | Cohort populations freeze when the send list is built; later recaptures go to a holding pool | **Abdullah** | A week's population is fixed the moment its send list is built, and anything that comes back afterwards is held out of that cycle and listed separately instead of quietly joining a week that has already been counted and reported. |
| 20 | Skip-trace runs and grading changes logged in real time, with cohort, account count and process | **Abdullah** | Every skip-trace run now writes its own record the moment it starts — the weeks it covered, how many accounts qualified, how many it reached, how many came back — so a run that finds nothing leaves a record rather than no trace at all; grading changes now carry the renewal week alongside the date. |
| 21 | No retroactive change to a worked account without notifying Ruben — daily report of what changed | **Abdullah** | A report is now built every night listing every change the system made to an account somebody had already worked, with a column for whether Ruben was told. |
| 22 | Recapture Log tab — date, cohort, accounts affected, process, whether Ruben was notified | Adnan / Abdullah | A Recapture Log tab lists every account that has come back — date, renewal week, which process returned it, whether it made this cycle, and whether Ruben was told — seeded with the 34 recaptured so far. |

#### Two things in these six that need Frank's decision

**Fix 17 contradicts the instruction of 23 September.** He asked then that pulling a lead for
skip trace must never overwrite its "rated" status, and that is the column fix 17 asks us to
write "Recaptured" into. Thirteen of the 34 recaptured accounts are sitting at rated, so
following fix 17 literally would destroy the exact fact the earlier instruction protects.
Built the way described above instead — both facts kept, and a returned account never reads
as New. **Confirm that is what he meant.**

**What the first nightly report turned up.** On 22 September the grading rules dropped
**31 accounts from A to D** — reason: no phone and no email after skip trace. Twenty-eight of
them already had a premium entered by a producer. All 31 renew between 5 and 26 October
(22 of them in the week of 12 October). Nobody was told at the time; that is the gap fix 21
closes.

Two things worth saying plainly about it:

- **The downgrades were correct.** Every one of the 31 genuinely has no email and no phone,
  insured or co-insured. The rule did the right thing.
- **No number Frank holds is wrong because of it.** The send list was built on 24 September,
  two days after; those accounts were already D and were never in the 850.

**But 28 of them still read "rated" while being Grade D.** The card contradicts itself, and
these are accounts in the weeks we are sending to. Which of the two is authoritative is a
decision, not a fix — **needs Frank**.

#### Still open in this group

There is no channel in the CRM that actually reaches Ruben — no internal email, no Slack.
The nightly report is built and recorded, and "told Ruben" is currently marked by hand by a
named person. Whether that becomes an email, a Slack message, or a tab he checks each
morning needs deciding before Friday.

### D5 · The tracker

| # | Item | Owner |
|---|---|---|
| 23 | Replace §6.2 version labels with the plain-English five columns | Adnan / Zoya |
| 24 | Rebuild the send calendar on the new cadence — all seven cohorts, E1 on 24 Sep | Adnan |
| 25 | Correct every cohort's numbers from §C above | Adnan |
| 26 | Seven new columns on the Daily Send Log, seven on the Prospect Log | Adnan |
| 27 | PAUSE formula re-pointed at the domain row | Adnan |
| 28 | Lists tab — remove "Savings click", add "Premium shared" and the rest | Adnan |
| 29 | Content Versions and Test Results tabs | Zoya |
| 30 | Segment split on Cohort Scorecard and Weekly Review | Adnan |

### D6 · Smaller items Frank raised

| # | Item | Finding |
|---|---|---|
| 31 | Date of birth is synthetic | **Confirmed.** 3604 Scarecrow shows both parties born 1 August, 39 years apart. If it gates anything, it should stop. |
| 32 | Condo with a basement | **Confirmed** on the same record: type CONDO, basement true, showing eligible. |
| 33 | No premium field on the account card | Ruben cannot see rated status from the record he works. |
| 34 | Carrier naming | Copy ships as "the carriers I represent" until Frank says otherwise. |

---

## E · Two things Frank's email does not cover

1. **The holdout conflict** (item 6). §1.9 says no holdout in wave one. 983 accounts carry the flag,
   **85 of them Grade A inside C1–C7**, and the push code skips any flagged account.

2. **The retention target disagrees between his own two spreadsheets.** The real-time tracker's
   Setup tab says Grade A kept after pull = **0.95**. The KPI tracker says **0.87**. The actual
   figure is **65%**. Worth settling which he is holding us to before anything is reported against
   it.
