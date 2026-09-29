import { sql } from '@/lib/neon';

/**
 * Who is eligible to be mailed in an effective-date window.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 * Two things need this answer and they must not answer it differently: the send list, which
 * decides who actually gets written to, and the surname review queue, which decides whose
 * recovered addresses a person has to clear first. A review queue built over a different
 * population than the send is not a control — it is a queue that reports "all clear" about
 * leads it never looked at.
 *
 * It lived inside sendList.service.ts. The review queue could not import it from there
 * without a cycle (sendList already imports heldAddresses back out of the review service),
 * so the alternative was a second copy of the predicate — and the second copy is how this
 * drifts. It sits here instead, imported by both, owned by neither.
 *
 * ── What it had been doing instead ──────────────────────────────────────────
 * The review queue selected on `sendListBuiltAt IS NOT NULL` — a flag stamped when a send
 * list was last exported — and compared its window against `cohort` while this compares
 * against `effectiveDate`. On 29 Sep that was 678 leads against the 842 the send list
 * actually covers: 164 leads whose recovered addresses would be mailed without anyone
 * having checked they belong to the insured.
 */

/**
 * Grade A leads in an effective-date window, with everything the rules need.
 *
 * The column list is written out in the query rather than built from a constant. There had
 * been two copies of it in sendList.service.ts — one inline here and one in a `LEAD_COLS`
 * string kept alive by a `void LEAD_COLS;` statement, unreachable and quietly out of date.
 * A single literal in the one query that uses it cannot drift from itself.
 *
 * householdId is selected because householdScopeKey() PREFERS the stored household and
 * falls back to a derived address key only until materialiseHouseholds() has run.
 * Unselected, it reads as undefined and the fallback is taken for every lead — so a
 * household suppressed under its stored id would not be found. The push was fixed on
 * 28 Sep; this was the other half of the same defect.
 */
export async function loadCandidates(
  effFrom: string,
  effTo: string,
  /**
   * Which book. Defaults to A, which is every existing caller.
   *
   * Grade B is mailed too — email only, off the back of the roof-age blast — so the same
   * question ("who could be written to in this window") has to be askable of it. Frank's
   * surname rule says every skip-trace-recovered address, and it does not say Grade A; on
   * 30 Sep the Grade B trace had recovered 133 addresses of which 53 would have failed that
   * check, and none of them had been looked at because this function could only answer for A.
   */
  grade: 'A' | 'B' = 'A',
): Promise<Record<string, unknown>[]> {
  return await sql`
    SELECT "id","propertyId","cohort","effectiveDate","grade","manualGrade","status",
           "householdId",
           "addressStreet","addressCity","addressState","addressZip",
           "owner1FirstName","owner1LastName","owner2FirstName","owner2LastName",
           "email1","email2","owner2Email","phone1","phone2","owner2Phone",
           "emailsAll","phonesAll","skipTraceData",
           "confirmedEmail","confirmedAt","confirmedVia","confirmedRole"
      FROM "Lead"
     WHERE "effectiveDate" >= ${effFrom} AND "effectiveDate" <= ${effTo}
       AND COALESCE("manualGrade","grade") = ${grade}
     ORDER BY "effectiveDate", "owner1LastName"` as Record<string, unknown>[];
}
