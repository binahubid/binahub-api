export type CatalogSelectionInput = {
  locale: "id" | "en";
  challenge: string;
  target: string;
  recommendations: Array<{ title?: string; diagnosis?: string; description?: string; priority?: string }>;
  candidates: Array<{ code: string; name: string; summary: string; scope: string }>;
};

// Conservative, bilingual topic matching. Candidates must already have passed
// the official catalog/price gate. No generic default module or made-up price.
const topics = [
  { need: /konflik|conflict|kompak|cohesion|kepercayaan|\btrust\b|psychological safety|keamanan psikologis/, solution: /konflik|conflict|kepercayaan|\btrust\b|psychological safety|keamanan psikologis|sinergi tim|team synergy/ },
  { need: /komunikasi|communication|presentasi|presentation|public speaking/, solution: /komunikasi|communication|presentasi|presentation/ },
  { need: /empati|empathy|emosional|emotional|stres|stress|burnout/, solution: /empati|empathy|emosional|emotional/ },
  { need: /kolaborasi|collaborat|kerja sama|kerjasama|teamwork|silo/, solution: /sinergi tim|team synergy|kolaborasi|collaborat|teamwork/ },
  { need: /pemimpin baru|new leader|first.time manager|supervisor baru/, solution: /pemimpin baru|new leader|first.time manager/ },
  { need: /kepemimpinan|leadership|memimpin|leading|adaptif|adaptive/, solution: /kepemimpinan|leadership|memimpin|leading|adaptif|adaptive/ },
  { need: /produktivitas|productivity|manajemen waktu|time management|efektivitas personal|personal effectiveness/, solution: /produktivitas|productivity|efektivitas personal|personal effectiveness/ },
  { need: /layanan|pelanggan|customer|service excellence/, solution: /keunggulan layanan|service excellence|pelanggan|customer/ },
  { need: /pemecahan masalah|problem.solving|pengambilan keputusan|decision.making|inovasi|innovation/, solution: /pemecahan masalah|problem.solving|pengambilan keputusan|decision.making|inovasi|innovation/ },
  { need: /kecerdasan buatan|artificial intelligence|\bai\b/, solution: /berdaya ai|ai.empowered|artificial intelligence/ },
  { need: /fasilitator|facilitat|pelatih internal|internal trainer|train.the.trainer/, solution: /fasilitator|facilitat|pelatih internal|internal trainer/ },
];

export function selectCatalogFallback(input: CatalogSelectionInput) {
  const directNeed = `${input.challenge} ${input.target}`.toLowerCase();
  const recommendationNeed = input.recommendations.map((item) => `${item.title || ""} ${item.diagnosis || ""} ${item.description || ""}`).join(" ").toLowerCase();
  const evidence = topics.map((topic) => ({ ...topic, weight: topic.need.test(directNeed) ? 4 : topic.need.test(recommendationNeed) ? 1 : 0 })).filter((topic) => topic.weight > 0);
  const ranked = input.candidates.filter((candidate) => /^SS-\d{2}$/.test(candidate.code)).map((candidate) => {
    const heading = `${candidate.name} ${candidate.summary}`.toLowerCase();
    const scope = candidate.scope.toLowerCase();
    const score = evidence.reduce((total, topic) => total + topic.weight * (topic.solution.test(heading) ? 3 : topic.solution.test(scope) ? 1 : 0), 0);
    return { candidate, score };
  }).filter((item) => item.score >= 3).sort((a, b) => b.score - a.score || a.candidate.code.localeCompare(b.candidate.code));
  if (!ranked.length) return null;
  // One strongest match avoids adding unnecessary modules when AI is offline.
  const best = ranked[0].candidate;
  return {
    moduleCodes: [best.code],
    reasoning: input.locale === "en"
      ? `Selected ${best.name} because its published catalog focus matches the needs stated in the assessment and recommendations.`
      : `${best.name} dipilih karena fokus dan cakupan resminya sesuai dengan kebutuhan serta rekomendasi hasil assessment.`,
  };
}
