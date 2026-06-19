import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { analyzeAssessment, scoreLeadWithAI } from '@/lib/ai-service';
import { sendAssessmentEmail } from '@/lib/email-service';
import { generatePDFBuffer, AssessmentResult } from '@/lib/pdf-service';
import { AssessmentSchema } from '@/lib/validations';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: NextRequest) {
  let requestLocale = 'id';

  try {
    const rawBody = await req.json();
    const isEnglish = rawBody?.locale === 'en';
    requestLocale = isEnglish ? 'en' : 'id';
    
    // 1. Zod Validation
    const validationResult = AssessmentSchema.safeParse(rawBody);
    if (!validationResult.success) {
      console.error('[API Error] Validation failed:', validationResult.error.format());
      return NextResponse.json(
        {
          success: false,
          error: isEnglish ? 'Data validation failed' : 'Validasi data gagal',
          details: validationResult.error.format(),
        },
        { status: 400 }
      );
    }
    
    const body = validationResult.data;
    const supabase = createServerSupabase();

    // 2. Upsert lead
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .upsert(
        {
          name: body.name,
          email: body.email,
          company: body.company,
          phone: body.whatsapp || '',
          source: body.source || 'insight_assessment',
        },
        { onConflict: 'email', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (leadError) {
      console.error('[API Error] Supabase Lead error:', leadError);
      throw leadError;
    }

    // 3. Save raw assessment
    const { data: assessment, error: assessmentError } = await supabase
      .from('assessments')
      .insert({ 
        lead_id: lead.id, 
        form_data: body 
      })
      .select()
      .single();

    if (assessmentError) {
      console.error('[API Error] Supabase Assessment error:', assessmentError);
      throw assessmentError;
    }

    // 4. AI Analysis & Scoring
    let aiResult;
    try {
      aiResult = await analyzeAssessment(body, body.locale);
    } catch (aiError: unknown) {
      console.error('[API Error] AI Analysis failed:', getErrorMessage(aiError));
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
    await supabase
      .from('assessments')
      .update({
        scores: aiResult.scores,
        category: aiResult.category,
        ai_analysis: aiResult.analysis,
        recommendations: aiResult.recommendations,
        overall_score: aiResult.scores.overall,
      })
      .eq('id', assessment.id);

    // 6. Score the lead with AI (non-blocking)
    scoreLeadWithAI({
      source: body.source || 'insight_assessment',
      assessmentCompleted: true,
      name: body.name,
      company: body.company,
      challenge: body.challenge,
    }).then(async (leadScore) => {
      await supabase
        .from('leads')
        .update({ lead_score: leadScore.score, lead_status: leadScore.status })
        .eq('id', lead.id);
    }).catch((e: unknown) => console.warn('[API Warning] Lead scoring background task failed:', getErrorMessage(e)));

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
    } catch (emailError: unknown) {
      console.error('[API Error] Email sending failed:', getErrorMessage(emailError));
    }

    return NextResponse.json({
      success: true,
      assessmentId: assessment.id,
      leadId: lead.id,
      scores: aiResult.scores,
      category: aiResult.category,
      analysis: aiResult.analysis,
      recommendations: aiResult.recommendations,
    });
  } catch (error: unknown) {
    console.error('[Assessment API Error]', error);
    return NextResponse.json(
      {
        success: false,
        error: requestLocale === 'en' ? 'An internal server error occurred.' : 'Terjadi kesalahan internal server.',
        details: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
