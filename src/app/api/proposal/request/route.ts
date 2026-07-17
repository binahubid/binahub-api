import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

function getAppUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (configured && !configured.includes('buhanib.vercel.app')) {
    return configured.replace(/\/$/, '');
  }
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://app.binahub.id';
}

export async function GET(req: NextRequest) {
  const assessmentId = req.nextUrl.searchParams.get('assessmentId');

  if (!assessmentId) {
    return NextResponse.redirect(new URL('/assessment?error=invalid', getAppUrl()));
  }

  const supabase = createServerSupabase();

  const { data: assessment, error } = await supabase
    .from('assessments')
    .select('id, assessment_status, proposal_status')
    .eq('id', assessmentId)
    .single();

  if (error || !assessment) {
    return NextResponse.redirect(new URL('/assessment?error=not_found', getAppUrl()));
  }

  const terminalStatuses = ['Diminta', 'Sedang Disusun', 'Terkirim', 'Revisi', 'Lanjut Diskusi', 'Deal', 'Lost', 'Closed'];
  if (terminalStatuses.includes(assessment.proposal_status || '')) {
    return NextResponse.redirect(new URL(`/assessment?info=proposal_already_requested&id=${assessmentId}`, getAppUrl()));
  }

  const { error: updateError } = await supabase
    .from('assessments')
    .update({
      assessment_status: 'Minta Proposal',
      proposal_status: 'Diminta',
      proposal_requested_at: new Date().toISOString(),
    })
    .eq('id', assessmentId);

  if (updateError) {
    console.error('[API] Failed to update proposal status:', updateError);
    return NextResponse.redirect(new URL('/assessment?error=update_failed', getAppUrl()));
  }

  return NextResponse.redirect(new URL(`/assessment?info=proposal_requested&id=${assessmentId}`, getAppUrl()));
}
