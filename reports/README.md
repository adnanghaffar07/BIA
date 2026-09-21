# Frozen cohort baselines

Directive Sec. 1 / task 29: *"Every historical figure is restated under these boundaries
once, then frozen."*

## What is frozen, and what is not

Each `cohort-baseline-YYYY-MM-DD.csv` is the cohort table exactly as it read on that date,
committed so it cannot be quietly rewritten. It is the number everyone quotes from. The
live CRM keeps moving — a trace lands, a producer regrades — and that is correct; what
must not move is the agreed figure a decision was taken against.

To produce a new one:

```bash
node --import ./scripts/lib/register-ts.mjs scripts/cohort-table.mjs --csv > reports/cohort-baseline-$(date +%F).csv
```

Never edit a baseline that already exists. Add a new one and say which is current.

## Boundaries

Canonical 7-day windows, inclusive at both ends, no shared boundary date — C1 is
2026-10-05 … 2026-10-11. The CRM already stores cohorts this way (Monday-anchored), so
nothing needed restating; the `legacy` column carries the old 8-day label ("10/05–10/12")
for anyone reconciling against the workbooks, where a lead effective 10/12 fell into two
cohorts and was counted twice.

## The `check` column

Each cohort is tested four ways before it is written:

1. the four contactability values sum to Grade A now
2. still-A plus left-A equals Grade A at pull
3. every lead that left Grade A has a logged reason
4. no Grade A lead is contactable by neither channel

`FAIL (n)` means n of those did not hold. It is left in rather than cleaned up, because
the point of a frozen baseline is that it records what was true, including what was wrong.

As of 2026-09-21 the failures are all rule 4 — leads sitting at Grade A with no phone and
no email anywhere on the card, which the grading rule says should be D. C7 also fails rule
3 with 5 leads that left Grade A without a logged reason.

## 2026-09-21

The first baseline. Taken after C3 and C7 were skip traced that morning (181 leads, 93
gained an insured email), so C7 reads 58.4% rather than the 22.4% it showed on Saturday.
Total emailable across C1–C7: **661**.
