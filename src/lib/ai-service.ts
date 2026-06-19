import OpenAI from 'openai';
import { AssessmentData, DIMENSIONS } from './validations';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'arcee-ai/trinity-large-thinking:free';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';
const COMPANY_NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || 'PT BinaHub';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': APP_URL,
    'X-Title': COMPANY_NAME,
  },
});

type AIMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type AIRecommendationDraft = {
  service?: string;
  diagnosis?: string;
  [key: string]: unknown;
};

async function callAI(messages: AIMessage[], _jsonMode: boolean = false) {
  void _jsonMode;

  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  try {
    const response = await openai.chat.completions.create({
      model: OPENROUTER_MODEL,
      messages: messages,
      // Beberapa model gratis tidak mendukung JSON mode, kita matikan agar lebih kompatibel
      // response_format: jsonMode ? { type: 'json_object' } : undefined,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from AI model');
    }
    return content;
  } catch (error: unknown) {
    console.error(`[AI Error] OpenRouter call failed:`, error instanceof Error ? error.message : error);
    throw error;
  }
}

export async function analyzeAssessment(data: AssessmentData, locale: 'id' | 'en' = data.locale || 'id') {
  // Group answers by dimension for cleaner analysis
  const dimensionScores: Record<string, number> = {};
  const dimensionDetails: Record<string, number[]> = {};

  DIMENSIONS.forEach((dim, index) => {
    const start = index * 7 + 1;
    const end = start + 6;
    const scores: number[] = [];
    for (let i = start; i <= end; i++) {
      scores.push(data.answers[i.toString()] || 0);
    }
    const sum = scores.reduce((a, b) => a + b, 0);
    dimensionScores[dim] = Math.round((sum / 35) * 100);
    dimensionDetails[dim] = scores;
  });

  const totalSum = Object.values(data.answers).reduce((a, b) => a + b, 0);
  const overallScore = Math.round((totalSum / 245) * 100);
  const sortedDimensions = [...DIMENSIONS].sort((a, b) => dimensionScores[b] - dimensionScores[a]);
  const topDimension = sortedDimensions[0];
  const lowestDimension = sortedDimensions[sortedDimensions.length - 1];
  const secondLowestDimension = sortedDimensions[sortedDimensions.length - 2];

  const isEnglish = locale === 'en';
  const categoryRule = isEnglish
    ? `- Starter: < 40%
- Developing: 40-60%
- Professional: 61-80%
- Leading: > 80%`
    : `- Pemula: < 40%
- Berkembang: 40-60%
- Profesional: 61-80%
- Unggulan: > 80%`;
  const categoryExamples = isEnglish
    ? '<Starter|Developing|Professional|Leading>'
    : '<Pemula|Berkembang|Profesional|Unggulan>';
  const archetypeExamples = isEnglish
    ? '<2-4 word English label that describes the organization profile, examples: Strategic Builder, Execution Operator, Analytics Explorer, Growth Transformer>'
    : '<label 2-4 kata Bahasa Indonesia yang menggambarkan profil organisasi, contoh: Pembangun Strategis, Operator Eksekusi, Eksplorator Analitik, Transformer Pertumbuhan>';
  const prompt = isEnglish ? `
You are the Senior Consulting Team from PT BinaHub - Human Synergy Partner.
Analyze the following diagnostic assessment data and provide a professional, sharp, and specific evaluation for the respondent's organization. NEVER mention that you are AI or an automated system. Act as a senior human consultant.

Mandatory analysis style:
- All output must be in English.
- Diagnose first, solution second.
- Avoid generic phrases such as "improve synergy", "optimize HR", or "drive transformation" without context.
- Use cross-dimensional reasoning: connect at least two dimension scores to explain a pattern.
- Explain business implications or execution risks, not just recommendations.
- Recommendations must feel derived from the scores, challenge, goal, role, and organization scale.
- Do not invent benchmarks or industry claims without data.

RESPONDENT DATA:
Name: ${data.name}
Company: ${data.company}
Scale (Employees): ${data.employees || '-'}
Role: ${data.role || '-'}
Main Challenge: ${data.challenge || '-'}
Goal to Achieve: ${data.target || '-'}

DIMENSION SCORES (0-100%):
${DIMENSIONS.map(dim => `- ${dim}: ${dimensionScores[dim]}%`).join('\n')}

OVERALL SCORE: ${overallScore}%
HIGHEST DIMENSION: ${topDimension} (${dimensionScores[topDimension]}%)
LOWEST DIMENSION: ${lowestDimension} (${dimensionScores[lowestDimension]}%)
SECOND LOWEST DIMENSION: ${secondLowestDimension} (${dimensionScores[secondLowestDimension]}%)

Return JSON exactly like this, no markdown:
{
  "category": "${categoryExamples}",
  "archetype": "${archetypeExamples}",
  "scoreInterpretation": "<2 sentences explaining the overall score contextually for this company. Explain whether this indicates a strong foundation, developing phase, or risk area.>",
  "analysis": "<4-5 sentence executive analysis. Mention cross-dimensional patterns, main strength, main bottleneck, and business implications.>",
  "crossDimensionalInsights": [
    "<insight 1 connecting two or more dimensions and explaining what it means>",
    "<insight 2 connecting two or more dimensions and explaining what it means>"
  ],
  "riskProjection": "<12-18 month risk projection if the main gap is not addressed. Specific, not exaggerated.>",
  "strategicKey": "<90-day strategic key paragraph. Focus on priorities and business consequences.>",
  "recommendations": [
    {
      "title": "<recommendation title>",
      "diagnosis": "<1 sentence diagnosis explaining why this recommendation is relevant based on the data>",
      "description": "<concrete action description personalized to the organization context>",
      "priority": "<high|medium|low>",
      "service": "<relevant PT BinaHub service name: Insights, Lab, Coach, Play, Academy, Works, or Impact>"
    }
  ]
}

Create 5 specific and actionable recommendations. Each recommendation must start from diagnosis, then action. Category rules:
${categoryRule}
` : `
Kamu adalah Tim Konsultan Senior dari PT BinaHub - Human Synergy Partner.
Analisis data diagnostic assessment berikut dan berikan penilaian profesional, tajam, dan terasa spesifik untuk organisasi responden. JANGAN PERNAH menyebutkan bahwa kamu adalah AI atau sistem otomatis. Berperanlah sebagai konsultan manusia senior.

Gaya analisis wajib:
- Semua output wajib menggunakan Bahasa Indonesia. Jangan gunakan label, istilah profil, atau archetype berbahasa Inggris.
- Diagnosis dulu, solusi kedua.
- Hindari bahasa generik seperti "meningkatkan sinergi", "mengoptimalkan SDM", atau "mendorong transformasi" tanpa konteks.
- Gunakan cross-dimensional reasoning: hubungkan minimal dua skor dimensi untuk menjelaskan pola.
- Jelaskan implikasi bisnis atau risiko eksekusi, bukan hanya daftar rekomendasi.
- Rekomendasi harus terasa lahir dari skor, tantangan, goal, jabatan, dan skala organisasi.
- Jangan memberikan benchmark palsu atau klaim industri yang tidak ada datanya.

DATA RESPONDEN:
Nama: ${data.name}
Perusahaan: ${data.company}
Skala (Karyawan): ${data.employees || '-'}
Jabatan: ${data.role || '-'}
Tantangan Utama: ${data.challenge || '-'}
Goal yang Ingin Dicapai: ${data.target || '-'}

DATA SKOR DIMENSI (0-100%):
${DIMENSIONS.map(dim => `- ${dim}: ${dimensionScores[dim]}%`).join('\n')}

SKOR KESELURUHAN: ${overallScore}%
DIMENSI TERTINGGI: ${topDimension} (${dimensionScores[topDimension]}%)
DIMENSI TERENDAH: ${lowestDimension} (${dimensionScores[lowestDimension]}%)
DIMENSI TERENDAH KEDUA: ${secondLowestDimension} (${dimensionScores[secondLowestDimension]}%)

Berikan output dalam format JSON PERSIS seperti ini (tanpa markdown, langsung JSON):
{
  "category": "${categoryExamples}",
  "archetype": "${archetypeExamples}",
  "scoreInterpretation": "<2 kalimat yang menjelaskan arti skor keseluruhan secara kontekstual untuk perusahaan ini. Jelaskan apakah ini fondasi kuat, fase berkembang, atau area risiko.>",
  "analysis": "<paragraf analisis eksekutif 4-5 kalimat. Harus menyebut pola lintas dimensi, kekuatan utama, bottleneck utama, dan implikasi bisnis.>",
  "crossDimensionalInsights": [
    "<insight 1 yang menghubungkan dua atau lebih dimensi dan menjelaskan maknanya>",
    "<insight 2 yang menghubungkan dua atau lebih dimensi dan menjelaskan maknanya>"
  ],
  "riskProjection": "<proyeksi risiko 12-18 bulan jika gap utama tidak ditangani. Spesifik, tidak menakut-nakuti berlebihan.>",
  "strategicKey": "<paragraf kunci strategis 90 hari ke depan. Fokus pada prioritas dan konsekuensi bisnis.>",
  "recommendations": [
    {
      "title": "<judul rekomendasi>",
      "diagnosis": "<1 kalimat diagnosis yang menjelaskan mengapa rekomendasi ini relevan berdasarkan data>",
      "description": "<deskripsi aksi konkret yang personal untuk konteks organisasi>",
      "priority": "<high|medium|low>",
      "service": "<nama layanan PT BinaHub yang relevan (Insights, Lab, Coach, Play, Academy, Works, atau Impact)>"
    }
  ]
}

Buat 5 rekomendasi yang spesifik dan actionable. Setiap rekomendasi harus diawali diagnosis, lalu aksi. Kategori ditentukan oleh skor keseluruhan:
- Pemula: < 40%
- Berkembang: 40-60%
- Profesional: 61-80%
- Unggulan: > 80%
`;

  const text = await callAI([
    {
      role: 'system',
      content: isEnglish
        ? 'You are a senior human business consultant from PT BinaHub. All output must be in English and JSON only.'
        : 'Anda adalah konsultan bisnis senior manusia dari PT BinaHub. Seluruh output harus berbahasa Indonesia dan berbentuk JSON saja.'
    },
    { role: 'user', content: prompt }
  ], true);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Invalid AI response format');

  const aiResult = JSON.parse(jsonMatch[0]);
  const fallbackArchetype = isEnglish
    ? overallScore >= 80 ? 'Growth Transformer' : overallScore >= 61 ? 'Strategic Builder' : overallScore >= 40 ? 'Developing Operator' : 'Early Builder'
    : overallScore >= 80 ? 'Transformer Pertumbuhan' : overallScore >= 61 ? 'Pembangun Strategis' : overallScore >= 40 ? 'Operator Berkembang' : 'Pembangun Awal';
  const fallbackCategory = isEnglish
    ? overallScore > 80 ? 'Leading' : overallScore >= 61 ? 'Professional' : overallScore >= 40 ? 'Developing' : 'Starter'
    : aiResult.category;

  return {
    ...aiResult,
    category: aiResult.category || fallbackCategory,
    archetype: aiResult.archetype || fallbackArchetype,
    scoreInterpretation: aiResult.scoreInterpretation || (isEnglish
      ? `A score of ${overallScore}% places ${data.company} in the ${fallbackCategory} category. This indicates a foundation that can be strengthened through sharper priorities around the ${lowestDimension} dimension.`
      : `Skor ${overallScore}% menempatkan ${data.company} pada kategori ${aiResult.category}. Ini menunjukkan adanya fondasi yang dapat dikembangkan lebih lanjut melalui prioritas yang lebih tajam pada dimensi ${lowestDimension}.`),
    crossDimensionalInsights: Array.isArray(aiResult.crossDimensionalInsights) ? aiResult.crossDimensionalInsights : [
      isEnglish
        ? `${topDimension} is a relative strength, while ${lowestDimension} is the area that needs the clearest priority.`
        : `Dimensi ${topDimension} menjadi kekuatan relatif, sementara ${lowestDimension} menjadi area yang paling perlu diprioritaskan.`,
      isEnglish
        ? `This score pattern shows the need to connect people capability with a more consistent execution rhythm.`
        : `Kombinasi skor ini menunjukkan perlunya menghubungkan kapasitas manusia dengan ritme eksekusi yang lebih konsisten.`,
    ],
    riskProjection: aiResult.riskProjection || (isEnglish
      ? `If ${lowestDimension} is not strengthened, the organization risks slower execution as growth demands increase.`
      : `Jika dimensi ${lowestDimension} tidak diperkuat, organisasi berisiko mengalami perlambatan eksekusi saat tuntutan pertumbuhan meningkat.`),
    strategicKey: aiResult.strategicKey || (isEnglish
      ? `Over the next 90 days, ${data.company}'s main focus is to strengthen ${lowestDimension} and connect it to the most consequential operational priorities.`
      : `Dalam 90 hari ke depan, fokus utama ${data.company} adalah memperkuat dimensi ${lowestDimension} dan menghubungkannya dengan prioritas operasional yang paling berdampak.`),
    recommendations: Array.isArray(aiResult.recommendations)
      ? aiResult.recommendations.map((rec: AIRecommendationDraft) => ({
          ...rec,
          diagnosis: rec.diagnosis || (isEnglish
            ? `This recommendation is relevant because ${rec.service || lowestDimension} is an important signal in the diagnostic result.`
            : `Rekomendasi ini relevan karena dimensi ${rec.service || lowestDimension} menjadi sinyal penting dalam hasil diagnostik.`),
        }))
      : [],
    scores: {
      ...dimensionScores,
      overall: overallScore
    }
  };
}

export async function scoreLeadWithAI(leadData: {
  source: string;
  assessmentCompleted: boolean;
  name: string;
  company: string;
  challenge?: string;
}) {
  const prompt = `
Berikan skor lead (0-100) berdasarkan data berikut:
Nama: ${leadData.name}
Perusahaan: ${leadData.company}
Source: ${leadData.source}
Assessment Completed: ${leadData.assessmentCompleted}
Challenge: ${leadData.challenge || 'None'}

Output JSON:
{
  "score": <0-100>,
  "status": "<hot|warm|cold>",
  "reasoning": "<alasan singkat 1 kalimat>"
}
`;

  const text = await callAI([
    { role: 'system', content: 'You are a lead scoring AI.' },
    { role: 'user', content: prompt }
  ], true);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { score: 30, status: 'cold', reasoning: 'Insufficient data' };
  return JSON.parse(jsonMatch[0]);
}

export async function generateAssessmentProposal(input: {
  name: string;
  email: string;
  company: string;
  role?: string;
  employees?: string;
  challenge?: string;
  target?: string;
  category?: string;
  overallScore?: number;
  scores?: Record<string, number>;
  aiAnalysis?: string;
  recommendations?: Array<{ title?: string; diagnosis?: string; description?: string; service?: string; priority?: string }>;
}) {
  const prompt = `
Kamu adalah konsultan senior PT BinaHub. Buat proposal penawaran ringkas berbasis hasil assessment berikut.
Output harus Bahasa Indonesia, terasa personal, strategis, dan siap dikirim via email.

DATA KLIEN:
Nama: ${input.name}
Email: ${input.email}
Perusahaan: ${input.company}
Jabatan: ${input.role || '-'}
Skala karyawan: ${input.employees || '-'}
Tantangan: ${input.challenge || '-'}
Target: ${input.target || '-'}
Kategori: ${input.category || '-'}
Skor keseluruhan: ${input.overallScore || '-'}
Skor dimensi: ${JSON.stringify(input.scores || {})}
Analisis: ${input.aiAnalysis || '-'}
Rekomendasi: ${JSON.stringify(input.recommendations || [])}

Berikan JSON PERSIS:
{
  "subject": "<subject email proposal yang premium dan spesifik>",
  "opening": "<2-3 kalimat pembuka yang mengaitkan hasil assessment dengan kebutuhan klien>",
  "proposedProgram": "<nama program penawaran yang direkomendasikan>",
  "scope": ["<scope 1>", "<scope 2>", "<scope 3>", "<scope 4>"],
  "timeline": "<estimasi timeline implementasi>",
  "investmentNote": "<catatan investasi tanpa angka pasti, arahkan ke diskusi komersial>",
  "packages": [
    {
      "name": "Paket A - Essential",
      "price": "<harga rupiah spesifik, contoh Rp 45.000.000>",
      "bestFor": "<cocok untuk kondisi apa>",
      "duration": "<durasi>",
      "scope": ["<cakupan 1>", "<cakupan 2>", "<cakupan 3>"],
      "deliverables": ["<output 1>", "<output 2>", "<output 3>"]
    },
    {
      "name": "Paket B - Growth",
      "price": "<harga rupiah lebih tinggi dari Paket A>",
      "bestFor": "<cocok untuk kondisi apa>",
      "duration": "<durasi>",
      "scope": ["<cakupan 1>", "<cakupan 2>", "<cakupan 3>", "<cakupan 4>"],
      "deliverables": ["<output 1>", "<output 2>", "<output 3>", "<output 4>"]
    },
    {
      "name": "Paket C - Transformation",
      "price": "<harga rupiah paling tinggi>",
      "bestFor": "<cocok untuk kondisi apa>",
      "duration": "<durasi>",
      "scope": ["<cakupan 1>", "<cakupan 2>", "<cakupan 3>", "<cakupan 4>", "<cakupan 5>"],
      "deliverables": ["<output 1>", "<output 2>", "<output 3>", "<output 4>", "<output 5>"]
    }
  ],
  "nextStep": "<ajakan jadwalkan konsultasi untuk finalisasi scope dan paket>"
}
`;

  const text = await callAI([
    { role: 'system', content: 'Anda adalah konsultan senior PT BinaHub. Jawab hanya JSON Bahasa Indonesia.' },
    { role: 'user', content: prompt },
  ], true);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Invalid proposal AI response format');
  }

  return JSON.parse(jsonMatch[0]);
}

