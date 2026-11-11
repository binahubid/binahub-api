import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  PDFHeader,
  PDFFooter,
  pdfStyles as s,
  pdfColors as c,
} from "@/lib/pdf-brand";
import type { ProposalSnapshot } from "./proposal";
export const rupiah = (v: number | null) =>
  v === null ? "—" : "Rp" + v.toLocaleString("id-ID");
export async function consultantProposalPDF(
  p: ProposalSnapshot,
  revision: number,
) {
  return renderToBuffer(
    <Document title={"Proposal Program · " + p.company} author="BinaHub">
      <Page size="A4" style={s.page}>
        <PDFHeader
          title="Proposal program pengembangan"
          meta={`${p.company} · Revisi ${revision} · ${new Date(p.issuedAt).toLocaleDateString("id-ID")}`}
        />
        <Text style={{ ...s.meta, marginBottom: 18 }}>
          Disiapkan untuk {p.name} oleh {p.consultant} · Konsultan BinaHub
        </Text>
        <Text style={s.h}>Kebutuhan dan hasil yang dituju</Text>
        {(
          [
            ["Konteks", p.summary.situation],
            ["Tantangan", p.summary.problem],
            ["Dampak", p.summary.impact],
            ["Hasil yang diharapkan", p.summary.outcome],
          ] as const
        ).map(([title, value]) => (
          <View key={title} style={{ marginBottom: 12 }} wrap={false}>
            <Text style={s.sub}>{title}</Text>
            <Text>{value || "Dibahas saat konsultasi."}</Text>
          </View>
        ))}
        <Text style={{ ...s.h, marginTop: 14 }}>Rancangan pelaksanaan</Text>
        <View
          style={{ backgroundColor: c.ice, padding: 14, marginBottom: 14 }}
          wrap={false}
        >
          <Text>
            {p.days} hari · {p.participants} peserta · {p.venue}
          </Text>
          <Text style={{ marginTop: 8 }}>
            Lokasi: {p.location || "Dikonfirmasi bersama"}
          </Text>
        </View>
        {p.programs.map((program) => (
          <View
            key={program.code}
            style={{
              paddingVertical: 14,
              borderBottomWidth: 0.7,
              borderBottomColor: c.rule,
            }}
          >
            <View minPresenceAhead={75} wrap={false}>
              <Text style={s.h}>{program.name}</Text>
              <Text style={s.note}>
                {program.code} · {program.capacity}
              </Text>
            </View>
            {program.objectives.map((objective, i) => (
              <Text key={i} style={{ marginTop: 8 }}>
                • {objective}
              </Text>
            ))}
            <Text style={{ marginTop: 12, fontWeight: 600 }}>
              {program.dailyRate === null
                ? "Tarif program: — (perlu dikonfirmasi)"
                : `${rupiah(program.dailyRate)} / hari × ${p.days} hari = ${rupiah(program.total)}`}
            </Text>
          </View>
        ))}
        {p.scopeNote && (
          <View style={{ marginTop: 18 }}>
            <Text style={s.h}>Ruang lingkup yang disepakati</Text>
            <Text>{p.scopeNote}</Text>
          </View>
        )}
        <View
          style={{ marginTop: 20, padding: 16, backgroundColor: c.ice }}
          wrap={false}
        >
          <Text style={s.h}>Estimasi tarif program: {rupiah(p.total)}</Text>
          <Text style={{ marginBottom: 10 }}>Komponen tambahan: —</Text>
          <Text style={s.note}>{p.priceNote}</Text>
        </View>
        <PDFFooter label="BinaHub | Proposal untuk pembahasan bersama" />
      </Page>
    </Document>,
  );
}
