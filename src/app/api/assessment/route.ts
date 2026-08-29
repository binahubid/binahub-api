import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createServerSupabase } from '@/lib/supabase';
import { analyzeAssessment } from '@/lib/ai-service';
import { sendAssessmentEmail } from '@/lib/email-service';
import { generatePDFBuffer, AssessmentResult } from '@/lib/pdf-service';
import { AssessmentSchema } from '@/lib/validations';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireTransformationActor } from '@/lib/transformation/auth';
import { isProgramModuleEnabled } from '@/lib/program-access';
import { qualifyLead } from '@/lib/lead-qualification';

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

    let retryAssessmentId: string | null = null;
    if (submissionKeyHash) {
      const { data: existing, error: existingError } = await supabase
        .from('assessments')
        .select('id, scores, category, assessment_status, result_email_sent_at')
        .eq('submission_key_hash', submissionKeyHash)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existing) {
        if (existing.scores && existing.assessment_status !== 'Analisis Gagal') {
          return NextResponse.json({
            success: true,
            assessmentId: existing.id,
            category: existing.category,
            reused: true,
            emailFailed: !existing.result_email_sent_at,
          });
        }

        if (existing.assessment_status === 'Analisis Gagal') {
          retryAssessmentId = existing.id;
        } else {
          return NextResponse.json(
            { success: false, error: isEnglish ? 'This assessment is still being processed.' : 'Assessment ini masih diproses.' },
            { status: 409 },
          );
        }
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
        budgetStatus: body.budgetStatus || 'unknown',
        sponsorStatus: body.sponsorStatus || 'unknown',
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
    const assessmentQuery = retryAssessmentId
      ? supabase
          .from('assessments')
          .update({
            lead_id: lead.id,
            form_data: body,
            scores: null,
            category: null,
            ai_analysis: null,
            recommendations: null,
            overall_score: null,
            assessment_status: 'Belum Dikirim',
            program_id: programContext?.programId || null,
            participant_id: programContext?.participantId || null,
            attribution: body.attribution,
          })
          .eq('id', retryAssessmentId)
      : supabase
          .from('assessments')
          .insert({
            lead_id: lead.id,
            form_data: body,
            submission_key_hash: submissionKeyHash,
            program_id: programContext?.programId || null,
            participant_id: programContext?.participantId || null,
            attribution: body.attribution,
          });

    const { data: assessment, error: assessmentError } = await assessmentQuery.select().single();

    if (assessmentError) {
      if (assessmentError.code === '23505' && submissionKeyHash) {
        return NextResponse.json(
          { success: false, error: isEnglish ? 'This assessment is already being processed.' : 'Assessment ini sudah sedang diproses.' },
          { status: 409 },
        );
      }
      console.error('[API Error] Supabase Assessment error:', assessmentError);
      throw assessmentError;
    }

    // 4. AI Analysis & Scoring
    let aiResult;
    try {
      aiResult = await analyzeAssessment(body, body.locale);
    } catch (aiError: unknown) {
      console.error('[API Error] AI Analysis failed:', getErrorMessage(aiError));
      await supabase.from('assessments').update({ assessment_status: 'Analisis Gagal' }).eq('id', assessment.id);
      return NextResponse.json(
        {
          success: false,
          error: body.locale === 'en'
            ? 'Failed to run AI analysis. Please try again shortly.'
            : 'Gagal melakukan analisis AI. Silakan coba beberapa saat lagi.',
        },
        { status: 502 }
      );
    }

    // 5. Update assessment with AI results and calculated score
    const { error: resultUpdateError } = await supabase
      .from('assessments')
      .update({
        scores: aiResult.scores,
        category: aiResult.category,
        ai_analysis: aiResult.analysis,
        recommendations: aiResult.recommendations,
        overall_score: aiResult.scores.overall,
      })
      .eq('id', assessment.id);
    if (resultUpdateError) throw resultUpdateError;

    // 6. Apply the confirmed deterministic qualification rules. AI analysis may
    // enrich the assessment, but it cannot bypass commercial thresholds.
    try {
      const leadQualification = qualifyLead({
        assessmentCompleted: true,
        employees: body.employees,
        role: body.role,
        challenge: body.challenge,
        target: body.target,
        industry: body.industry,
        location: body.location,
        timelineKnown: body.timeline !== 'unknown',
        sponsorKnown: ['sponsor_confirmed', 'decision_maker'].includes(body.sponsorStatus || 'unknown'),
        budgetKnown: ['range_known', 'allocated'].includes(body.budgetStatus || 'unknown'),
        meetingIntent: ['consultation', 'proposal'].includes(body.nextStepIntent || 'explore'),
        businessConsequenceKnown: Boolean(body.businessConsequence && body.businessConsequence.trim().length >= 20),
      });
      const { error: leadScoreUpdateError } = await supabase
        .from('leads')
        .update({
          lead_score: leadQualification.score,
          lead_status: leadQualification.temperature,
          lead_temperature: leadQualification.temperature,
          lead_score_confidence: leadQualification.confidence,
          lead_score_reason: leadQualification.reasoning,
          lead_score_evidence: leadQualification,
          lead_score_rule_version: leadQualification.ruleVersion,
          lifecycle_stage: 'lead',
          opportunity_stage: leadQualification.temperature === 'hot' ? 'qualified' : 'identified',
          last_meaningful_activity_at: new Date().toISOString(),
        })
        .eq('id', lead.id);
      if (leadScoreUpdateError) throw leadScoreUpdateError;
    } catch (leadScoreError: unknown) {
      console.warn('[API Warning] Lead scoring failed:', getErrorMessage(leadScoreError));
    }

    // 7. Generate PDF
    const resultObj: AssessmentResult = {
      scores: aiResult.scores,
      category: aiResult.category,
      aiAnalysis: aiResult.analysis,
      archetype: aiResult.archetype,
      scoreInterpretation: aiResult.scoreInterpretation,
      crossDimensionalInsights: aiResult.crossDimensionalInsights,
      riskProjection: aiResult.riskProjection,
      strategicKey: aiResult.strategicKey,
      recommendations: aiResult.recommendations,
    };

    let pdfBuffer: Buffer | undefined;
    try {
      console.log('[API] Starting PDF Generation (React-PDF)...');
      pdfBuffer = await generatePDFBuffer(body, resultObj, body.locale);
    } catch (pdfErr: unknown) {
      console.error('[API Error] PDF Generation failed:', getErrorMessage(pdfErr));
    }

    // 8. Send email
    let emailFailed = false;
    try {
      const emailIds = await sendAssessmentEmail(body, resultObj, pdfBuffer, assessment.id, body.locale);
      const sentAt = new Date().toISOString();
      const withEmailId = await supabase
        .from('assessments')
        .update({
          assessment_status: 'Result Email Terkirim',
          result_email_sent_at: sentAt,
          proposal_status: 'Belum Diminta',
          result_email_id: emailIds?.clientEmailId || null,
        })
        .eq('id', assessment.id);

      if (withEmailId.error) {
        await supabase
          .from('assessments')
          .update({
            assessment_status: 'Result Email Terkirim',
            result_email_sent_at: sentAt,
            proposal_status: 'Belum Diminta',
          })
          .eq('id', assessment.id);
      }
      console.log('[API] Email sent successfully:', emailIds);
    } catch (emailError: unknown) {
      emailFailed = true;
      console.error('[API Error] Email sending failed:', getErrorMessage(emailError));
      // Log to email_failures for retry
      try {
        await supabase.from('email_failures').insert({
          target_type: 'assessment',
          target_id: assessment.id,
          error: getErrorMessage(emailError),
          retry_count: 0,
        });
      } catch {
        // Silently fail on error logging
      }
    }

    return NextResponse.json({
      success: true,
      assessmentId: assessment.id,
      scores: aiResult.scores,
      category: aiResult.category,
      emailFailed,
    });
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