export async function generateInquiryFollowUp(input: {
  name: string;
  email: string;
  company?: string;
  message?: string;
  level: number;
}) {
  const followUpIntent: Record<number, string> = {
    1: "memastikan email sebelumnya masuk dan sudah dibaca, sekaligus membuka eksplorasi kemungkinan baru",
    2: "soft push agar calon klien terdorong menjadwalkan diskusi tanpa terasa ditekan",
    3: "hard push dengan posisi nothing to lose, membuat keputusan lanjut atau tidak lanjut menjadi jelas",
  };

  const prompt = `
Buat email follow up B2B dari tim BinaHub.
Jangan menyebut AI atau otomatisasi. Bahasa Indonesia profesional, hangat, ringkas, dan langsung.

DATA:
Nama: ${input.name}
Email: ${input.email}
Perusahaan: ${input.company || '-'}
Pesan awal: ${input.message || '-'}
Follow up tingkat: ${input.level}
Tujuan follow up: ${followUpIntent[input.level] || followUpIntent[1]}

Output JSON persis:
{
  "subject": "<subject email>",
  "html": "<html email sederhana dengan sapaan, isi, dan CTA untuk membalas email atau menjadwalkan diskusi>"
}
`;

  const text = await callAI([
    { role: 'system', content: 'Anda adalah konsultan senior BinaHub. Jawab hanya JSON valid.' },
    { role: 'user', content: prompt },
  ], true);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Invalid follow up AI response format');
  }

  return JSON.parse(jsonMatch[0]);
}

