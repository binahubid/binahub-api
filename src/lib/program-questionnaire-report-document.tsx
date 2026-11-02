import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { AnswerEvaluation, QuestionnaireQuestion } from "@/lib/program-questionnaires";
import { PDFHeader, PDFFooter, pdfStyles, pdfFont } from './pdf-brand';

type ReportSubmission = {
  id: string;
  participantName: string;
  participantEmail: string | null;
  attemptNumber: number;
  submittedAt: string;
  score: number | null;
  maximumScore: number | null;
  percentage: number | null;
  answers: Array<{ questionId: string; value: unknown }>;
  evaluations: AnswerEvaluation[];
};

const styles = StyleSheet.create({
  page: { ...pdfStyles.page },
  eyebrow: { color: "#A66A12", fontSize: 9, letterSpacing: 1.5, fontFamily: pdfFont, fontWeight: 600 },
  title: { marginTop: 8, fontSize: 22, color: "#0B2C6B", fontFamily: pdfFont, fontWeight: 600 },
  subtitle: { marginTop: 7, color: "#5D6B82", fontSize: 10 },
  rule: { marginTop: 18, borderBottomWidth: 1, borderBottomColor: "#D7DFEA" },
  metrics: { marginTop: 18, flexDirection: "row", gap: 10 },
  metric: { flex: 1, padding: 12, backgroundColor: "#F2F5F9", borderTopWidth: 2, borderTopColor: "#0B2C6B" },
  metricLabel: { color: "#6A7890", fontSize: 8.5, letterSpacing: 1, fontFamily: pdfFont, fontWeight: 600 },
  metricValue: { marginTop: 5, color: "#0B2C6B", fontSize: 15, fontFamily: pdfFont, fontWeight: 600 },
  respondent: { marginTop: 22, paddingTop: 14, borderTopWidth: 1, borderTopColor: "#B8C5D8" },
  respondentName: { color: "#0B2C6B", fontSize: 13, fontFamily: pdfFont, fontWeight: 600 },
  respondentMeta: { marginTop: 4, color: "#64748B", fontSize: 8 },
  question: { marginTop: 10, padding: 10, backgroundColor: "#F7F9FC" },
  questionTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  prompt: { flex: 1, color: "#172033", fontSize: 10.5, fontFamily: pdfFont, fontWeight: 600 },
  badgeCorrect: { color: "#067647", fontSize: 8.5, fontFamily: pdfFont, fontWeight: 600 },
  badgeWrong: { color: "#B42318", fontSize: 8.5, fontFamily: pdfFont, fontWeight: 600 },
  badgeNeutral: { color: "#667085", fontSize: 8.5, fontFamily: pdfFont, fontWeight: 600 },
  answer: { marginTop: 6, color: "#475467", fontSize: 9.5 },
  footer: { position: "absolute", left: 42, right: 42, bottom: 24, flexDirection: "row", justifyContent: "space-between", color: "#8A96A8", fontSize: 7 },
});

function answerText(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(", ") || "Tidak dijawab";
  if (value === null || value === undefined || value === "") return "Tidak dijawab";
  return String(value);
}

export function ProgramQuestionnaireReportDocument({
  program,
  questionnaire,
  questions,
  submissions,
}: {
  program: { code: string | null; title: string };
  questionnaire: { title: string; kind: string; passing_score: number | null };
  questions: QuestionnaireQuestion[];
  submissions: ReportSubmission[];
}) {
  const scored = submissions.map((item) => item.percentage).filter((value): value is number => value !== null);
  const average = scored.length ? (scored.reduce((sum, value) => sum + value, 0) / scored.length).toFixed(1) : "—";
  const kind = questionnaire.kind === "pre_test" ? "Pre-test" : questionnaire.kind === "post_test" ? "Post-test" : "BinaInsight Program";

  return (
    <Document title={`${kind} — ${program.title}`} author="BinaHub">
      <Page size="A4" style={styles.page} wrap>
        <PDFHeader title={questionnaire.title} meta={`${program.title} | ${program.code || "Tanpa kode"} | ${kind}`} />
        <View style={styles.metrics}>
          <View style={styles.metric}><Text style={styles.metricLabel}>RESPONDEN</Text><Text style={styles.metricValue}>{submissions.length}</Text></View>
          <View style={styles.metric}><Text style={styles.metricLabel}>RATA-RATA</Text><Text style={styles.metricValue}>{average === "—" ? average : `${average}%`}</Text></View>
          <View style={styles.metric}><Text style={styles.metricLabel}>BATAS LULUS</Text><Text style={styles.metricValue}>{questionnaire.passing_score === null ? "—" : `${questionnaire.passing_score}%`}</Text></View>
        </View>

        {submissions.map((submission, submissionIndex) => {
          const answers = new Map(submission.answers.map((answer) => [answer.questionId, answer.value]));
          const evaluations = new Map(submission.evaluations.map((evaluation) => [evaluation.questionId, evaluation]));
          return (
            <View key={submission.id} style={styles.respondent} break={submissionIndex > 0}>
              <Text style={styles.respondentName}>{submission.participantName}</Text>
              <Text style={styles.respondentMeta}>{submission.participantEmail || "Email tidak tersedia"} · Percobaan {submission.attemptNumber} · {new Date(submission.submittedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} · Skor {submission.percentage === null ? "Tidak dinilai" : `${submission.percentage}%`}</Text>
              {questions.map((question, questionIndex) => {
                const evaluation = evaluations.get(question.id);
                return (
                  <View key={question.id} style={styles.question}>
                    <View style={styles.questionTop} minPresenceAhead={24}>
                      <Text style={styles.prompt}>{questionIndex + 1}. {question.prompt}</Text>
                      <Text style={evaluation?.correct === true ? styles.badgeCorrect : evaluation?.correct === false ? styles.badgeWrong : styles.badgeNeutral}>
                        {evaluation?.correct === true ? "BENAR" : evaluation?.correct === false ? "SALAH" : "TIDAK DINILAI"}
                      </Text>
                    </View>
                    <Text style={styles.answer}>Jawaban: {answerText(answers.get(question.id))}{evaluation?.scored ? ` · ${evaluation.awardedPoints}/${evaluation.maximumPoints} poin` : ""}</Text>
                  </View>
                );
              })}
            </View>
          );
        })}
        <PDFFooter label="BinaHub | Dokumen internal program" />
      </Page>
    </Document>
  );
}
