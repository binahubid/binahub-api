import { after, NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createServerSupabase } from '@/lib/supabase';
import { processAssessmentJob } from '@/lib/assessment-worker';
import { AssessmentSchema } from '@/lib/validations';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireTransformationActor } from '@/lib/transformation/auth';
import { isProgramModuleEnabled } from '@/lib/program-access';
import { classifyInboundAttribution, compactInboundAttribution } from '@/lib/inbound-journey';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_ASSESSMENT_BODY_BYTES = 64 * 1024;
const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9._:-]{16,128}$/;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function getOptionalProgramContext(
  req: NextRequest,
  db: ReturnType<typeof createServerSupabase>,
) {
  if (!req.headers.get('authorization')) return null;

  const actor = await requireTransformationActor(req);
  if (
    'error' in actor
    || actor.role !== 'client'
    || !actor.programId
    || !actor.participantId
  ) {
    return null;
  }

  try {
    const enabled = await isProgramModuleEnabled(db, actor.programId, 'binainsight');
    return enabled
      ? { programId: actor.programId, participantId: actor.participantId }
      : null;
  } catch (error) {
    console.warn('[Assessment API] Program context could not be resolved:', getErrorMessage(error));
    return null;
  }
}

export async function POST(req: NextRequest) {
  let requestLocale = 'id';

  try {
    const rateLimited = await enforceRateLimit(req, 'assessment', 5, 60 * 60);
    if (rateLimited) return rateLimited;

    const idempotencyKey = req.headers.get('idempotency-key')?.trim() || '';
    if (idempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return NextResponse.json({ success: false, error: 'Idempotency-Key tidak valid.' }, { status: 400 });
    }

    const rawText = await req.text();
    if (Buffer.byteLength(rawText, 'utf8') > MAX_ASSESSMENT_BODY_BYTES) {
      return NextResponse.json({ success: false, error: 'Payload assessment terlalu besar.' }, { status: 413 });
    }

    let rawBody: unknown;
    try {
      rawBody = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ success: false, error: 'Payload JSON tidak valid.' }, { status: 400 });
    }

    const isEnglish = Boolean(
      rawBody
      && typeof rawBody === 'object'
      && 'locale' in rawBody
      && rawBody.locale === 'en'
    );
    requestLocale = isEnglish ? 'en' : 'id';
    
    // 1. Zod Validation
    const validationResult = AssessmentSchema.safeParse(rawBody);
    if (!validationResult.success) {
      console.error('[API Error] Validation failed:', validationResult.error.format());
      return NextResponse.json(
        {
          success: false,
          error: isEnglish ? 'Data validation failed' : 'Validasi data gagal',
          details: validationResult.error.issues[0]?.message,
        },
        { status: 400 }
      );
    }
    
    const body = validationResult.data;
    const supabase = createServerSupabase();
    const programContext = await getOptionalProgramContext(req, supabase);
    const submissionKeyHash = idempotencyKey
      ? createHash('sha256').update(idempotencyKey).digest('hex')
      : null;

    // Fail before accepting a submission when the durable queue migration is absent.
    const queueReady = await supabase.from('assessment_jobs').select('assessment_id').limit(0);
    if (queueReady.error) throw queueReady.error;
    if (submissionKeyHash) {
      const existingResult = await supabase.from('assessments')
        .select('id,category,result_email_sent_at').eq('submission_key_hash', submissionKeyHash).maybeSingle();
      if (existingResult.error) throw existingResult.error;
      if (existingResult.data) {
        const existing = existingResult.data;
        after(() => processAssessmentJob(existing.id).then(() => undefined));
        return NextResponse.json({
          success: true, assessmentId: existing.id, category: existing.category,
          processing: !existing.result_email_sent_at, reused: true,
        }, { status: existing.result_email_sent_at ? 200 : 202 });
      }
    }

    // 2. Upsert lead
    const leadPayload = {
      name: body.name,
      email: body.email,
      company: body.company,
      industry: body.industry || null,
      location: body.location || null,
      qualification_profile: {
        employees: body.employees || null,
        role: body.role || null,
        timeline: body.timeline || 'unknown',
        ...(body.budgetStatus ? { budgetStatus: body.budgetStatus } : {}),
        ...(body.sponsorStatus ? { sponsorStatus: body.sponsorStatus } : {}),
        nextStepIntent: body.nextStepIntent || 'explore',
        businessConsequence: body.businessConsequence || null,
      },
      phone: body.whatsapp || '',
      source: body.source || 'insight_assessment',
      last_meaningful_activity_at: new Date().toISOString(),
      ...(Object.keys(body.attribution).length > 0 ? { source_metadata: body.attribution } : {}),
    };
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .upsert(leadPayload, { onConflict: 'email', ignoreDuplicates: false })
      .select()
      .single();

    if (leadError) {
      console.error('[API Error] Supabase Lead error:', leadError);
      throw leadError;
    }

    // 3. Save raw assessment
    const assessmentQuery = supabase.from('assessments').insert({
      lead_id: lead.id, form_data: body, submission_key_hash: submissionKeyHash,
      program_id: programContext?.programId || null, participant_id: programContext?.participantId || null,
      attribution: body.attribution,
    });

    const { data: assessment, error: assessmentError } = await assessmentQuery.select().single();

    if (assessmentError) {
      if (assessmentError.code === '23505' && submissionKeyHash) {
        const duplicate = await supabase.from('assessments').select('id')
          .eq('submission_key_hash', submissionKeyHash).single();
        if (duplicate.error || !duplicate.data) throw assessmentError;
        after(() => processAssessmentJob(duplicate.data.id).then(() => undefined));
        return NextResponse.json({ success: true, assessmentId: duplicate.data.id, processing: true, reused: true }, { status: 202 });
      }
      console.error('[API Error] Supabase Assessment error:', assessmentError);
      throw assessmentError;
    }

    // The insert trigger creates a durable job in the same transaction.
    const queued = await supabase.from('assessment_jobs').select('assessment_id')
      .eq('assessment_id', assessment.id).single();
    if (queued.error || !queued.data) throw queued.error || new Error('Assessment queue unavailable');
    after(async () => {
      // Journey attribution is evidence-only. A missing Phase 20 migration must
      // never block a public assessment that was otherwise valid.
      try {
        const { data: recordedJourneyId, error: journeyError } = await supabase.rpc('record_inbound_journey_event', {
          p_journey_id: body.journeyId || null,
          p_event_type: 'assessment_submitted',
          p_route_path: '/insight',
          p_attribution: compactInboundAttribution(body.attribution),
          p_channel: classifyInboundAttribution(body.attribution),
          p_module_codes: [],
        });
        if (journeyError) throw journeyError;
        if (recordedJourneyId) {
          const { error: linkError } = await supabase.rpc('link_inbound_journey_to_lead', {
            p_journey_id: recordedJourneyId, p_lead_id: lead.id, p_link_type: 'assessment',
          });
          if (linkError) throw linkError;
        }
      } catch (journeyError) {
        console.warn('[Assessment API] Inbound journey was not recorded:', getErrorMessage(journeyError));
      }

      await processAssessmentJob(assessment.id);
    });
    return NextResponse.json({
      success: true, assessmentId: assessment.id, processing: true,
    }, { status: 202 });
  } catch (error: unknown) {
    console.error('[Assessment API Error]', error);
    return NextResponse.json(
      {
        success: false,
        error: requestLocale === 'en' ? 'An internal server error occurred.' : 'Terjadi kesalahan internal server.',
      },
      { status: 500 }
    );
  }
}
