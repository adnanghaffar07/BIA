import sql, { pool } from '@/lib/neon';
import { LeadStatus } from '@/types/lead';
import { assignPipelineEngine, getRenewalTargetDate } from './pipeline.service';

// ─── Column lists ────────────────────────────────────────────────────────────

/** All Lead columns except rawData — used for list queries to keep responses small */
const LEAD_COLS = [
  'id', 'propertyId', 'addressStreet', 'addressCity', 'addressState', 'addressZip',
  'addressCounty', 'addressFull', 'mailStreet', 'mailCity', 'mailState', 'mailZip',
  'propertyType', 'propertyUse', 'propertyUseCode', 'landUse', 'yearBuilt', 'squareFeet',
  'lotSquareFeet', 'bedrooms', 'bathrooms', 'stories', 'unitsCount', 'roomsCount',
  'garage', 'pool', 'deck', 'patio', 'basement', 'airConditioning',
  'estimatedValue', 'assessedValue', 'lastSaleAmount', 'lastSaleDate',
  'estimatedEquity', 'openMortgageBalance', 'originalMortgageAmount', 'lenderName', 'mortgageType',
  'owner1LastName', 'owner1FirstName', 'companyName', 'ownerOccupied',
  'corporateOwned', 'absenteeOwner', 'investorBuyer',
  'vacant', 'preForeclosure', 'foreclosure', 'reo', 'highEquity',
  'floodZone', 'floodZoneType', 'floodZoneSubtype', 'floodSfha', 'floodZoneManual', 'floodCheckedAt',
  'hoa', 'latitude', 'longitude', 'fips', 'apn',
  'recordingDate', 'lastUpdateDate', 'skipTraced', 'skipTracedAt',
  'phone1', 'phone2', 'email1', 'email2', 'engine', 'renewalTargetDate', 'grade',
  'travelersEligible', 'travelersNotes', 'plymouthEligible', 'plymouthNotes',
  'travelersEligibilityReason', 'plymouthEligibilityReason',
  'travelersEligibilityDetail', 'plymouthEligibilityDetail',
  'indicativeBandLow', 'indicativeBandHigh',
  // Owner-name verification against the municipal tax roll
  'ownerVerifyStatus', 'ownerVerifyName', 'ownerVerifySource', 'ownerVerifyAt', 'ownerVerifyDetail',
  'lowPremium', 'expectedPremium', 'highPremium', 'pricingConfidence', 'status',
  'producerEmail', 'posQuoteNumber', 'posCarrier', 'boundPremium', 'boundDate',
  'authorizationDate', 'coastDistanceMiles', 'coastExposure',
  'varianceNotes', 'varianceReason', 'varianceAmount',
  // §10A sourcing
  'sourceVendor', 'cohortTag',
  // §10B rating
  'roofYear', 'roofType', 'constructionType', 'protectionClass', 'priorCarrier', 'priorPremium', 'indicativeBasis',
  // §10D producer workflow
  'queueEnteredAt', 'firstRpcAt', 'contactAttempts', 'authorizationMethod',
  // §10E moat
  'posQuotePremium', 'quotedAt', 'variancePct', 'lostReason', 'lostStage',
  // manual grade override + revisit + competitor capture
  'manualGrade', 'gradeOverrideReason', 'gradeOverrideBy', 'gradeOverrideAt',
  'revisitFlag', 'revisitDate', 'revisitNote',
  'competitorCarrier', 'competitorPremium',
  // Frank Jun-2026: dual insureds + DOB, confirm-on-call, home features
  'owner2FirstName', 'owner2LastName', 'owner2Phone', 'owner2Email', 'maritalStatus', 'owner1Dob', 'owner2Dob',
  // Skip-trace REAPI DOB (age-derived, name-matched to the insured)
  'reapiDob', 'reapiAge',
  'dogBreed', 'insuranceHistory', 'heatingRenovatedYear', 'bathroomsFull', 'bathroomsHalf',
  'garageType', 'garageCount', 'sidingType', 'foundationType', 'heatSource', 'feetFromHydrant',
  'burglarAlarm', 'fireAlarm', 'sprinklerSystem', 'smokeDetector', 'waterSensor',
  'autoWaterShutoff', 'lowTempSensor', 'leedCertified', 'effectiveDate',
  // Phase 5: editable carrier pricing + close-out
  'travelersPremium', 'plymouthPremium', 'assignedCarrier', 'doNotRevisit',
  // Phase 5b: Home Upgrades + basement finish
  'basementFinishedPct', 'bathroomGrade', 'kitchenCount', 'kitchenGrade', 'propertyTypeMismatch',
  // Producer-edit tracking (Recently Edited tab)
  'lastEditedAt', 'lastEditedBy',
  'createdAt', 'updatedAt',
] as const;

