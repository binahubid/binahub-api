import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { AssessmentData } from "@/lib/validations";
import type { ProposalResult } from "@/lib/pdf-service";

const NAVY = "#0B2C6B";
const INK = "#17212F";
const MUTED = "#596779";
const GOLD = "#B5822B";
const LINE = "#DCE2E9";

const styles = StyleSheet.create({
  page: { fontFamily: "Inter", color: INK, backgroundColor: "#FFFFFF", paddingTop: 58, paddingBottom: 58, paddingHorizontal: 54, fontSize: 9.5, lineHeight: 1.5 },
  cover: { fontFamily: "Inter", color: INK, backgroundColor: "#FFFFFF", padding: 58 },
  wordmark: { color: NAVY, fontSize: 19, fontWeight: 700, letterSpacing: -0.5 },
  kicker: { color: GOLD, fontSize: 8, fontWeight: 700, letterSpacing: 1.8, textTransform: "uppercase" },
  coverTitle: { marginTop: 62, color: NAVY, fontSize: 30, fontWeight: 700, lineHeight: 1.15 },
  coverSubtitle: { marginTop: 13, fontSize: 13, color: MUTED, lineHeight: 1.55 },
  coverRule: { marginTop: 34, width: 60, height: 2, backgroundColor: GOLD },
  coverMetadata: { marginTop: 55, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 18 },
  metadataRow: { flexDirection: "row", marginBottom: 13 },
  metadataLabel: { width: "30%", color: MUTED, fontSize: 8, textTransform: "uppercase", letterSpacing: 0.8 },
  metadataValue: { width: "70%", fontSize: 10, fontWeight: 600 },
  coverFooter: { position: "absolute", left: 58, right: 58, bottom: 55, color: MUTED, fontSize: 8 },
  header: { position: "absolute", top: 27, left: 54, right: 54, flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: LINE, paddingBottom: 9 },
  headerBrand: { color: NAVY, fontSize: 10, fontWeight: 700 },
  headerLabel: { color: MUTED, fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.6 },
  footer: { position: "absolute", bottom: 24, left: 54, right: 54, flexDirection: "row", justifyContent: "space-between", color: MUTED, fontSize: 7, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
  section: { marginBottom: 17 },
  sectionNumber: { color: GOLD, fontSize: 8, fontWeight: 700, letterSpacing: 1.2 },
  heading: { color: NAVY, fontSize: 16, fontWeight: 700, marginTop: 4, marginBottom: 8 },
  body: { fontSize: 9.5, color: INK, lineHeight: 1.55, marginBottom: 8 },
  muted: { fontSize: 8.5, color: MUTED, lineHeight: 1.5 },
  bullet: { flexDirection: "row", marginBottom: 5 },
  bulletDot: { width: 13, color: GOLD, fontWeight: 700 },
  bulletText: { flex: 1, fontSize: 9.3, lineHeight: 1.5 },
  tableHeader: { flexDirection: "row", backgroundColor: NAVY, paddingVertical: 8, paddingHorizontal: 9 },
  tableHeaderText: { color: "#FFFFFF", fontSize: 7.5, fontWeight: 700 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 9, paddingHorizontal: 9 },
  tableText: { fontSize: 8.4, lineHeight: 1.45 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1.5, borderTopColor: NAVY, marginTop: 12, paddingTop: 10 },
  totalLabel: { fontSize: 9, fontWeight: 700, color: NAVY },
  totalValue: { fontSize: 12, fontWeight: 700, color: NAVY },
  divider: { borderTopWidth: 1, borderTopColor: LINE, marginVertical: 8 },
  closingPanel: { marginTop: 64, backgroundColor: NAVY, padding: 24 },
  closingPanelTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: 700, marginBottom: 10 },
  closingPanelText: { color: "#DDE8F7", fontSize: 9.5, lineHeight: 1.55 },
});

type Locale = "id" | "en";