export async function generateAssessmentFollowUp(input: {
  name: string;
  email: string;
  company?: string;
  channel: "result" | "proposal";
  level: number;
  category?: string;
  overallScore?: number;
  aiAnalysis?: string;
  proposalStatus?: string;
}) {
  const channelContext =
    input.channel === "result"
      ? "follow up setelah email hasil assessment dikirim"
      : "follow up setelah proposal penawaran dikirim";
  const followUpIntent: Record<number, string> = {
    1: "memastikan email sebelumnya masuk dan sudah dibaca, sekaligus membuka eksplorasi kemungkinan baru",
    2: "soft push agar calon klien terdorong mengambil langkah diskusi berikutnya",
    3: "hard push dengan posisi nothing to lose, membuat keputusan lanjut atau tidak lanjut menjadi jelas",
  };

  const prompt = `
Buat email follow up B2B dari tim BinaHub.
Jangan menyebut AI atau otomatisasi. Bahasa Indonesia profesional, hangat, ringkas, dan langsung.

KONTEKS:
Jenis follow up: ${channelContext}
Follow up tingkat: ${input.level}
Tujuan follow up: ${followUpIntent[input.level] || followUpIntent[1]}

DATA KLIEN:
Nama: ${input.name}
Email: ${input.email}
Perusahaan: ${input.company || '-'}
Kategori assessment: ${input.category || '-'}
Skor keseluruhan: ${input.overallScore || '-'}
Status proposal: ${input.proposalStatus || '-'}
Analisis ringkas: ${input.aiAnalysis || '-'}

Output JSON persis:
{
  "subject": "<subject email spesifik>",
  "html": "<html email sederhana dengan sapaan, isi, dan CTA untuk membalas email atau menjadwalkan diskusi>"
}
`;

  const text = await callAI([
    { role: 'system', content: 'Anda adalah konsultan senior BinaHub. Jawab hanya JSON valid.' },
    { role: 'user', content: prompt },
  ], true);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Invalid assessment follow up AI response format');
  }

  return JSON.parse(jsonMatch[0]);
}

