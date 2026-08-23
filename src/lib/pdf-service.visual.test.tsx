import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AssessmentData } from './validations';
import { generatePDFBuffer, type AssessmentResult } from './pdf-service';

const renderPreview = process.env.GENERATE_PDF_PREVIEW === '1' ? it : it.skip;

describe('BinaInsight PDF visual preview', () => {
  renderPreview('renders a stable Indonesian sample report', async () => {
    const answers = Object.fromEntries(
      Array.from({ length: 49 }, (_, index) => [String(index + 1), ((index % 4) + 2)]),
    );
    const formData: AssessmentData = {
      name: 'Ayu Pratama',
      email: 'ayu@example.com',
      company: 'PT Tumbuh Bersama Nusantara',
      employees: '51-100 karyawan',
      role: 'Chief People Officer',
      whatsapp: '+62 812 3456 7890',
      challenge: 'Menyelaraskan strategi pertumbuhan dengan ritme eksekusi lintas fungsi.',
      target: 'Membangun organisasi yang adaptif, terukur, dan konsisten mengeksekusi prioritas.',
      answers,
      source: 'insight_assessment',
      locale: 'id',
    };
    const result: AssessmentResult = {
      scores: {
        Insights: 78,
        Lab: 64,
        Coach: 72,
        Play: 58,
        Academy: 69,
        Works: 55,
        Impact: 74,
        overall: 67,
      },
      category: 'Profesional',
      archetype: 'Pembangun Strategis',
      scoreInterpretation: 'Organisasi memiliki fondasi strategi dan kepemimpinan yang cukup kuat. Tantangan utama berada pada konsistensi ritme kerja, kolaborasi lintas fungsi, dan penerjemahan prioritas menjadi kebiasaan operasional yang terukur.',
      aiAnalysis: 'PT Tumbuh Bersama Nusantara berada pada tahap Profesional. Kekuatan pada dimensi Insights menunjukkan bahwa organisasi telah mampu membaca konteks bisnis dan menentukan arah. Namun, skor Works dan Play yang lebih rendah mengindikasikan adanya jarak antara kualitas keputusan dan konsistensi eksekusi. Fokus transformasi sebaiknya diarahkan pada penyederhanaan prioritas, kejelasan akuntabilitas, serta forum koordinasi yang mendorong keputusan cepat dan tindak lanjut yang disiplin.',
      crossDimensionalInsights: [
        'Kekuatan Insights belum sepenuhnya diterjemahkan menjadi sistem kerja yang stabil; keputusan strategis masih berisiko kehilangan momentum saat berpindah ke tahap implementasi.',
        'Kapasitas Coach dan Academy dapat menjadi pengungkit untuk memperkuat Works melalui kebiasaan umpan balik, pembelajaran berbasis kasus nyata, dan akuntabilitas mingguan.',
      ],
      riskProjection: 'Tanpa perbaikan pada ritme eksekusi, pertumbuhan 12-18 bulan ke depan berisiko meningkatkan beban koordinasi, memperlambat keputusan, dan membuat pencapaian target terlalu bergantung pada beberapa individu kunci.',
      strategicKey: 'Bangun satu ritme transformasi 90 hari yang menyatukan prioritas, pemilik keputusan, indikator kemajuan, dan forum tinjauan mingguan. Mulai dari dua proses lintas fungsi yang paling memengaruhi pelanggan.',
      recommendations: [
        {
          title: 'Tetapkan ritme eksekusi 90 hari',
          diagnosis: 'Prioritas strategis belum selalu memiliki pemilik, ukuran kemajuan, dan forum tindak lanjut yang seragam.',
          description: 'Pilih tiga prioritas utama, tetapkan accountable owner, indikator mingguan, serta forum tinjauan singkat yang berfokus pada hambatan dan keputusan.',
          priority: 'Tinggi',
          service: 'BinaWorks',
        },
        {
          title: 'Perkuat koordinasi lintas fungsi',
          diagnosis: 'Kolaborasi masih bergantung pada komunikasi informal dan eskalasi personal.',
          description: 'Petakan dua alur kerja kritis, pertegas hak keputusan, dan gunakan working agreement lintas fungsi untuk mempercepat penyelesaian isu.',
          priority: 'Tinggi',
          service: 'BinaPlay',
        },
        {
          title: 'Aktifkan kepemimpinan sebagai sistem',
          diagnosis: 'Praktik coaching sudah muncul tetapi belum menjadi kebiasaan manajerial yang konsisten.',
          description: 'Gunakan percakapan coaching bulanan, umpan balik berbasis bukti, dan kalibrasi pimpinan agar standar kinerja diterapkan secara konsisten.',
          priority: 'Sedang',
          service: 'BinaCoach',
        },
        {
          title: 'Bangun pembelajaran berbasis pekerjaan',
          diagnosis: 'Program belajar belum selalu terhubung langsung dengan tantangan operasional prioritas.',
          description: 'Rancang sprint pembelajaran singkat berbasis kasus nyata dengan bukti penerapan dan review dampak setelah 30 hari.',
          priority: 'Sedang',
          service: 'BinaAcademy',
        },
        {
          title: 'Ukur dampak transformasi',
          diagnosis: 'Indikator perubahan perilaku dan dampak bisnis belum dipantau dalam satu dashboard.',
          description: 'Gabungkan indikator adopsi, kualitas eksekusi, dan hasil bisnis dalam scorecard yang ditinjau setiap bulan.',
          priority: 'Sedang',
          service: 'BinaImpact',
        },
      ],
    };

    const outputDirectory = path.resolve(process.cwd(), 'output', 'pdf');
    const outputPath = path.join(outputDirectory, 'BinaInsight_Assessment_Report_Sample.pdf');
    await mkdir(outputDirectory, { recursive: true });
    const buffer = await generatePDFBuffer(formData, result, 'id');
    await writeFile(outputPath, buffer);

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.byteLength).toBeGreaterThan(30_000);
  }, 30_000);
});