const translations = {
  id: {
    preliminary: "Rekomendasi Awal",
    commercial: "Proposal Solusi",
    subtitle: "BinaHub Signature Solutions",
    preparedFor: "Disusun untuk",
    contact: "Kontak",
    date: "Tanggal",
    status: "Status",
    indicative: "Indikatif - perlu konfirmasi ruang lingkup",
    simulation: "SIMULASI - bukan penawaran resmi",
    custom: "Solusi custom - disusun melalui peninjauan manusia",
    confidential: "Disiapkan khusus untuk penerima - BinaHub",
    summary: "Ringkasan keputusan",
    context: "Konteks dan kebutuhan",
    why: "Mengapa solusi ini",
    objectives: "Tujuan pembelajaran",
    objectivesPending: "Tujuan pembelajaran spesifik akan dikonfirmasi bersama berdasarkan solusi yang dipilih.",
    solutions: "Signature Solutions terpilih",
    solution: "Solusi",
    delivery: "Pengalaman belajar dan pelaksanaan",
    deliveryText: "Kegiatan dapat memadukan pembelajaran terfasilitasi, aktivitas atau simulasi, refleksi, diskusi terstruktur, dan penerapan dalam pekerjaan. Metode dipilih sesuai solusi dan konteks klien.",
    scope: "Yang disediakan BinaHub",
    quality: "Cakupan dan jaminan mutu",
    qualityText: "Cakupan mengikuti solusi yang tercantum dalam proposal ini. Penyesuaian koordinasi pelaksanaan yang kecil tidak mengubah rancangan solusi; perubahan substansial pada tujuan, peserta, durasi, asesmen, coaching, atau keluaran memerlukan peninjauan ruang lingkup dan investasi.",
    standardOrCustom: "Solusi standar atau custom",
    standardText: "Solusi standar mempertahankan tujuan pembelajaran dan rancangan inti katalog. Jika kebutuhan melampaui cakupan tersebut, BinaHub akan menyelaraskan pendekatan custom bersama klien sebelum menetapkan komitmen akhir.",
    customText: "Ruang lingkup dan investasi proposal custom disusun untuk project ini dan memerlukan persetujuan manusia sebelum dikirim sebagai penawaran final.",
    investment: "Investasi",
    quantity: "Jumlah",
    fee: "Nilai",
    total: "Total sebelum pajak",
    discount: "Diskon",
    validity: "Proposal berlaku",
    exclusions: "Pengecualian",
    terms: "Ketentuan komersial",
    next: "Langkah berikutnya",
    about: "Tentang BinaHub",
    solutionReason: "Solusi ini dipilih untuk menjawab prioritas yang teridentifikasi dalam diagnosa. Kegiatan memadukan eksplorasi, praktik, refleksi, dan penerapan pada pekerjaan sehari-hari.",
    exclusionsText: "Nilai di atas tidak mencakup tempat kegiatan, perangkat elektronik (termasuk proyektor, layar, dan tata suara), konsumsi peserta, transportasi serta akomodasi tim BinaHub untuk pelaksanaan di luar Jakarta, dan pajak yang berlaku, kecuali dinyatakan lain secara tertulis.",
    termsText: "Jadwal dan ketersediaan fasilitator menunggu konfirmasi. Pelaksanaan dimulai setelah kesepakatan komersial dan administrasi, termasuk PO/SPK bila relevan. Perubahan jumlah peserta, tanggal, lokasi, format, atau cakupan setelah konfirmasi dapat mengubah investasi. Transaksi di atas Rp100.000.000 memerlukan persetujuan internal BinaHub sebelum komitmen final.",
    aboutText: "BinaHub membantu organisasi mengembangkan kapabilitas manusia, menjalankan transformasi, dan menghasilkan dampak yang berkelanjutan.",
    closingTitle: "Mari mulai dari kebutuhan yang paling penting.",
    closingText: "Tim BinaHub siap mendiskusikan prioritas, menyesuaikan pelaksanaan, dan membantu Anda menentukan langkah berikutnya.",
  },
  en: {
    preliminary: "Preliminary Recommendation",
    commercial: "Solution Proposal",
    subtitle: "BinaHub Signature Solutions",
    preparedFor: "Prepared for",
    contact: "Contact",
    date: "Date",
    status: "Status",
    indicative: "Indicative - scope subject to confirmation",
    simulation: "SIMULATION - not an official offer",
    custom: "Custom solution - prepared with human review",
    confidential: "Prepared exclusively for the recipient - BinaHub",
    summary: "Decision summary",
    context: "Context and need",
    why: "Why this solution",
    objectives: "Learning objectives",
    objectivesPending: "Specific learning objectives will be confirmed with the client based on the selected solutions.",
    solutions: "Selected Signature Solutions",
    solution: "Solution",
    delivery: "Learning experience and delivery",
    deliveryText: "Delivery may combine facilitated learning, activities or simulations, reflection, structured discussion, and workplace application. Methods are selected for each solution and client context.",
    scope: "What BinaHub delivers",
    quality: "Scope and quality assurance",
    qualityText: "Scope follows the solutions stated in this proposal. Minor delivery coordination does not change their design; material changes to objectives, participants, duration, assessment, coaching, or deliverables require a scope and investment review.",
    standardOrCustom: "Standard or custom solution",
    standardText: "Standard solutions preserve the catalog learning objectives and core design. If the need exceeds that scope, BinaHub will align a custom approach with the client before final commitment.",
    customText: "The scope and investment of this custom proposal are project-specific and require human approval before a final offer is sent.",
    investment: "Investment",
    quantity: "Quantity",
    fee: "Fee",
    total: "Total before tax",
    discount: "Discount",
    validity: "Proposal valid for",
    exclusions: "Exclusions",
    terms: "Commercial terms",
    next: "Next step",
    about: "About BinaHub",
    solutionReason: "These solutions address the priorities identified by the diagnostic. The experience combines exploration, practice, reflection, and workplace application.",
    exclusionsText: "The investment excludes venue, electronic equipment (including projector, screen, and sound system), participant catering, transportation and accommodation for BinaHub personnel outside Jakarta, and applicable taxes, unless expressly stated otherwise.",
    termsText: "Dates and facilitator availability are subject to confirmation. Delivery begins after commercial and administrative requirements are agreed, including a PO/SPK where applicable. Changes to participant count, date, location, format, or scope after confirmation may change the investment. Transactions above Rp100,000,000 require BinaHub internal approval before final commitment.",
    aboutText: "BinaHub helps organizations build people capability, drive transformation, and deliver sustainable impact.",
    closingTitle: "Start with what matters most.",
    closingText: "The BinaHub team can help clarify priorities, align delivery, and define the next step with you.",
  },
} as const;