const LEAD_COLS_SQL = LEAD_COLS.map((c) => `"${c}"`).join(', ');

/** CRM fields that must NOT be overwritten when re-ingesting API data */
const CRM_ONLY_FIELDS = new Set([
  'status', 'grade', 'skipTraced', 'skipTracedAt',
  'phone1', 'phone2', 'email1', 'email2',
  'travelersEligible', 'travelersNotes', 'plymouthEligible', 'plymouthNotes',
  'travelersEligibilityReason', 'plymouthEligibilityReason',
  'travelersEligibilityDetail', 'plymouthEligibilityDetail',
  'indicativeBandLow', 'indicativeBandHigh',
  // Owner-name verification against the municipal tax roll
  'ownerVerifyStatus', 'ownerVerifyName', 'ownerVerifySource', 'ownerVerifyAt', 'ownerVerifyDetail',
  'lowPremium', 'expectedPremium', 'highPremium', 'pricingConfidence',
  'producerEmail', 'posQuoteNumber', 'posCarrier', 'boundPremium', 'boundDate', 'authorizationDate',
  'coastDistanceMiles', 'coastExposure', 'varianceNotes', 'varianceReason', 'varianceAmount',
  // new funnel fields
  'sourceVendor', 'cohortTag',
  'roofYear', 'roofType', 'constructionType', 'protectionClass', 'priorCarrier', 'priorPremium', 'indicativeBasis',
  'queueEnteredAt', 'firstRpcAt', 'contactAttempts', 'authorizationMethod',
  'posQuotePremium', 'quotedAt', 'variancePct', 'lostReason', 'lostStage',
  'manualGrade', 'gradeOverrideReason', 'gradeOverrideBy', 'gradeOverrideAt',
  'revisitFlag', 'revisitDate', 'revisitNote',
  'competitorCarrier', 'competitorPremium',
  // FEMA flood (authoritative source) + manual override — REAPI must never clobber
  'floodZone', 'floodZoneType', 'floodZoneSubtype', 'floodSfha', 'floodZoneManual', 'floodCheckedAt',
  // Frank Jun-2026: producer/skip-trace-entered — never clobber on REAPI re-ingest
  'skipTraceData',
  'owner2FirstName', 'owner2LastName', 'owner2Phone', 'owner2Email', 'maritalStatus', 'owner1Dob', 'owner2Dob',
  'reapiDob', 'reapiAge',
  'dogBreed', 'insuranceHistory', 'heatingRenovatedYear', 'bathroomsFull', 'bathroomsHalf',
  'garageType', 'garageCount', 'sidingType', 'foundationType', 'heatSource', 'feetFromHydrant',
  'burglarAlarm', 'fireAlarm', 'sprinklerSystem', 'smokeDetector', 'waterSensor',
  'autoWaterShutoff', 'lowTempSensor', 'leedCertified', 'effectiveDate',
  // Phase 5: producer-entered — never clobber on REAPI re-ingest
  'travelersPremium', 'plymouthPremium', 'assignedCarrier', 'doNotRevisit',
  // Phase 5b
  'basementFinishedPct', 'bathroomGrade', 'kitchenCount', 'kitchenGrade', 'propertyTypeMismatch',
  // Producer-edit tracking — never set by bulk pulls
  'lastEditedAt', 'lastEditedBy',
  // Original mortgage amount — comes from PropertyDetail, not the bulk pull; never clobber
  'originalMortgageAmount',
]);

