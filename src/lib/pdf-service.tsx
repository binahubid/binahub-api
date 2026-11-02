import React from 'react';
import { AssessmentData } from './validations';
import type { Locale } from '@/i18n/config';
import { EnterpriseAssessmentReport } from './assessment-report-enterprise';
import { SignatureProposalReport } from './signature-proposal-report';
import { assessmentAreaCopy } from './assessment-area-copy';

export interface AssessmentResult {
  scores: Record<string, number> & { overall: number };
  category: string;
  aiAnalysis: string;
  archetype?: string;
  scoreInterpretation?: string;
  crossDimensionalInsights?: string[];
  riskProjection?: string;
  strategicKey?: string;
  recommendations: {
    title: string;
    diagnosis?: string;
    description: string;
    priority: string;
    service: string;
  }[];
}

export interface ProposalPackage {
  name: string;
  price: string;
  bestFor: string;
  duration: string;
  scope: string[];
  deliverables: string[];
}

export interface ProposalResult {
  documentKind?: 'preliminary' | 'commercial';
  proposalType?: 'standard' | 'custom';
  learningObjectives?: string[];
  deliverables?: string[];
  selectedSolutions?: Array<{ code: string; name: string; nameEn?: string; focus: string; focusEn?: string }>;
  subject?: string;
  opening?: string;
  proposedProgram?: string;
  scope?: string[];
  timeline?: string;
  investmentNote?: string;
  packages?: ProposalPackage[];
  nextStep?: string;
  isSimulation?: boolean;
  rulesVersion?: string;
  commercialSnapshot?: {
    items: Array<{
      name: string;
      quantity: number;
      pricingUnit: string;
      basePrice: number;
      lineTotal: number;
    }>;
    subtotal: number;
    discountPercent: number;
    discountAmount: number;
    totalBeforeTax: number;
    currency?: string;
    validityDays?: number;
  };
}

export async function generatePDFBuffer(formData: AssessmentData, result: AssessmentResult, locale: Locale = 'id'): Promise<Buffer> {
  const { renderToBuffer } = await import('@react-pdf/renderer');
  return await renderToBuffer(<EnterpriseAssessmentReport formData={formData} result={assessmentAreaCopy(result)} locale={locale} />);
}

export async function generateProposalPDFBuffer(formData: AssessmentData, proposal: ProposalResult, locale: Locale = 'id', issuedAt?: string): Promise<Buffer> {
  const { renderToBuffer } = await import('@react-pdf/renderer');
  const effectiveIssuedAt = issuedAt || new Date().toISOString();
  return await renderToBuffer(<SignatureProposalReport formData={formData} proposal={proposal} locale={locale} issuedAt={effectiveIssuedAt} />);
}