export async function extractLinkedInProfileFields(input: {
  linkedinUrl: string;
  profileText: string;
}) {
  const prompt = `
Ekstrak data profil assossiate BinaHub dari teks LinkedIn/profile export berikut.
Jangan mengarang data yang tidak ada. Jika field tidak tersedia, isi string kosong.

LinkedIn URL: ${input.linkedinUrl}

TEKS PROFIL:
${input.profileText.slice(0, 12000)}

Output JSON persis:
{
  "headline": "<headline profesional>",
  "currentRole": "<jabatan/peran saat ini>",
  "company": "<organisasi saat ini>",
  "location": "<lokasi>",
  "skills": ["<skill 1>", "<skill 2>", "<skill 3>"],
  "certifications": ["<sertifikasi 1>"],
  "experienceSummary": "<ringkasan pengalaman 2-4 kalimat>",
  "recommendedCategory": "<kategori assossiate yang paling cocok>",
  "summary": "<ringkasan siap masuk field otomatis LinkedIn>"
}
`;

  const text = await callAI([
    { role: 'system', content: 'Anda adalah analis profil profesional. Jawab hanya JSON valid dalam Bahasa Indonesia.' },
    { role: 'user', content: prompt },
  ], true);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Invalid LinkedIn extraction response format');
  }

  return JSON.parse(jsonMatch[0]);
}