// ─── Value helpers ───────────────────────────────────────────────────────────

/** Serialize a value for a Postgres parameterized query */
function toSql(v: any): any {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

/**
 * Strip large nested arrays from the raw API object before persisting.
 * salesHistory / taxHistory / priorMortgages can be hundreds of KB per record.
 */
function slimRawData(property: any): Record<string, any> {
  const {
    salesHistory, taxHistory, priorMortgages, currentMortgages, ownerHistory, liens,
    ...rest
  } = property ?? {};
  return {
    ...rest,
    currentMortgage: Array.isArray(currentMortgages) ? (currentMortgages[0] ?? null) : null,
  };
}

/** Map a raw Real Estate API property to a DB row payload */
function mapApiPropertyToDb(property: any): Record<string, any> {
  const engine = assignPipelineEngine(property);
  const renewalTargetDate = engine === 2 ? getRenewalTargetDate(property) : null;
  const lastSaleAmountNum = property.lastSaleAmount
    ? parseFloat(String(property.lastSaleAmount).replace(/[^0-9.]/g, ''))
    : null;

  return {
    id: property.propertyId || property.id,
    propertyId: property.propertyId || property.id,
    addressStreet: property.address?.street || property.address?.address || '',
    addressCity: property.address?.city || '',
    addressState: property.address?.state || 'NJ',
    addressZip: property.address?.zip || '',
    addressCounty: property.address?.county || null,
    addressFull: property.address?.address || null,
    mailStreet: property.mailAddress?.street || null,
    mailCity: property.mailAddress?.city || null,
    mailState: property.mailAddress?.state || null,
    mailZip: property.mailAddress?.zip || null,
    propertyType: property.propertyType || null,
    propertyUse: property.propertyUse || null,
    propertyUseCode: property.propertyUseCode || null,
    landUse: property.landUse || null,
    yearBuilt: property.yearBuilt ? parseInt(property.yearBuilt) : null,
    squareFeet: property.squareFeet ? parseInt(property.squareFeet) : null,
    lotSquareFeet: property.lotSquareFeet ? parseInt(property.lotSquareFeet) : null,
    bedrooms: property.bedrooms ? parseInt(property.bedrooms) : null,
    bathrooms: property.bathrooms ? parseFloat(property.bathrooms) : null,
    stories: property.stories ? parseFloat(property.stories) : null,
    unitsCount: property.unitsCount ? parseInt(property.unitsCount) : null,
    roomsCount: property.roomsCount ? parseInt(property.roomsCount) : null,
    garage: property.garage ?? null,
    pool: property.pool ?? null,
    deck: property.deck ?? null,
    patio: property.patio ?? null,
    basement: property.basement ?? null,
    airConditioning: property.airConditioningAvailable ?? null,
    estimatedValue: property.estimatedValue ? parseFloat(property.estimatedValue) : null,
    assessedValue: property.assessedValue ? parseFloat(property.assessedValue) : null,
    lastSaleAmount: lastSaleAmountNum,
    lastSaleDate: property.lastSaleDate || null,
    estimatedEquity: property.estimatedEquity ? parseFloat(property.estimatedEquity) : null,
    openMortgageBalance: property.openMortgageBalance
      ? parseFloat(property.openMortgageBalance) : null,
    lenderName: property.lenderName || null,
    mortgageType: property.mortgageType || null,
    owner1LastName: property.owner1LastName || null,
    owner1FirstName: property.owner1FirstName || null,
    companyName: property.companyName || null,
    ownerOccupied: property.ownerOccupied ?? null,
    corporateOwned: property.corporateOwned ?? null,
    absenteeOwner: property.absenteeOwner ?? null,
    investorBuyer: property.investorBuyer ?? null,
    vacant: property.vacant ?? null,
    preForeclosure: property.preForeclosure ?? null,
    foreclosure: property.foreclosure ?? null,
    reo: property.reo ?? null,
    highEquity: property.highEquity ?? null,
    floodZone: property.floodZone ?? null,
    floodZoneType: property.floodZoneType || null,
    hoa: property.hoa ?? null,
    latitude: property.latitude ? parseFloat(property.latitude) : null,
    longitude: property.longitude ? parseFloat(property.longitude) : null,
    fips: property.fips || null,
    apn: property.apn || null,
    recordingDate: property.recordingDate || null,
    lastUpdateDate: property.lastUpdateDate || null,
    engine,
    renewalTargetDate: renewalTargetDate ? renewalTargetDate.toISOString() : null,
    rawData: JSON.stringify(slimRawData(property)),
  };
}

/** Build a parameterized INSERT query from a payload object */
function buildInsert(payload: Record<string, any>): [string, any[]] {
  const now = new Date().toISOString();
  const row = { ...payload, createdAt: now, updatedAt: now };
  const keys = Object.keys(row).filter((k) => row[k as keyof typeof row] !== undefined);
  const cols = keys.map((k) => `"${k}"`).join(', ');
  const params = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map((k) => toSql(row[k as keyof typeof row]));
  return [`INSERT INTO "Lead" (${cols}) VALUES (${params})`, values];
}

/** Build a parameterized UPDATE query that only touches API-sourced columns */
function buildApiUpdate(
  payload: Record<string, any>,
  propertyId: string,
  existing: Record<string, any>,
): [string, any[]] {
  const updates: Record<string, any> = {};

  for (const [k, v] of Object.entries(payload)) {
    if (k === 'id' || k === 'propertyId') continue;
    if (CRM_ONLY_FIELDS.has(k)) continue;
    updates[k] = v;
  }

  // For pipeline fields: keep existing value if already set
  updates.engine = existing.engine ?? payload.engine;
  updates.renewalTargetDate = existing.renewalTargetDate ?? payload.renewalTargetDate;
  updates.updatedAt = new Date().toISOString();

  const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
  const sets = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(', ');
  const values = [...entries.map(([, v]) => toSql(v)), propertyId];

  return [
    `UPDATE "Lead" SET ${sets} WHERE "propertyId" = $${entries.length + 1}`,
    values,
  ];
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Upsert a batch of properties from the Real Estate API.
 * Dedup rule:
 *   Same propertyId + same owner  → UPDATE (preserve CRM fields)
 *   Same propertyId + new owner   → INSERT new record (new homeowner event)
 */
export async function upsertLeads(properties: any[]): Promise<{
  created: number; updated: number; skipped: number;
}> {
  let created = 0, updated = 0, skipped = 0;

  for (const property of properties) {
    const propertyId = property.propertyId || property.id;
    if (!propertyId) { skipped++; continue; }

    try {
      const { rows } = await pool.query(
        `SELECT "id", "owner1LastName", "engine", "renewalTargetDate",
                "status", "grade", "skipTraced", "skipTracedAt",
                "phone1", "phone2", "email1", "email2",
                "travelersEligible", "travelersNotes", "plymouthEligible", "plymouthNotes",
                "lowPremium", "expectedPremium", "highPremium", "pricingConfidence",
                "producerEmail", "posQuoteNumber", "posCarrier",
                "boundPremium", "boundDate", "authorizationDate"
         FROM "Lead" WHERE "propertyId" = $1`,
        [propertyId],
      );
      const existing = rows[0] as Record<string, any> | undefined;
      const payload = mapApiPropertyToDb(property);

      if (!existing) {
        const [query, values] = buildInsert(payload);
        await pool.query(query, values);
        created++;
      } else {
        const incomingOwner = (property.owner1LastName || '').toLowerCase();
        const existingOwner = (existing.owner1LastName || '').toLowerCase();
        const ownerChanged = incomingOwner && existingOwner && incomingOwner !== existingOwner;

        if (ownerChanged) {
          const newId = `${propertyId}-${property.recordingDate || Date.now()}`;
          const [query, values] = buildInsert({ ...payload, id: newId });
          await pool.query(query, values);
          created++;
        } else {
          const [query, values] = buildApiUpdate(payload, propertyId, existing);
          await pool.query(query, values);
          updated++;
        }
      }
    } catch (err) {
      console.error(`[storage] Error upserting property ${propertyId}:`, err);
      skipped++;
    }
  }

  return { created, updated, skipped };
}

/** Fetch leads from the DB with optional filters. rawData excluded for performance. */
/** Whitelist a carrier filter to its eligibility column (prevents SQL injection). */
function carrierColumn(carrier?: string): string | null {
  if (carrier === 'travelers') return 'travelersEligible';
  if (carrier === 'plymouth') return 'plymouthEligible';
  return null;
}

export async function getLeadsFromDb(filters?: {
  engine?: number;
  grade?: string;
  status?: string;
  /** Effective-date filter (daily triage): single day, or a [from,to] range */
  effectiveDate?: string;
  effectiveTo?: string;
  /** Carrier filter: 'travelers' | 'plymouth' — leads strictly eligible for that carrier */
  carrier?: string;
  /** Exclude leads with these statuses — e.g. ['bound','lost'] for the active queue */
  excludeStatuses?: string[];
  /** Only leads a producer has edited (lastEditedAt set) — Recently Edited tab */
  editedOnly?: boolean;
  /** 'xdate' = renewalTargetDate ASC NULLS LAST (producer priority queue)
   *  'updated' = updatedAt DESC (default / admin view)
   *  'edited'  = lastEditedAt DESC NULLS LAST (Recently Edited) */
  orderBy?: 'xdate' | 'updated' | 'edited';
  limit?: number;
  offset?: number;
}): Promise<any[]> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.engine != null) {
    params.push(filters.engine);
    conditions.push(`"engine" = $${params.length}`);
  }
  if (filters?.grade) {
    params.push(filters.grade);
    conditions.push(`"grade" = $${params.length}`);
  }
  if (filters?.status) {
    params.push(filters.status);
    conditions.push(`"status" = $${params.length}`);
  }
  if (filters?.effectiveDate) {
    if (filters.effectiveTo) {
      params.push(filters.effectiveDate, filters.effectiveTo);
      conditions.push(`"effectiveDate"::date BETWEEN $${params.length - 1} AND $${params.length}`);
    } else {
      params.push(filters.effectiveDate);
      conditions.push(`"effectiveDate"::date = $${params.length}`);
    }
  }
  const carrierCol = carrierColumn(filters?.carrier);
  if (carrierCol) conditions.push(`"${carrierCol}" = 'eligible'`);
  if (filters?.editedOnly) conditions.push(`"lastEditedAt" IS NOT NULL`);
  if (filters?.excludeStatuses?.length) {
    const placeholders = filters.excludeStatuses.map((_, i) => `$${params.length + i + 1}`).join(', ');
    filters.excludeStatuses.forEach((s) => params.push(s));
    conditions.push(`"status" NOT IN (${placeholders})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Producer priority queue: sort by x-date proximity (soonest first), nulls last
  // Admin/default: sort by most recently updated
  const orderClause = filters?.orderBy === 'xdate'
    ? `ORDER BY COALESCE("effectiveDate"::date, "renewalTargetDate"::date) ASC NULLS LAST, "createdAt" DESC`
    : filters?.orderBy === 'edited'
    ? `ORDER BY "lastEditedAt" DESC NULLS LAST`
    : `ORDER BY "updatedAt" DESC`;

  params.push(filters?.limit ?? 100, filters?.offset ?? 0);

  const query = `
    SELECT ${LEAD_COLS_SQL}
    FROM "Lead"
    ${where}
    ${orderClause}
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  const { rows } = await pool.query(query, params);
  return rows;
}

/** Given a set of candidate propertyIds, return those already stored (for credit de-dup). */
export async function getExistingPropertyIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT "propertyId" FROM "Lead" WHERE "propertyId" = ANY($1)`,
    [ids],
  );
  return rows.map((r) => String(r.propertyId));
}

/**
 * DB-wide lead counts (total + per engine), honoring optional grade/status filters
 * but NOT engine — so the pipeline tabs can show true totals regardless of how many
 * rows are currently loaded.
 */
export async function getLeadCounts(filters?: {
  grade?: string;
  status?: string;
  effectiveDate?: string;
  effectiveTo?: string;
  carrier?: string;
}): Promise<{ total: number; engine1: number; engine2: number }> {
  const conditions: string[] = [];
  const params: any[] = [];
  if (filters?.grade) { params.push(filters.grade); conditions.push(`"grade" = $${params.length}`); }
  if (filters?.status) { params.push(filters.status); conditions.push(`"status" = $${params.length}`); }
  const cCol = carrierColumn(filters?.carrier);
  if (cCol) conditions.push(`"${cCol}" = 'eligible'`);
  if (filters?.effectiveDate) {
    if (filters.effectiveTo) {
      params.push(filters.effectiveDate, filters.effectiveTo);
      conditions.push(`"effectiveDate"::date BETWEEN $${params.length - 1} AND $${params.length}`);
    } else {
      params.push(filters.effectiveDate);
      conditions.push(`"effectiveDate"::date = $${params.length}`);
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int                                AS total,
            COUNT(*) FILTER (WHERE "engine" = 1)::int    AS engine1,
            COUNT(*) FILTER (WHERE "engine" = 2)::int    AS engine2
     FROM "Lead" ${where}`,
    params,
  );
  const r = rows[0] as any;
  return { total: Number(r.total), engine1: Number(r.engine1), engine2: Number(r.engine2) };
}

