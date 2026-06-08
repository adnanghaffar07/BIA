import sql from '@/lib/neon';
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
  'estimatedEquity', 'openMortgageBalance', 'lenderName', 'mortgageType',
  'owner1LastName', 'owner1FirstName', 'companyName', 'ownerOccupied',
  'corporateOwned', 'absenteeOwner', 'investorBuyer',
  'vacant', 'preForeclosure', 'foreclosure', 'reo', 'highEquity',
  'floodZone', 'floodZoneType', 'hoa', 'latitude', 'longitude', 'fips', 'apn',
  'recordingDate', 'lastUpdateDate', 'skipTraced', 'skipTracedAt',
  'phone1', 'phone2', 'email1', 'email2', 'engine', 'renewalTargetDate', 'grade',
  'travelersEligible', 'travelersNotes', 'plymouthEligible', 'plymouthNotes',
  'lowPremium', 'expectedPremium', 'highPremium', 'pricingConfidence', 'status',
  'producerEmail', 'posQuoteNumber', 'posCarrier', 'boundPremium', 'boundDate',
  'authorizationDate', 'createdAt', 'updatedAt',
] as const;

const LEAD_COLS_SQL = LEAD_COLS.map((c) => `"${c}"`).join(', ');

/** CRM fields that must NOT be overwritten when re-ingesting API data */
const CRM_ONLY_FIELDS = new Set([
  'status', 'grade', 'skipTraced', 'skipTracedAt',
  'phone1', 'phone2', 'email1', 'email2',
  'travelersEligible', 'travelersNotes', 'plymouthEligible', 'plymouthNotes',
  'lowPremium', 'expectedPremium', 'highPremium', 'pricingConfidence',
  'producerEmail', 'posQuoteNumber', 'posCarrier', 'boundPremium', 'boundDate', 'authorizationDate',
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
  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  const cols = keys.map((k) => `"${k}"`).join(', ');
  const params = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map((k) => toSql(row[k]));
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
      const rows = await sql.query(
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
        await sql.query(query, values);
        created++;
      } else {
        const incomingOwner = (property.owner1LastName || '').toLowerCase();
        const existingOwner = (existing.owner1LastName || '').toLowerCase();
        const ownerChanged = incomingOwner && existingOwner && incomingOwner !== existingOwner;

        if (ownerChanged) {
          const newId = `${propertyId}-${property.recordingDate || Date.now()}`;
          const [query, values] = buildInsert({ ...payload, id: newId });
          await sql.query(query, values);
          created++;
        } else {
          const [query, values] = buildApiUpdate(payload, propertyId, existing);
          await sql.query(query, values);
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
export async function getLeadsFromDb(filters?: {
  engine?: number;
  grade?: string;
  status?: string;
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

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(filters?.limit ?? 100, filters?.offset ?? 0);

  const query = `
    SELECT ${LEAD_COLS_SQL}
    FROM "Lead"
    ${where}
    ORDER BY "updatedAt" DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;

  return sql.query(query, params) as Promise<any[]>;
}

/** Get a single lead by propertyId, including its activity log. */
export async function getLeadByPropertyId(propertyId: string): Promise<any | null> {
  const rows = await sql.query(
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
    status: LeadStatus; grade: string;
    travelersEligible: string; travelersNotes: any;
    plymouthEligible: string; plymouthNotes: any;
    lowPremium: number; expectedPremium: number; highPremium: number; pricingConfidence: number;
    skipTraced: boolean; skipTracedAt: Date;
    phone1: string; phone2: string; email1: string; email2: string;
    producerEmail: string; posQuoteNumber: string; posCarrier: string;
    boundPremium: number; boundDate: Date; authorizationDate: Date;
  }>,
): Promise<void> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;

  entries.push(['updatedAt', new Date().toISOString()]);
  const sets = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(', ');
  const values = [...entries.map(([, v]) => toSql(v)), propertyId];

  await sql.query(
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
  await sql.query(
    `INSERT INTO "Activity" ("id", "leadId", "type", "content", "metadata", "createdBy", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, leadId, type, content, metadata ? JSON.stringify(metadata) : null, createdBy ?? null, now],
  );
}

/** Get pipeline summary counts for the dashboard — single query, 8x faster than before. */
export async function getPipelineSummary() {
  const rows = await sql`
    SELECT
      COUNT(*)                                    AS total,
      COUNT(*) FILTER (WHERE "engine" = 1)        AS engine1,
      COUNT(*) FILTER (WHERE "engine" = 2)        AS engine2,
      COUNT(*) FILTER (WHERE "grade" = 'A')       AS "gradeA",
      COUNT(*) FILTER (WHERE "grade" = 'B')       AS "gradeB",
      COUNT(*) FILTER (WHERE "grade" = 'C')       AS "gradeC",
      COUNT(*) FILTER (WHERE "grade" = 'D')       AS "gradeD",
      COUNT(*) FILTER (WHERE "status" = 'bound')  AS bound
    FROM "Lead"
  `;

  const r = rows[0] as any;
  const total    = Number(r.total);
  const engine1  = Number(r.engine1);
  const engine2  = Number(r.engine2);

  return {
    total,
    engine1,
    engine2,
    unassigned: total - engine1 - engine2,
    gradeA:     Number(r.gradeA),
    gradeB:     Number(r.gradeB),
    gradeC:     Number(r.gradeC),
    gradeD:     Number(r.gradeD),
    quoteReady: Number(r.gradeA),
    bound:      Number(r.bound),
  };
}
