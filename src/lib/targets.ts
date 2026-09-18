/**
 * Targets the CRM is measured against.
 *
 * Kept in their own module with no imports because both the server services and the
 * client pages need them. A page importing a value (not a type) from a service drags
 * that service's whole import graph into the browser bundle — importing this constant
 * from cohortLedger.service pulled in @/lib/neon and the QC page died on "No database
 * connection string was provided".
 */

/** Frank, Sep-2026: no more than 5% of a cohort's Grade A may be lost. */
export const LOST_TARGET_PCT = 5;