/** Get a single lead by propertyId, including its activity log. */
export async function getLeadByPropertyId(propertyId: string): Promise<any | null> {
  const { rows } = await pool.query(
    `SELECT l.*,
            COALESCE(
              json_agg(
                json_build_object(
                  'id',        a."id",
                  'type',      a."type",
                  'content',   a."content",
                  'metadata',  a."metadata",
                  'createdBy', a."createdBy",
                  'createdAt', a."createdAt"
                ) ORDER BY a."createdAt" DESC
              ) FILTER (WHERE a."id" IS NOT NULL),
              '[]'::json
            ) AS activities
     FROM "Lead" l
     LEFT JOIN "Activity" a ON a."leadId" = l."id"
     WHERE l."propertyId" = $1
     GROUP BY l."id"`,
    [propertyId],
  );
  return (rows[0] as any) ?? null;
}

/** Update CRM-managed fields on a lead. */
export async function updateLead(
  propertyId: string,
  data: Partial<{
    // core CRM
    status: LeadStatus; grade: string;
    travelersEligible: string; travelersNotes: any;
    plymouthEligible: string; plymouthNotes: any;
    travelersEligibilityReason: string; plymouthEligibilityReason: string;
    travelersEligibilityDetail: string; plymouthEligibilityDetail: string;
    indicativeBandLow: number; indicativeBandHigh: number;
    ownerVerifyStatus: string; ownerVerifyName: string; ownerVerifySource: string; ownerVerifyAt: Date | string; ownerVerifyDetail: string;
    lowPremium: number; expectedPremium: number; highPremium: number; pricingConfidence: number;
    skipTraced: boolean; skipTracedAt: Date; skipTraceData: any;
    phone1: string; phone2: string; email1: string; email2: string;
    producerEmail: string; posQuoteNumber: string; posCarrier: string;
    boundPremium: number; boundDate: Date; authorizationDate: Date;
    coastDistanceMiles: number; coastExposure: string;
    varianceNotes: string; varianceReason: string; varianceAmount: number;
    // §10A sourcing
    sourceVendor: string; cohortTag: string;
    // §10B rating
    roofYear: number; roofType: string; constructionType: string; protectionClass: string;
    priorCarrier: string; priorPremium: number; indicativeBasis: string;
    // §10D producer workflow
    queueEnteredAt: Date; firstRpcAt: Date; contactAttempts: number; authorizationMethod: string;
    // §10E moat
    posQuotePremium: number; quotedAt: Date; variancePct: number;
    lostReason: string; lostStage: string;
    // manual grade override + revisit + competitor capture
    manualGrade: string; gradeOverrideReason: string; gradeOverrideBy: string; gradeOverrideAt: Date;
    revisitFlag: boolean; revisitDate: Date; revisitNote: string;
    competitorCarrier: string; competitorPremium: number;
    // Frank Jun-2026: dual insureds + DOB, confirm-on-call, home features
    owner2FirstName: string; owner2LastName: string; owner2Phone: string; owner2Email: string; maritalStatus: string;
    owner1Dob: string; owner2Dob: string;
    reapiDob: string; reapiAge: number;
    dogBreed: string; insuranceHistory: string; heatingRenovatedYear: number;
    bathroomsFull: number; bathroomsHalf: number;
    garageType: string; garageCount: number; sidingType: string; foundationType: string;
    heatSource: string; feetFromHydrant: number;
    burglarAlarm: string; fireAlarm: string; sprinklerSystem: boolean;
    smokeDetector: string; waterSensor: string; autoWaterShutoff: string; lowTempSensor: string;
    leedCertified: boolean; effectiveDate: string;
    // FEMA flood (Phase 3a)
    floodZone: boolean; floodZoneType: string; floodZoneSubtype: string;
    floodSfha: boolean; floodZoneManual: boolean; floodCheckedAt: string;
    // Phase 5: carrier pricing + close-out
    travelersPremium: number; plymouthPremium: number; assignedCarrier: string; doNotRevisit: boolean;
    // Phase 5b: Home Upgrades + basement finish
    basementFinishedPct: string; bathroomGrade: string; kitchenCount: number; kitchenGrade: string;
    propertyTypeMismatch: boolean;
    // Producer-edit tracking (Recently Edited tab)
    lastEditedAt: Date | string; lastEditedBy: string;
    // Original mortgage amount at closing (PropertyDetail) — equity analysis
    originalMortgageAmount: number;
  }>,
): Promise<void> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;

  entries.push(['updatedAt', new Date().toISOString()]);
  const sets = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(', ');
  const values = [...entries.map(([, v]) => toSql(v)), propertyId];

  await pool.query(
    `UPDATE "Lead" SET ${sets} WHERE "propertyId" = $${entries.length + 1}`,
    values,
  );
}