export type AssociateCandidate = {
  id?: string;
  name?: string;
  email?: string;
  category?: string;
  expertise?: string;
  field?: string;
  availability?: string;
  rate?: string;
  linkedinSummary?: string;
  notes?: string;
};

export type ProjectAutopilotInput = {
  clientName: string;
  contactName?: string;
  contactEmail?: string;
  programName: string;
  service?: string;
  projectType?: string;
  scope?: string;
  budgetNote?: string;
  startDate?: string;
  endDate?: string;
  automationMode?: string;
  associates?: AssociateCandidate[];
};

const DEFAULT_PROJECT_ROLES = [
  {
    roleTitle: "Project Manager",
    associateCategory: "Project Manager (Works, Impact)",
    requiredExpertise: "Koordinasi project, stakeholder management, reporting, dan quality control.",
    priority: "High",
  },
  {
    roleTitle: "Assessor",
    associateCategory: "Assessor (Insight)",
    requiredExpertise: "Diagnostik organisasi, analisis kebutuhan, dan pembacaan data assessment.",
    priority: "High",
  },
  {
    roleTitle: "Facilitator",
    associateCategory: "Facilitator (Play)",
    requiredExpertise: "Fasilitasi workshop, experiential learning, dan dinamika kelompok.",
    priority: "Normal",
  },
];