function BulletList({ items }: { items: string[] }) {
  return <View>{items.filter(Boolean).map((item, index) => <View key={`${index}-${item}`} style={styles.bullet} wrap={false}><Text style={styles.bulletDot}>•</Text><Text style={styles.bulletText}>{item}</Text></View>)}</View>;
}

function Section({ number, title, children, keepTogether = false }: { number: string; title: string; children: React.ReactNode; keepTogether?: boolean }) {
  return <View style={styles.section} wrap={!keepTogether}><View wrap={false}><Text style={styles.sectionNumber}>{number}</Text><Text style={styles.heading}>{title}</Text></View>{children}</View>;
}

function currency(amount: number, code: string, locale: Locale) {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
}

export function SignatureProposalReport({ formData, proposal, locale = "id", issuedAt }: { formData: AssessmentData; proposal: ProposalResult; locale?: Locale; issuedAt: string }) {
  const copy = translations[locale];
  const preliminary = proposal.documentKind === "preliminary";
  const title = preliminary ? copy.preliminary : copy.commercial;
  const company = formData.company || (locale === "en" ? "Your organization" : "Organisasi Anda");
  const date = new Date(issuedAt).toLocaleDateString(locale === "en" ? "en-US" : "id-ID", { day: "numeric", month: "long", year: "numeric" });
  const commercial = proposal.commercialSnapshot;
  const items = commercial?.items || [];
  const objectives = proposal.learningObjectives || [];
  const scope = proposal.scope || [];
  const solutionRows = proposal.selectedSolutions?.length
    ? proposal.selectedSolutions.map((item) => ({ code: item.code, name: locale === "en" ? item.nameEn || item.name : item.name, focus: locale === "en" ? item.focusEn || item.focus : item.focus }))
    : items.map((item) => ({ code: "", name: item.name, focus: "" }));

  return <Document title={`${title} - ${company}`} author="PT Binahub Solusi Transformasi" subject="BinaHub Signature Solutions">
    <Page size="A4" style={styles.cover}>
      <Text style={styles.wordmark}>BinaHub</Text>
      <Text style={[styles.kicker, { marginTop: 54 }]}>{copy.subtitle}</Text>
      <Text style={styles.coverTitle}>{title}</Text>
      <Text style={styles.coverSubtitle}>{proposal.proposedProgram || copy.subtitle}</Text>
      <View style={styles.coverRule} />
      <View style={styles.coverMetadata}>
        <View style={styles.metadataRow}><Text style={styles.metadataLabel}>{copy.preparedFor}</Text><Text style={styles.metadataValue}>{company}</Text></View>
        <View style={styles.metadataRow}><Text style={styles.metadataLabel}>{copy.contact}</Text><Text style={styles.metadataValue}>{formData.name || "-"}</Text></View>
        <View style={styles.metadataRow}><Text style={styles.metadataLabel}>{copy.date}</Text><Text style={styles.metadataValue}>{date}</Text></View>
        {(preliminary || proposal.isSimulation || proposal.proposalType === "custom") && <View style={styles.metadataRow}><Text style={styles.metadataLabel}>{copy.status}</Text><Text style={styles.metadataValue}>{proposal.isSimulation ? copy.simulation : proposal.proposalType === "custom" ? copy.custom : copy.indicative}</Text></View>}
      </View>
      <Text style={styles.coverFooter}>{copy.confidential}  |  www.binahub.id</Text>
    </Page>

    <Page size="A4" style={styles.page} wrap>
      <View style={styles.header} fixed><Text style={styles.headerBrand}>BinaHub</Text><Text style={styles.headerLabel}>{title}</Text></View>
      <View style={styles.footer} fixed><Text>{copy.confidential}</Text><Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>

      {proposal.isSimulation && <Text style={[styles.body, { color: "#9B341C", fontWeight: 700 }]}>{copy.simulation}</Text>}

      <Section number="01" title={copy.summary}>
        <Text style={styles.body}>{proposal.opening || (locale === "en" ? `This proposal responds to ${company}'s stated needs.` : `Proposal ini disusun berdasarkan kebutuhan ${company} yang telah disampaikan.`)}</Text>
        <Text style={styles.muted}>{copy.context}: {formData.challenge || (locale === "en" ? "To be confirmed with the client." : "Akan dikonfirmasi bersama klien.")}</Text>
      </Section>
      <Section number="02" title={copy.why}><Text style={styles.body}>{copy.solutionReason}</Text></Section>
      <Section number="03" title={copy.objectives}>
        {objectives.length ? <BulletList items={objectives} /> : <Text style={styles.muted}>{copy.objectivesPending}</Text>}
      </Section>
      <Section number="04" title={copy.solutions}>
        <View style={styles.tableHeader}><Text style={[styles.tableHeaderText, { width: "17%" }]}>CODE</Text><Text style={[styles.tableHeaderText, { width: "83%" }]}>{copy.solution.toUpperCase()}</Text></View>
        {solutionRows.map((row, index) => <View key={`${row.code}-${index}`} style={styles.tableRow} wrap={false}><Text style={[styles.tableText, { width: "17%", color: GOLD, fontWeight: 700 }]}>{row.code || `${index + 1}`}</Text><View style={{ width: "83%" }}><Text style={[styles.tableText, { fontWeight: 700 }]}>{row.name}</Text>{row.focus && <Text style={styles.muted}>{row.focus}</Text>}</View></View>)}
      </Section>
      <Section number="05" title={copy.delivery}><Text style={styles.body}>{copy.deliveryText}</Text></Section>
      <Section number="06" title={copy.scope}>
        <BulletList items={scope} />
        {proposal.timeline && <Text style={styles.muted}>{locale === "en" ? "Indicative timeline" : "Perkiraan waktu"}: {proposal.timeline}</Text>}
      </Section>
      <Section number="07" title={copy.investment} keepTogether>
        {items.length > 0 && <View>
          <View style={styles.tableHeader}><Text style={[styles.tableHeaderText, { width: preliminary ? "80%" : "54%" }]}>{copy.solution.toUpperCase()}</Text><Text style={[styles.tableHeaderText, { width: preliminary ? "20%" : "15%", textAlign: "center" }]}>{copy.quantity.toUpperCase()}</Text>{!preliminary && <Text style={[styles.tableHeaderText, { width: "31%", textAlign: "right" }]}>{copy.fee.toUpperCase()}</Text>}</View>
          {items.map((item, index) => <View key={`${item.name}-${index}`} style={styles.tableRow} wrap={false}><Text style={[styles.tableText, { width: preliminary ? "80%" : "54%" }]}>{item.name}</Text><Text style={[styles.tableText, { width: preliminary ? "20%" : "15%", textAlign: "center" }]}>{item.quantity}</Text>{!preliminary && <Text style={[styles.tableText, { width: "31%", textAlign: "right" }]}>{currency(item.lineTotal, commercial?.currency || "IDR", locale)}</Text>}</View>)}
          {!preliminary && (commercial?.discountAmount || 0) > 0 && <View style={styles.tableRow} wrap={false}><Text style={[styles.tableText, { width: "69%" }]}>{copy.discount} ({commercial?.discountPercent}%)</Text><Text style={[styles.tableText, { width: "31%", textAlign: "right" }]}>- {currency(commercial?.discountAmount || 0, commercial?.currency || "IDR", locale)}</Text></View>}
          {!preliminary && <View style={styles.totalRow}><Text style={styles.totalLabel}>{copy.total}</Text><Text style={styles.totalValue}>{currency(commercial?.totalBeforeTax || 0, commercial?.currency || "IDR", locale)}</Text></View>}
        </View>}
        {proposal.investmentNote && <Text style={[styles.body, { marginTop: 10 }]}>{proposal.investmentNote}</Text>}
      </Section>
      <Text style={[styles.muted, { marginBottom: 14 }]}>{copy.exclusions}: {copy.exclusionsText}</Text>
      <Section number="08" title={copy.quality}><Text style={styles.body}>{copy.qualityText}</Text></Section>
      <Section number="09" title={copy.standardOrCustom}><Text style={styles.body}>{proposal.proposalType === "custom" ? copy.customText : copy.standardText}</Text></Section>
      <Section number="10" title={copy.terms}><Text style={styles.body}>{copy.termsText}</Text></Section>
      {commercial?.validityDays && <Text style={styles.muted}>{copy.validity}: {commercial.validityDays} {locale === "en" ? "days from issue" : "hari sejak diterbitkan"}.</Text>}
      <View break wrap={false} style={{ paddingTop: 60 }}>
        <Section number="11" title={copy.next}><Text style={styles.body}>{proposal.nextStep || (locale === "en" ? "Please contact BinaHub to confirm scope and scheduling." : "Silakan hubungi BinaHub untuk mengonfirmasi ruang lingkup dan jadwal.")}</Text></Section>
        <View style={styles.divider} />
        <Section number="12" title={copy.about}><Text style={styles.body}>{copy.aboutText}</Text><Text style={[styles.muted, { marginTop: 5 }]}>People. Learning. Elevated.  |  www.binahub.id</Text></Section>
        <View style={styles.closingPanel}><Text style={styles.closingPanelTitle}>{copy.closingTitle}</Text><Text style={styles.closingPanelText}>{copy.closingText}</Text><Text style={[styles.closingPanelText, { marginTop: 20 }]}>www.binahub.id</Text></View>
      </View>
    </Page>
  </Document>;
}
