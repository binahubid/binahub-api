import React from 'react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { Font, Image as PDFImage, StyleSheet, Text, View } from '@react-pdf/renderer';

// Shared with the approved PETA print identity. Assets are embedded, never fetched.
export const pdfColors = { navy: '#0b2c6b', ink: '#24364b', muted: '#405779', ice: '#eef3fa', rule: '#dce4ef', gold: '#a66a12' };
export const pdfFont = 'BinaHubInter';
const logo = { data: readFileSync(path.join(process.cwd(), 'public/brand/binahub-wordmark.png')), format: 'png' as const };
Font.register({ family: pdfFont, fonts: [
  { src: path.join(process.cwd(), 'public/fonts/Inter-Regular.ttf'), fontWeight: 400 },
  { src: path.join(process.cwd(), 'public/fonts/Inter-SemiBold.ttf'), fontWeight: 600 },
  { src: path.join(process.cwd(), 'public/fonts/Inter-Bold.ttf'), fontWeight: 700 },
] });
Font.registerHyphenationCallback(word => [word]);

// Do not set lineHeight: the installed React PDF engine compounds it on re-layout.
export const pdfStyles = StyleSheet.create({
  page: { paddingTop: 38, paddingBottom: 58, paddingHorizontal: 42, fontFamily: pdfFont, fontSize: 10.5, color: pdfColors.ink, backgroundColor: '#ffffff' },
  brand: { width: 116, height: 33, objectFit: 'contain', marginBottom: 16 },
  header: { paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: pdfColors.rule, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 600, color: pdfColors.navy, letterSpacing: -.35, marginBottom: 10 },
  meta: { fontSize: 9, color: pdfColors.muted, marginBottom: 4 },
  h: { fontSize: 14, fontWeight: 600, color: pdfColors.navy, marginBottom: 10 },
  sub: { fontSize: 11, fontWeight: 600, color: pdfColors.navy, marginBottom: 6 },
  note: { fontSize: 8.5, color: pdfColors.muted },
  footer: { position: 'absolute', bottom: 22, left: 42, right: 42, height: 22, borderTopWidth: .6, borderTopColor: pdfColors.rule, paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  footerLabel: { fontSize: 8, color: pdfColors.muted, flex: 1, paddingRight: 16 },
  footerPage: { width: 74, height: 12, fontSize: 8, color: pdfColors.muted, textAlign: 'right' },
});
export function PDFBrand() { return <PDFImage src={logo} style={pdfStyles.brand} />; }
export function PDFHeader({ title, meta }: { title: string; meta?: string }) {
  return <View fixed><PDFBrand /><View style={pdfStyles.header}><Text style={pdfStyles.title}>{title}</Text>{meta && <Text style={pdfStyles.meta}>{meta}</Text>}</View></View>;
}
export function PDFFooter({ label = 'BinaHub | Rahasia' }: { label?: string }) {
  return <View fixed style={pdfStyles.footer}><Text style={pdfStyles.footerLabel}>{label}</Text><Text style={pdfStyles.footerPage} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>;
}