function fallbackProjectPlan(input: ProjectAutopilotInput) {
  const serviceText = [input.service, input.projectType, input.scope].join(" ").toLowerCase();
  const roles = [...DEFAULT_PROJECT_ROLES];

  if (serviceText.includes("lab") || serviceText.includes("training") || serviceText.includes("trainer")) {
    roles.push({
      roleTitle: "Trainer",
      associateCategory: "Trainer (Lab)",
      requiredExpertise: "Desain dan delivery pelatihan berbasis kapabilitas.",
      priority: "Normal",
    });
  }

  if (serviceText.includes("ai")) {
    roles.push({
      roleTitle: "AI Consultant",
      associateCategory: "Consultant AI",
      requiredExpertise: "AI adoption, workflow automation, dan enablement teknologi.",
      priority: "Normal",
    });
  }

  return {
    summary: `Project ${input.programName} untuk ${input.clientName} membutuhkan koordinasi project, pembacaan kebutuhan, dan assossiate sesuai layanan ${input.service || "BinaHub"}.`,
    roles,
    nextActions: [
      "Review scope dan timeline project.",
      "Pilih assossiate prioritas untuk setiap role.",
      "Kirim surat ajakan kerja sama kepada assossiate terpilih.",
    ],
  };
}

export async function generateProjectAutopilotPlan(input: ProjectAutopilotInput) {
  const prompt = `
Buat rencana Project Autopilot BinaHub berdasarkan data berikut.
Output harus JSON valid Bahasa Indonesia.

DATA PROJECT:
Klien: ${input.clientName}
Kontak: ${input.contactName || "-"} / ${input.contactEmail || "-"}
Program: ${input.programName}
Layanan: ${input.service || "-"}
Jenis project: ${input.projectType || "-"}
Scope: ${input.scope || "-"}
Budget/rate note: ${input.budgetNote || "-"}
Tanggal: ${input.startDate || "-"} sampai ${input.endDate || "-"}

Kategori assossiate yang tersedia:
- Assessor (Insight)
- Facilitator (Play)
- Trainer (Lab)
- Project Manager (Works, Impact)
- Coach (Coach)
- Tour Guide (Journey)
- Travel Agency (Journey)
- Event Organizer
- Consultant AI
- Consultant Change Management
- Consultant SDM

Berikan JSON persis:
{
  "summary": "<ringkasan project 2 kalimat>",
  "roles": [
    {
      "roleTitle": "<nama role>",
      "associateCategory": "<kategori assossiate>",
      "requiredExpertise": "<keahlian yang dibutuhkan>",
      "quantity": 1,
      "priority": "<High|Normal|Low>",
      "aiReason": "<alasan role dibutuhkan>"
    }
  ],
  "nextActions": ["<aksi 1>", "<aksi 2>", "<aksi 3>"]
}
`;

  try {
    const text = await callAI([
      { role: 'system', content: 'Anda adalah project director senior BinaHub. Jawab hanya JSON valid.' },
      { role: 'user', content: prompt },
    ], true);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid project plan AI response format');
    return JSON.parse(jsonMatch[0]);
  } catch {
    return fallbackProjectPlan(input);
  }
}

