import { createServerSupabase } from './supabase';
import { analyzeAssessment } from './ai-service';
import { sendAssessmentEmail } from './email-service';
import { generatePDFBuffer, type AssessmentResult } from './pdf-service';
import { AssessmentSchema } from './validations';
import { qualifyPublicAssessment } from './lead-qualification';
import { assessmentAreaCopy } from './assessment-area-copy';

type Analysis = Awaited<ReturnType<typeof analyzeAssessment>>;
type Job = { assessment_id: string; lease_token: string; attempts: number; ai_result: Analysis | null };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

// Called after HTTP acceptance and by the recovery scheduler. Database claims,
// not browser lifetime or in-memory promises, decide who may process a submission.
export async function processAssessmentJob(assessmentId?: string) {
  const db = createServerSupabase();
  const { data: claims, error: claimError } = await db.rpc('claim_assessment_job', { p_assessment_id: assessmentId || null });
  if (claimError) throw claimError;
  const job = (claims as Job[] | null)?.[0];
  if (!job) return { processed: false };
  let emailStarted = false;
  const saveJob = async (patch: Record<string, unknown>) => {
    const result = await db.from('assessment_jobs').update({ ...patch, updated_at: new Date().toISOString() })
      .eq('assessment_id', job.assessment_id).eq('lease_token', job.lease_token).select('assessment_id').single();
    if (result.error || !result.data) throw result.error || new Error('Assessment job lease lost');
  };
  try {
    const { data: assessment, error } = await db.from('assessments').select('id,lead_id,form_data,result_email_sent_at')
      .eq('id', job.assessment_id).single();
    if (error || !assessment) throw error || new Error('Assessment missing');
    if (assessment.result_email_sent_at) {
      await saveJob({ status: 'completed' });
      return { processed: true, status: 'completed' };
    }
    const body = AssessmentSchema.parse(assessment.form_data);
    const ai = assessmentAreaCopy(job.ai_result || await analyzeAssessment(body, body.locale));
    await saveJob({ ai_result: ai });
    const updated = await db.from('assessments').update({
      scores: ai.scores, category: ai.category, ai_analysis: ai.analysis,
      recommendations: ai.recommendations, overall_score: ai.scores.overall,
    }).eq('id', assessment.id);
    if (updated.error) throw updated.error;
    const qualification = qualifyPublicAssessment(body);
    const leadUpdate = await db.from('leads').update({
      lead_score: qualification.score, lead_status: qualification.temperature,
      lead_temperature: qualification.temperature, lead_score_confidence: qualification.confidence,
      lead_score_reason: qualification.reasoning, lead_score_evidence: qualification,
      lead_score_rule_version: qualification.ruleVersion, lifecycle_stage: 'lead',
      opportunity_stage: qualification.temperature === 'hot' ? 'qualified' : 'identified',
      last_meaningful_activity_at: new Date().toISOString(),
    }).eq('id', assessment.lead_id);
    if (leadUpdate.error) console.warn('[Assessment worker] Qualification update failed:', leadUpdate.error.message);
    const result: AssessmentResult = {
      scores: ai.scores, category: ai.category, aiAnalysis: ai.analysis,
      archetype: ai.archetype, scoreInterpretation: ai.scoreInterpretation,
      crossDimensionalInsights: ai.crossDimensionalInsights, riskProjection: ai.riskProjection,
      strategicKey: ai.strategicKey, recommendations: ai.recommendations,
    };
    const pdf = await generatePDFBuffer(body, result, body.locale);
    // Record the irreversible boundary before contacting the email provider.
    await saveJob({ status: 'emailing' });
    emailStarted = true;
    const emailIds = await sendAssessmentEmail(body, result, pdf, assessment.id, body.locale);
    const sent = await db.from('assessments').update({
      assessment_status: 'Result Email Terkirim', result_email_sent_at: new Date().toISOString(),
      result_email_id: emailIds?.clientEmailId || null,
    }).eq('id', assessment.id);
    if (sent.error) throw sent.error;
    await saveJob({ status: 'completed', last_error: null });
    return { processed: true, status: 'completed' };
  } catch (error) {
    const status = emailStarted ? 'uncertain' : job.attempts < 3 ? 'pending' : 'failed';
    await saveJob({ status, last_error: message(error).slice(0, 1000), available_at: new Date(Date.now() + 60_000).toISOString() });
    if (status === 'failed') await db.from('assessments').update({ assessment_status: 'Analisis Gagal' }).eq('id', job.assessment_id);
    if (status === 'uncertain') await db.from('email_failures').insert({
      target_type: 'assessment', target_id: job.assessment_id,
      error: 'Perlu rekonsiliasi: ' + message(error).slice(0, 900), retry_count: 0,
    });
    console.warn('[Assessment worker] Job held:', job.assessment_id, status);
    return { processed: true, status };
  }
}
