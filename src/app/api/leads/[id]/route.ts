import { NextRequest, NextResponse } from 'next/server';
import { getLeadByPropertyId, updateLead, addActivity } from '@/services/storage.service';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const lead = await getLeadByPropertyId(id);
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: lead });
  } catch (error) {
    console.error('GET /api/leads/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch lead' }, { status: 500 });
  }
}

/**
 * PUT /api/leads/[id]
 * Update CRM fields. Auto-stamps funnel timestamps based on transitions:
 *   status → 'contacted' for the first time  → sets firstRpcAt
 *   posQuoteNumber set for the first time     → sets quotedAt
 *   posQuotePremium + expectedPremium present → computes variancePct
 *   status → 'lost'                           → requires lostReason + lostStage
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { _activityNote, _activityType, _createdBy, ...updateData } = body;

    // Fetch current lead state to drive auto-stamp logic
    const existing = await getLeadByPropertyId(id);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    const now = new Date();

    // Producer edit — stamp who/when so this lead surfaces in "Recently Edited".
    updateData.lastEditedAt = now;
    updateData.lastEditedBy = _createdBy ?? existing.lastEditedBy ?? null;

    // Auto-stamp: firstRpcAt — set once when the lead first moves off 'new'
    // (producer engagement = enters the active queue, Frank Phase 5).
    if (
      updateData.status &&
      updateData.status !== 'new' &&
      !existing.firstRpcAt &&
      existing.status === 'new'
    ) {
      updateData.firstRpcAt = now;
    }

    // Auto-increment: contactAttempts on each producer-stage transition
    if (
      updateData.status &&
      ['rated', 'indicative_sent', 'pos_ran', 'quote_issued', 'referral'].includes(updateData.status) &&
      updateData.status !== existing.status
    ) {
      updateData.contactAttempts = (existing.contactAttempts ?? 0) + 1;
    }

    // Auto-stamp: quotedAt — set once when posQuoteNumber is first provided
    if (updateData.posQuoteNumber && !existing.posQuoteNumber && !existing.quotedAt) {
      updateData.quotedAt = now;
    }

    // Auto-compute: variancePct when we have both posQuotePremium and expectedPremium
    const newPosQuote = updateData.posQuotePremium ?? existing.posQuotePremium;
    const expectedPremium = existing.expectedPremium;
    if (newPosQuote && expectedPremium) {
      updateData.variancePct = Math.round(
        ((newPosQuote - expectedPremium) / expectedPremium) * 10000
      ) / 100; // stored as percent e.g. 12.34
    }

    // Auto-stamp: boundDate when status first moves to 'bound'
    if (updateData.status === 'bound' && existing.status !== 'bound' && !existing.boundDate) {
      updateData.boundDate = now;
    }

    // Manual grade override (§2/§11): a producer can upgrade/downgrade a lead.
    // When manualGrade is set, mirror it into `grade` (so queue/dashboard filters
    // pick it up) and stamp who/when. An empty string clears the override; the
    // computed grade is restored on the next enrichment pass.
    if ('manualGrade' in updateData) {
      const mg = updateData.manualGrade;
      if (mg && ['A', 'B', 'C', 'D'].includes(mg)) {
        updateData.grade = mg;
        updateData.gradeOverrideAt = now;
        updateData.gradeOverrideBy = _createdBy ?? updateData.gradeOverrideBy;
      } else {
        // Clear the override (leave `grade` as-is until re-enrichment recomputes it)
        updateData.manualGrade = null;
        updateData.gradeOverrideReason = null;
        updateData.gradeOverrideBy = null;
        updateData.gradeOverrideAt = null;
      }
    }

    await updateLead(id, updateData);

    // ── Audit trail (Frank Jun-2026): log EVERY manual change, not just noted ones.
    // Build a human summary of what actually changed (status, grade override, fields).
    const AUTO_FIELDS = new Set([
      'lastEditedAt', 'lastEditedBy', 'firstRpcAt', 'contactAttempts',
      'quotedAt', 'variancePct', 'boundDate', 'gradeOverrideAt', 'gradeOverrideBy', 'grade',
    ]);
    const changes: string[] = [];
    if (updateData.status && updateData.status !== existing.status) {
      changes.push(`Status: ${existing.status ?? '—'} → ${updateData.status}`);
    }
    if ('manualGrade' in updateData && updateData.manualGrade && updateData.manualGrade !== existing.manualGrade) {
      changes.push(`Grade override → ${updateData.manualGrade}`
        + `${updateData.gradeOverrideReason ? ` (${updateData.gradeOverrideReason})` : ''}`);
    }
    // Human-readable labels for EVERY editable field on the lead detail page.
    const FIELD_LABELS: Record<string, string> = {
      // Producer workflow / pricing
      posQuoteNumber: 'POS Quote #', posCarrier: 'POS Carrier', posQuotePremium: 'POS Quote Premium',
      boundPremium: 'Bound Premium', authorizationMethod: 'Authorization Method',
      lostReason: 'Lost Reason', lostStage: 'Lost Stage', doNotRevisit: 'Do Not Revisit',
      effectiveDate: 'Effective Date', priorCarrier: 'Prior Carrier', priorPremium: 'Prior Premium',
      indicativeBasis: 'Indicative Basis',
      // Variance / revisit / competitor
      varianceNotes: 'Variance Notes', varianceReason: 'Variance Reason', varianceAmount: 'Variance Amount',
      revisitFlag: 'Revisit Flag', revisitDate: 'Revisit Date', revisitNote: 'Revisit Note',
      competitorCarrier: 'Competitor Carrier', competitorPremium: 'Competitor Premium',
      // Carrier pricing
      travelersPremium: 'Travelers Premium', plymouthPremium: 'Plymouth Premium', assignedCarrier: 'Assigned Carrier',
      travelersEligible: 'Travelers Eligibility', plymouthEligible: 'Plymouth Eligibility',
      travelersEligibilityReason: 'Travelers Eligibility Reason', plymouthEligibilityReason: 'Plymouth Eligibility Reason',
      travelersEligibilityDetail: 'Travelers Eligibility Detail', plymouthEligibilityDetail: 'Plymouth Eligibility Detail',
      indicativeBandLow: 'Indicative Band Low', indicativeBandHigh: 'Indicative Band High',
      // Insured info
      owner2FirstName: 'Co-Insured First', owner2LastName: 'Co-Insured Last', maritalStatus: 'Marital Status',
      owner1Dob: 'Owner 1 DOB', owner2Dob: 'Owner 2 DOB', reapiDob: 'REAPI DOB', phone1: 'Phone', email1: 'Email',
      insuranceHistory: 'Insurance History',
      // Property / home features
      dogBreed: 'Dog Breed', roofYear: 'Roof Year', roofType: 'Roof Type',
      constructionType: 'Construction Type', protectionClass: 'Protection Class',
      heatingRenovatedYear: 'Heating Renovated Year', bathroomsFull: 'Full Bathrooms', bathroomsHalf: 'Half Bathrooms',
      garageType: 'Garage Type', garageCount: 'Garage Count', sidingType: 'Siding Type',
      foundationType: 'Foundation Type', heatSource: 'Heat Source', feetFromHydrant: 'Feet From Hydrant',
      burglarAlarm: 'Burglar Alarm', fireAlarm: 'Fire Alarm', sprinklerSystem: 'Sprinkler System',
      smokeDetector: 'Smoke Detector', waterSensor: 'Water Sensor', autoWaterShutoff: 'Auto Water Shutoff',
      lowTempSensor: 'Low-Temp Sensor', leedCertified: 'LEED Certified',
      basementFinishedPct: 'Basement Finished %', bathroomGrade: 'Bathroom Grade', propertyTypeMismatch: 'Property Type Mismatch',
      kitchenCount: 'Kitchen Count', kitchenGrade: 'Kitchen Grade',
      floodZoneManual: 'Flood Zone (manual)', floodZoneType: 'Flood Zone Type',
    };
    const label = (k: string) => FIELD_LABELS[k]
      || k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

    // Normalize values so booleans (false ≈ unset), numbers ("1500.00" ≈ 1500),
    // and dates (timestamp ≈ YYYY-MM-DD) don't register as spurious changes.
    const norm = (v: any): string => {
      if (v === null || v === undefined || v === '' || v === false) return '';
      if (v === true) return 'true';
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const s = String(v);
      const iso = s.match(/^(\d{4}-\d{2}-\d{2})T/); if (iso) return iso[1];
      const n = Number(s);
      return Number.isFinite(n) && s.trim() !== '' ? String(n) : s;
    };

    // Display a value for the tooltip (empty / Yes / No / date / raw).
    const display = (v: any): string => {
      if (v === null || v === undefined || v === '') return '(empty)';
      if (v === true) return 'Yes';
      if (v === false) return 'No';
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const s = String(v);
      const iso = s.match(/^(\d{4}-\d{2}-\d{2})T/); return iso ? iso[1] : s;
    };

    const editedFields = Object.keys(updateData).filter(
      (k) => !AUTO_FIELDS.has(k) && k !== 'status' && k !== 'manualGrade' && k !== 'gradeOverrideReason'
        && norm(updateData[k]) !== norm(existing[k]),
    );
    if (editedFields.length) changes.push(`Updated: ${editedFields.map(label).join(', ')}`);

    // Structured old → new details, stored in metadata and shown in a tooltip.
    const changeDetails: { field: string; from: string; to: string }[] = [];
    if (updateData.status && updateData.status !== existing.status) {
      changeDetails.push({ field: 'Status', from: display(existing.status), to: display(updateData.status) });
    }
    if ('manualGrade' in updateData && updateData.manualGrade && updateData.manualGrade !== existing.manualGrade) {
      changeDetails.push({ field: 'Grade', from: display(existing.manualGrade ?? existing.grade), to: display(updateData.manualGrade) });
    }
    for (const k of editedFields) {
      changeDetails.push({ field: label(k), from: display(existing[k]), to: display(updateData[k]) });
    }

    if (_activityNote || changes.length) {
      const grade = changeDetails.some((d) => d.field === 'Grade');
      const statusC = changeDetails.some((d) => d.field === 'Status');
      await addActivity(
        existing.id,
        _activityType || (grade ? 'grade_override' : statusC ? 'status_change' : 'edit'),
        _activityNote || changes.join(' · '),
        { changes: changeDetails },
        _createdBy,
      );
    }

    const updated = await getLeadByPropertyId(id);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('PUT /api/leads/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update lead' }, { status: 500 });
  }
}