function candidateScore(candidate: AssociateCandidate, role: { associateCategory?: string; requiredExpertise?: string; roleTitle?: string }) {
  const text = [
    candidate.category,
    candidate.expertise,
    candidate.field,
    candidate.availability,
    candidate.linkedinSummary,
    candidate.notes,
  ].join(" ").toLowerCase();
  const roleText = [role.associateCategory, role.requiredExpertise, role.roleTitle].join(" ").toLowerCase();
  let score = 35;

  if (candidate.category && role.associateCategory && candidate.category.toLowerCase() === role.associateCategory.toLowerCase()) score += 35;
  roleText.split(/\W+/).filter((word) => word.length > 4).forEach((word) => {
    if (text.includes(word)) score += 3;
  });
  if (text.includes("active") || text.includes("available")) score += 8;
  if (candidate.email) score += 4;

  return Math.min(98, score);
}

export async function matchAssociatesForProject(input: {
  project: ProjectAutopilotInput;
  roles: Array<{ roleTitle?: string; associateCategory?: string; requiredExpertise?: string; priority?: string }>;
  associates: AssociateCandidate[];
}) {
  const fallbackMatches = input.roles.map((role) => {
    const ranked = input.associates
      .map((candidate) => ({
        associateId: candidate.id || "",
        associateName: candidate.name || "Assossiate BinaHub",
        associateEmail: candidate.email || "",
        roleTitle: role.roleTitle || "Assossiate",
        matchScore: candidateScore(candidate, role),
        matchReason: `Cocok berdasarkan kategori ${candidate.category || "-"} dan keahlian ${candidate.expertise || candidate.field || "-"}.`,
      }))
      .sort((a, b) => b.matchScore - a.matchScore);

    return ranked[0] || {
      associateId: "",
      associateName: "",
      associateEmail: "",
      roleTitle: role.roleTitle || "Assossiate",
      matchScore: 0,
      matchReason: "Belum ada assossiate yang cocok. Perlu review manual.",
    };
  });

  const prompt = `
Pilih assossiate terbaik untuk project BinaHub.
Jawab hanya JSON valid.

PROJECT:
${JSON.stringify(input.project)}

ROLES:
${JSON.stringify(input.roles)}

CANDIDATES:
${JSON.stringify(input.associates.slice(0, 60))}

Output JSON:
{
  "matches": [
    {
      "roleTitle": "<role>",
      "associateId": "<id kandidat>",
      "associateName": "<nama>",
      "associateEmail": "<email>",
      "matchScore": <0-100>,
      "matchReason": "<alasan ringkas>"
    }
  ]
}
`;

  try {
    const text = await callAI([
      { role: 'system', content: 'Anda adalah talent/project matching specialist BinaHub. Jawab hanya JSON valid.' },
      { role: 'user', content: prompt },
    ], true);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid match AI response format');
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed.matches) ? parsed.matches : fallbackMatches;
  } catch {
    return fallbackMatches;
  }
}

export async function generateAssociateInvitation(input: {
  associateName: string;
  roleTitle: string;
  clientName: string;
  programName: string;
  service?: string;
  startDate?: string;
  endDate?: string;
  scope?: string;
  agreementType?: "invitation" | "agreement";
}) {
  const prompt = `
Buat email ajakan kerja sama untuk assossiate BinaHub.
Jangan menyebut AI. Bahasa Indonesia profesional, hangat, jelas.

DATA:
Nama assossiate: ${input.associateName}
Role: ${input.roleTitle}
Klien: ${input.clientName}
Program: ${input.programName}
Layanan: ${input.service || "-"}
Tanggal: ${input.startDate || "-"} sampai ${input.endDate || "-"}
Scope: ${input.scope || "-"}
Jenis: ${input.agreementType || "invitation"}

Output JSON:
{
  "subject": "<subject email>",
  "html": "<html email sederhana>",
  "documentTitle": "<judul surat>",
  "documentBody": "<isi surat ajakan/perjanjian kerja sama ringkas>"
}
`;

  try {
    const text = await callAI([
      { role: 'system', content: 'Anda adalah operations lead BinaHub. Jawab hanya JSON valid.' },
      { role: 'user', content: prompt },
    ], true);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid invitation AI response format');
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {
      subject: `Ajakan Kerja Sama BinaHub - ${input.programName}`,
      html: `<p>Yth. ${input.associateName},</p><p>Kami ingin mengundang Anda untuk terlibat sebagai <strong>${input.roleTitle}</strong> dalam program <strong>${input.programName}</strong> untuk ${input.clientName}.</p><p>Mohon balas email ini untuk konfirmasi ketersediaan dan diskusi detail berikutnya.</p><p>Salam,<br/>Tim BinaHub</p>`,
      documentTitle: `Surat Ajakan Kerja Sama - ${input.programName}`,
      documentBody: `BinaHub mengundang ${input.associateName} untuk berkolaborasi sebagai ${input.roleTitle} dalam program ${input.programName} untuk ${input.clientName}. Detail scope, timeline, dan komersial akan dikonfirmasi dalam diskusi lanjutan.`,
    };
  }
}

