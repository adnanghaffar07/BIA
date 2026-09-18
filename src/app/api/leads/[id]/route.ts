import { NextRequest, NextResponse } from 'next/server';
import { getLeadByPropertyId, updateLead, addActivity } from '@/services/storage.service';
import { getSessionUser, actorLabel } from '@/lib/auth';
import { recordGradeChange } from '@/services/gradeHistory.service';
import { insuredEmails, coInsuredEmails } from '@/services/recipients.service';

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
    /**
     * Whose each held address is — computed HERE, on the server.
     *
     * The card needs this split and the rule lives in recipients.service, but importing
     * that into the client component would drag in @/lib/constants and inline
     * NEXT_PUBLIC_REAL_ESTATE_API_KEY into the browser bundle. Sending the answer instead
     * of the rule keeps one definition without shipping a credential.
     */
    const ins = insuredEmails(lead);
    const co = coInsuredEmails(lead);
    const held: string[] = Array.isArray((lead as any).emailsAll) ? (lead as any).emailsAll : [];
    const attributed = new Set([...ins, ...co]);
    return NextResponse.json({
      success: true,
      data: {
        ...lead,
        insuredEmailsOnFile: ins,
        coInsuredEmailsOnFile: co,
        otherHouseholdEmails: held.filter((e) => !attributed.has(String(e).toLowerCase())),
      },
    });
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
    const { _activityNote, _activityType, _createdBy, ...rawUpdate } = body;

    /**
     * Strip the fields a client may never set.
     *
     * The storage layer already refuses unknown columns, which stops SQL injection
     * through a column name. This is the second, narrower gate: these are REAL columns,
     * so the whitelist below would happily write them — but they are owned by the
     * system, and a producer editing a lead must not be able to set them by adding a key
     * to the request body.
     *
     * Demonstrated before this was added: a normal PUT carrying {"holdoutFlag": false}
     * moved a lead out of the experiment's control group, and {"bandHit": true} wrote a
     * pricing-accuracy verdict that no bind had produced. Both silent, both 200 OK.
     *
     * Anything the route itself computes — bandHit below, the funnel stamps — is added
     * AFTER this filter, so the server can still write what the client cannot.
     */
    const SERVER_OWNED = new Set([
      // The experiment. Assigned once by the holdout service; rewriting it destroys the
      // only thing that lets a bind be attributed to the campaign.
      'holdoutFlag', 'holdoutAssignedAt', 'holdoutCohort',
      // Pricing accuracy — measured from a bind, never typed.
      'publishedBandLow', 'publishedBandHigh', 'publishedBandAt',
      'bandHit', 'bandVariancePct', 'bandMeasuredAt',
      // Campaign state — owned by the push and the vendor webhook.
      'campaignStatus', 'campaignCohort', 'currentEmailStep', 'campaignLastSentAt',
      'campaignRepliedAt', 'campaignBouncedAt', 'campaignUnsubscribedAt', 'hardBounced',
      'suppressedReason', 'vendorCampaignId', 'vendorLeadId',
      'primaryContactEmail', 'primaryContactRole', 'primaryContactAt',
      // Provenance.
      'blastRunId', 'blastSkipTracedAt', 'blastSkipTracedBy', 'rawData', 'skipTraceData',
    ]);
    const blocked: string[] = [];
    const updateData: Record<string, any> = {};
    for (const [k, v] of Object.entries(rawUpdate as Record<string, any>)) {
      if (SERVER_OWNED.has(k)) { blocked.push(k); continue; }
      updateData[k] = v;
    }
    if (blocked.length) {
      console.warn(`PUT /api/leads/${id}: refused server-owned field(s): ${blocked.join(', ')}`);
    }

    // Who is actually doing this. The session wins over the client's _createdBy, which
    // carried the lead's producerEmail (usually null) rather than the signed-in user.
    const actor = actorLabel(await getSessionUser(request)) ?? _createdBy ?? null;

    // Fetch current lead state to drive auto-stamp logic
    const existing = await getLeadByPropertyId(id);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    const now = new Date();

    // Producer edit — stamp who/when so this lead surfaces in "Recently Edited".
    updateData.lastEditedAt = now;
    updateData.lastEditedBy = actor ?? existing.lastEditedBy ?? null;

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

    /**
     * Band accuracy — playbook §03, the measurement the whole thesis rests on.
     *
     * variancePct above answers a DIFFERENT question: the POS quote against
     * expectedPremium, our internal 0.5%-of-value estimate, which the customer never sees.
     * What they saw was indicativeBandLow–High, in writing, in email 2. Until now nothing
     * compared the published band to the premium actually bound, so "the band held on 27
     * of 30" was unanswerable.
     *
     * Measured against publishedBand*, not the lead's CURRENT band: the valuation may have
     * been re-run since, and the only band that matters is the one the homeowner read.
     * Falls back to the live band for a lead bound without ever being mailed.
     */
    const boundPremium = updateData.boundPremium ?? existing.boundPremium;
    const bandLow = existing.publishedBandLow ?? existing.indicativeBandLow;
    const bandHigh = existing.publishedBandHigh ?? existing.indicativeBandHigh;
    if (boundPremium && bandLow && bandHigh && existing.bandMeasuredAt == null) {
      const low = Number(bandLow);
      const high = Number(bandHigh);
      const bound = Number(boundPremium);
      const hit = bound >= low && bound <= high;

      // Signed distance from the nearest edge: negative means we quoted high and it bound
      // below the band, positive means we quoted low. Zero inside. The sign is the point —
      // "the misses ran high on older Coverage A" is the kind of finding §03 expects, and
      // an absolute value would hide it.
      let variance = 0;
      if (bound < low) variance = ((bound - low) / low) * 100;
      else if (bound > high) variance = ((bound - high) / high) * 100;

      updateData.bandHit = hit;
      updateData.bandVariancePct = Math.round(variance * 100) / 100;
      updateData.bandMeasuredAt = now;
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
        updateData.gradeOverrideBy = actor ?? updateData.gradeOverrideBy;
      } else {
        // Clear the override (leave `grade` as-is until re-enrichment recomputes it)
        updateData.manualGrade = null;
        updateData.gradeOverrideReason = null;
        updateData.gradeOverrideBy = null;
        updateData.gradeOverrideAt = null;
      }
    }

    await updateLead(id, updateData);

    /**
     * Record the grade change in the one log reports read (register A8).
     *
     * The activity feed still gets its own entry below for the human timeline, but the
     * feed is not a reliable source for counting: the 360 changes already on record are
     * split across two unrelated types, with the change buried in a JSON array, and a
     * report reading the obvious one missed 70% of them.
     *
     * Written AFTER the update so a failed write cannot produce a log entry for a change
     * that never happened, and deliberately not fatal — a lead edit must not fail because
     * the audit insert did.
     */
    if (updateData.grade && updateData.grade !== existing.grade) {
      try {
        await recordGradeChange({
          leadId: existing.id,
          fromGrade: existing.grade ?? null,
          toGrade: updateData.grade,
          source: 'producer',
          reason: updateData.gradeOverrideReason ?? _activityNote ?? null,
          changedBy: actor,
          at: now,
        });
      } catch (err) {
        console.error(`PUT /api/leads/${id}: grade change not logged:`, err);
      }
    }

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
    /**
     * Removing an override is an action too.
     *
     * The condition above requires a NEW grade, so clearing one fell through every
     * branch: manualGrade, the reason, who set it and when were all nulled, `grade` was
     * left standing, and nothing was written anywhere. 22 leads in this database carry a
     * gradeOverrideAt with no override and not one of them has a record of the removal —
     * so "who took this lead off its override, and when" had no answer.
     *
     * No GradeChange row: the effective grade does not move here. It moves at the next
     * re-grade, and that pass logs it as a system change. This records the decision that
     * allowed it, which is the half that was missing.
     */
    const clearedOverride = 'manualGrade' in updateData && !updateData.manualGrade && existing.manualGrade;
    if (clearedOverride) {
      changes.push(`Grade override removed (was ${existing.manualGrade}) — reverts to the computed grade on the next re-grade`);
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
    // Structured too, not just prose: the Grade Changes report reads `changes`, so a
    // removal that exists only in the sentence would be invisible to every report.
    if (clearedOverride) {
      changeDetails.push({ field: 'Grade override', from: display(existing.manualGrade), to: '(none)' });
    }
    for (const k of editedFields) {
      changeDetails.push({ field: label(k), from: display(existing[k]), to: display(updateData[k]) });
    }

    if (_activityNote || changes.length) {
      const grade = changeDetails.some((d) => d.field === 'Grade');
      const statusC = changeDetails.some((d) => d.field === 'Status');
      /**
       * ── The `changes` array is the record. The activity TYPE is not. ──────────
       *
       * A caller-supplied _activityType wins over the derived one, so a producer who
       * downgrades a lead while leaving a note gets type 'note', not 'grade_override' —
       * which is how 244 of the 354 grade changes in this database came to be filed
       * under 'note'. The QC Grade Changes report was written to join on
       * type = 'grade_override' and therefore showed 5 of the 92 downgrades in a
       * renewal week, making it look as though ~90 Grade A leads had vanished.
       *
       * That report now matches on `metadata -> 'changes'` containing a Grade entry,
       * which is the only thing every path writes. So:
       *   • Keep pushing {field, from, to} into changeDetails for anything worth
       *     reporting on — that, not the type, is what makes a change findable.
       *   • Do NOT "tidy" the metadata shape or move Grade out of `changes` without
       *     updating reports.service.ts, or the report goes quietly blind again.
       */
      await addActivity(
        existing.id,
        _activityType || (grade ? 'grade_override' : statusC ? 'status_change' : 'edit'),
        _activityNote || changes.join(' · '),
        { changes: changeDetails },
        actor,
      );
    }

    const updated = await getLeadByPropertyId(id);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('PUT /api/leads/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update lead' }, { status: 500 });
  }
}