/** Add an activity/note to a lead. */
export async function addActivity(
  leadId: string,
  type: string,
  content: string,
  metadata?: Record<string, any>,
  createdBy?: string,
): Promise<void> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO "Activity" ("id", "leadId", "type", "content", "metadata", "createdBy", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, leadId, type, content, metadata ? JSON.stringify(metadata) : null, createdBy ?? null, now],
  );
}

/** Get pipeline summary counts for the dashboard — single query covering both funnels. */
export async function getPipelineSummary() {
  const rows = await sql`
    SELECT
      -- totals
      COUNT(*)                                                                   AS total,
      COUNT(*) FILTER (WHERE "engine" = 1)                                      AS engine1,
      COUNT(*) FILTER (WHERE "engine" = 2)                                      AS engine2,

      -- grades
      COUNT(*) FILTER (WHERE "grade" = 'A')                                     AS "gradeA",
      COUNT(*) FILTER (WHERE "grade" = 'B')                                     AS "gradeB",
      COUNT(*) FILTER (WHERE "grade" = 'C')                                     AS "gradeC",
      COUNT(*) FILTER (WHERE "grade" = 'D')                                     AS "gradeD",

      -- Funnel 1 — Sourcing stages
      COUNT(*) FILTER (WHERE "grade" IN ('A','B','C'))                          AS "inAppetite",
      COUNT(*) FILTER (WHERE "grade" = 'A')                                     AS "ratingComplete",
      COUNT(*) FILTER (
        WHERE "grade" = 'A'
          AND ("phone1" IS NOT NULL OR "email1" IS NOT NULL)
      )                                                                          AS contactable,

      -- Funnel 2 — Producer stages (cumulative from quote-ready)
      COUNT(*) FILTER (
        WHERE "grade" = 'A'
          AND "status" IN ('rated','indicative_sent','pos_ran','quote_issued','referral','bound')
      )                                                                          AS "rightPartyContact",
      COUNT(*) FILTER (
        WHERE "grade" = 'A'
          AND ("authorizationDate" IS NOT NULL
               OR "status" IN ('indicative_sent','pos_ran','quote_issued','bound'))
      )                                                                          AS "authorizedToQuote",
      COUNT(*) FILTER (
        WHERE "grade" = 'A'
          AND ("posQuoteNumber" IS NOT NULL
               OR "status" IN ('pos_ran','quote_issued','bound'))
      )                                                                          AS "quotedPos",
      COUNT(*) FILTER (WHERE "status" = 'bound')                                AS bound,

      -- ── Stock health ─────────────────────────────────────────────────────
      -- Active quote-ready leads not yet closed (the buffer)
      COUNT(*) FILTER (
        WHERE "grade" = 'A'
          AND "status" NOT IN ('bound','lost')
      )                                                                          AS "quoteReadyActive",

      -- Working stock: leads actively in-flight (producer has touched them)
      COUNT(*) FILTER (
        WHERE "grade" = 'A'
          AND "status" IN ('rated','indicative_sent','pos_ran','quote_issued','referral')
      )                                                                          AS "workingStock",

      -- Binds in the last 30 days — the flow denominator for stock/flow ratio
      COUNT(*) FILTER (
        WHERE "status" = 'bound'
          AND "boundDate" >= NOW() - INTERVAL '30 days'
      )                                                                          AS "boundLast30",

      -- Stale: Grade A, never contacted, sitting in queue > 14 days
      COUNT(*) FILTER (
        WHERE "grade" = 'A'
          AND "status" = 'new'
          AND "firstRpcAt" IS NULL
          AND "queueEnteredAt" IS NOT NULL
          AND "queueEnteredAt" < NOW() - INTERVAL '14 days'
      )                                                                          AS "staleLeads",

      -- Past x-date with no contact — candidates for auto-retire
      COUNT(*) FILTER (
        WHERE "grade" = 'A'
          AND "status" = 'new'
          AND "renewalTargetDate" IS NOT NULL
          AND "renewalTargetDate" < NOW() - INTERVAL '30 days'
      )                                                                          AS "pastXDate"

    FROM "Lead"
  `;

  const r = (rows as any[])[0];
  const total   = Number(r.total);
  const engine1 = Number(r.engine1);
  const engine2 = Number(r.engine2);

  const quoteReadyActive = Number(r.quoteReadyActive);
  const workingStock     = Number(r.workingStock);
  const boundLast30      = Number(r.boundLast30);

  // Buffer in days: how many days of quote-ready leads remain given current burn rate.
  // Burn rate = binds per day (30-day trailing). Avoid div/0 with fallback to null.
  const dailyBurnRate  = boundLast30 / 30;
  const bufferDays     = dailyBurnRate > 0 ? Math.round(quoteReadyActive / dailyBurnRate) : null;

  // Stock/flow ratio: working stock ÷ monthly bind run-rate (boundLast30 already is monthly).
  const stockFlowRatio = boundLast30 > 0
    ? Math.round((workingStock / boundLast30) * 100) / 100
    : null;

  return {
    // totals
    total,
    engine1,
    engine2,
    unassigned: total - engine1 - engine2,

    // grades
    gradeA: Number(r.gradeA),
    gradeB: Number(r.gradeB),
    gradeC: Number(r.gradeC),
    gradeD: Number(r.gradeD),

    // Funnel 1 — Sourcing
    inAppetite:     Number(r.inAppetite),
    ratingComplete: Number(r.ratingComplete),
    contactable:    Number(r.contactable),
    quoteReady:     Number(r.gradeA),

    // Funnel 2 — Producer
    rightPartyContact: Number(r.rightPartyContact),
    authorizedToQuote: Number(r.authorizedToQuote),
    quotedPos:         Number(r.quotedPos),
    bound:             Number(r.bound),

    // Stock health
    quoteReadyActive,
    workingStock,
    boundLast30,
    staleLeads:    Number(r.staleLeads),
    pastXDate:     Number(r.pastXDate),
    bufferDays,
    stockFlowRatio,
    dailyBurnRate: Math.round(dailyBurnRate * 10) / 10,
  };
}