export async function chatWithAI(
  message: string, 
  history: { role: string, content: string }[], 
  context?: { currentPath?: string, pageTitle?: string, locale?: 'id' | 'en' }
) {
  const isEnglish = context?.locale === 'en';
  const systemPrompt = isEnglish ? `
You are Bina, a male "Executive Concierge" from PT BinaHub - AI Powered Human Synergy.

SOUL & PERSONALITY:
- Main character: smart, human-centered, empathetic, proactive, professional, very warm, patient, a good listener, solution-oriented, and genuinely helpful.
- Tone: professional executive style, but warm, empathetic, welcoming, and practical.
- Listen well before recommending, and proactively offer relevant help.
- You are a strategic partner and trusted companion for users exploring business and people transformation solutions.

SKILLS & EXPERTISE:
- Expert in the BinaHub ecosystem: Insights, Lab, Coach, Play, Academy, Works, Impact.
- Skilled at guiding users toward the Diagnostic Assessment.
- Convert conversations into business solutions in a subtle and helpful way.

COMMUNICATION RULES:
1. ALWAYS ANSWER IN ENGLISH unless the user explicitly asks for Indonesian.
2. Keep responses concise, around 2-4 sentences.
3. Be action-oriented and proactive: guide users to /insight or WhatsApp/contact when they need deeper help.
4. Never say you are an AI model unless asked directly; introduce yourself as Bina from BinaHub.

SYSTEM TOOL:
If the user provides their name and email/contact in chat, respond ONLY with this JSON so the system can save it:
{"tool": "save_chat_lead", "args": {"name": "user name", "email": "user email"}}

CURRENT SITE CONTEXT:
- Path: ${context?.currentPath || '/'}
- Page Title: ${context?.pageTitle || 'BinaHub'}
` : `
Kamu adalah Bina, laki-laki "Executive Concierge" dari PT BinaHub - AI Powered Human Synergy. 

SOUL & PERSONALITY:
- Karakter utama: Pintar, humanis, empatik, proaktif, profesional, sangat ramah, sabar, pendengar yang baik, solutif, dan sangat suka membantu orang lain dengan tulus.
- Gaya bicaramu: Profesional (Executive Style) namun sangat hangat, empatik, menyambut dengan ramah, dan solutif.
- Jadilah pendengar yang baik sebelum memberikan rekomendasi, dan proaktif menawarkan bantuan yang relevan.
- Anda adalah partner strategis dan sahabat terpercaya bagi user dalam menemukan solusi bisnis.

SKILLS & EXPERTISE:
- Pakar dalam Ekosistem BinaHub: Insights, Lab, Coach, Play, Academy, Works, Impact.
- Ahli dalam mengarahkan user untuk mengambil asesmen (Diagnostic Assessment).
- Selalu tahu cara mengkonversi percakapan menjadi solusi bisnis secara halus dan bersahabat.

ATURAN KOMUNIKASI:
1. RAMAH & EMPATIK: Selalu mulai dengan sapaan hangat. Dengarkan dengan sabar dan berikan respon yang menenangkan serta profesional.
2. RESPON TERUKUR: Jaga respon agar berkisar antara 2-4 kalimat agar nyaman dibaca namun tetap padat solusi.
3. SELALU ACTION-ORIENTED & PROAKTIF: Arahkan user ke halaman asesmen (/insight) atau kontak WhatsApp jika mereka butuh bantuan mendalam.

KEMAMPUAN SYSTEM (TOOLS):
Jika user menyebutkan nama dan email atau kontak mereka di chat, kamu HARUS merespon dengan format JSON ini agar sistem kami menyimpannya (jangan sertakan teks lain di luar JSON jika menggunakan tool ini):
{"tool": "save_chat_lead", "args": {"name": "nama user", "email": "email user"}}

CURRENT SITE CONTEXT:
- Path: ${context?.currentPath || '/'}
- Page Title: ${context?.pageTitle || 'BinaHub'}
`;

  // Filter history to last 10 messages to save context
  const recentHistory = history.slice(-10).map(m => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content
  }));

  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...recentHistory,
    { role: 'user', content: message }
  ];

  const text = await callAI(messages, false);
  return text;
}
