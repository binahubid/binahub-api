-- Publish the 32-program public Signature Solutions source approved by BinaHub.
-- Existing proposal prices, IDs and internal commercial policies are preserved.
begin;

create temporary table signature_public_copy_32 on commit drop as
select * from jsonb_to_recordset($programs$
[
  {
    "code": "SS-01",
    "product": "signature-self",
    "position": 1,
    "id": {
      "name": "Emotional Intelligence",
      "summary": "Kenali Diri. Terhubung Lebih Baik.",
      "tagline": "Kenali Diri. Terhubung Lebih Baik.",
      "learningObjectives": [
        "Mengenali pemicu emosi dan pola perilaku pribadi yang memengaruhi interaksi di tempat kerja",
        "Menerapkan strategi regulasi diri yang praktis untuk menjaga perilaku tetap efektif saat berada di bawah tekanan",
        "Menunjukkan empati dengan mempertimbangkan sudut pandang orang lain dan menanggapi secara konstruktif",
        "Menggunakan perilaku komunikasi dan pengelolaan konflik yang memperkuat hubungan profesional"
      ],
      "contentOutline": [
        "Memahami kesadaran diri, emosi, pemicu, dan pola perilaku",
        "Pengelolaan diri dan regulasi diri dalam situasi yang menantang",
        "Membaca isyarat sosial dan memahami sudut pandang orang lain",
        "Empati dan pengelolaan hubungan",
        "Penerapan pada komunikasi, kolaborasi, konflik, dan kepemimpinan"
      ],
      "outputs": [
        "Peserta mengidentifikasi pola pribadi utama dan area pengembangan.",
        "Peserta memiliki strategi praktis untuk mengelola respons emosional.",
        "Peserta meningkatkan kemampuan memahami perspektif dan respons interpersonal.",
        "Tindakan pengembangan individu atau tim teridentifikasi."
      ],
      "bestFor": "Profesional, manajer, pemimpin, dan tim",
      "duration": "1 hari standar; dapat dikonfigurasi menjadi 2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab",
      "notes": "Asesmen seperti DISC atau perangkat perilaku/kepribadian lain dapat digunakan bila relevan."
    },
    "en": {
      "name": "Emotional Intelligence",
      "serviceBrand": "BinaLab",
      "tagline": "Kenali Diri. Terhubung Lebih Baik."
    }
  },
  {
    "code": "SS-02",
    "product": "signature-self",
    "position": 2,
    "id": {
      "name": "Professional Excellence",
      "summary": "Pola Pikir dan Perilaku di Balik Dampak Profesional.",
      "tagline": "Pola Pikir dan Perilaku di Balik Dampak Profesional.",
      "learningObjectives": [
        "Menunjukkan integritas dengan menyelaraskan tindakan dengan komitmen dan standar profesional",
        "Menerapkan kriteria kualitas yang disepakati dan memeriksa hasil kerja sebelum diserahkan",
        "Memperjelas hasil yang diharapkan, memantau komitmen, dan menuntaskan pekerjaan secara andal",
        "Mengidentifikasi dan menerapkan satu perbaikan untuk memperkuat efektivitas profesional"
      ],
      "contentOutline": [
        "Pola pikir dan sikap profesional",
        "Rasa kepemilikan (ownership), akuntabilitas, dan keandalan",
        "Perilaku profesional dan standar tempat kerja",
        "Pola pikir unggul dan perbaikan diri berkelanjutan",
        "Penerapan pada kebiasaan kerja, kolaborasi, dan penyelesaian pekerjaan"
      ],
      "outputs": [
        "Peserta memahami perilaku yang berkaitan dengan dampak profesional.",
        "Komitmen pribadi yang jelas untuk kepemilikan dan akuntabilitas yang lebih kuat.",
        "Perubahan perilaku praktis yang dapat langsung diterapkan di pekerjaan."
      ],
      "bestFor": "Profesional, staf, supervisor, dan manajer",
      "duration": "1 hari standar; dapat dikonfigurasi menjadi 2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Professional Excellence",
      "serviceBrand": "BinaLab",
      "tagline": "Pola Pikir dan Perilaku di Balik Dampak Profesional."
    }
  },
  {
    "code": "SS-03",
    "product": "signature-self",
    "position": 3,
    "id": {
      "name": "Personal Productivity & Effectiveness",
      "summary": "Bekerja Lebih Baik. Fokus Lebih Baik. Capai Lebih Banyak.",
      "tagline": "Bekerja Lebih Baik. Fokus Lebih Baik. Capai Lebih Banyak.",
      "learningObjectives": [
        "Memprioritaskan pekerjaan berdasarkan sasaran, urgensi, dan dampak",
        "Menerjemahkan prioritas menjadi rencana, jadwal, dan pilihan sumber daya yang realistis",
        "Memantau kemajuan, menangani keterlambatan, dan menuntaskan hasil kerja yang disepakati",
        "Menjaga kualitas dan fokus saat mengelola tuntutan yang saling bersaing"
      ],
      "contentOutline": [
        "Prioritisasi dan pengelolaan fokus",
        "Manajemen waktu dan perhatian",
        "Disiplin eksekusi dan tindak lanjut (follow-through)",
        "Pembentukan kebiasaan dan sistem kerja pribadi",
        "Mengelola beban kerja, gangguan, dan prioritas yang saling bersaing"
      ],
      "outputs": [
        "Peserta menetapkan prioritas dan rutinitas eksekusi yang lebih jelas.",
        "Sistem produktivitas pribadi atau rencana aksi yang praktis.",
        "Kebiasaan dan komitmen spesifik untuk meningkatkan efektivitas kerja."
      ],
      "bestFor": "Profesional, manajer, dan kontributor individu",
      "duration": "1 hari standar; dapat dikonfigurasi menjadi 2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Personal Productivity & Effectiveness",
      "serviceBrand": "BinaLab",
      "tagline": "Bekerja Lebih Baik. Fokus Lebih Baik. Capai Lebih Banyak."
    }
  },
  {
    "code": "SS-04",
    "product": "signature-self",
    "position": 4,
    "id": {
      "name": "Communication & Presentation",
      "summary": "Berkomunikasi Jelas. Memengaruhi Secara Efektif.",
      "tagline": "Berkomunikasi Jelas. Memengaruhi Secara Efektif.",
      "learningObjectives": [
        "Menyusun pesan menjadi struktur yang jelas dan logis sesuai audiens",
        "Menggunakan mendengarkan aktif dan klarifikasi untuk membangun pemahaman bersama",
        "Menyampaikan presentasi dengan percaya diri menggunakan teknik verbal, nonverbal, dan visual yang efektif",
        "Menggunakan komunikasi yang berpusat pada audiens untuk memperoleh pemahaman dan dukungan terhadap gagasan",
        "Menunjukkan kehadiran profesional (professional presence) yang sesuai dengan audiens dan konteks"
      ],
      "contentOutline": [
        "Dasar-dasar komunikasi dan kejelasan pesan",
        "Komunikasi interpersonal dan mendengarkan aktif",
        "Struktur, penyampaian, dan kehadiran dalam presentasi",
        "Public speaking dan penanganan pertanyaan",
        "Memengaruhi melalui kebutuhan audiens dan rancangan pesan"
      ],
      "outputs": [
        "Peserta mampu menyusun dan menyampaikan pesan yang lebih jelas.",
        "Teknik presentasi dan komunikasi yang lebih baik.",
        "Komitmen komunikasi pribadi dan umpan balik dari latihan."
      ],
      "bestFor": "Profesional, manajer, pemimpin, presenter, dan tim yang berhadapan dengan klien",
      "duration": "1 hari standar; dapat dikonfigurasi menjadi 2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Communication & Presentation",
      "serviceBrand": "BinaLab",
      "tagline": "Berkomunikasi Jelas. Memengaruhi Secara Efektif."
    }
  },
  {
    "code": "SS-05",
    "product": "signature-self",
    "position": 5,
    "id": {
      "name": "Service Excellence",
      "summary": "Ciptakan Layanan yang Diingat Pelanggan.",
      "tagline": "Ciptakan Layanan yang Diingat Pelanggan.",
      "learningObjectives": [
        "Mengidentifikasi kebutuhan dan ekspektasi pelanggan serta menghubungkannya dengan layanan yang diberikan",
        "Menyampaikan informasi layanan secara jelas, santun, dan akurat",
        "Menanggapi keluhan secara konstruktif dan memilih tindakan pemulihan layanan (service recovery) yang tepat",
        "Menunjukkan empati dan keramahan serta mengantisipasi kebutuhan pelanggan yang belum disampaikan",
        "Menerapkan standar layanan yang konsisten dan memegang tanggung jawab atas hasil bagi pelanggan"
      ],
      "contentOutline": [
        "Pola pikir layanan dan orientasi pelanggan",
        "Kebutuhan pelanggan dan pengalaman pelanggan (customer experience)",
        "Komunikasi layanan dan pengelolaan ekspektasi",
        "Penanganan keluhan dan pemulihan layanan",
        "Kepemilikan, responsivitas, dan perilaku layanan yang konsisten"
      ],
      "outputs": [
        "Peserta memahami perilaku yang membentuk pengalaman pelanggan.",
        "Teknik respons dan pemulihan layanan yang praktis.",
        "Standar layanan pribadi/tim dan komitmen tindakan."
      ],
      "bestFor": "Tim yang berhadapan dengan pelanggan, tim layanan, supervisor, dan manajer; terutama lingkungan perhotelan/layanan",
      "duration": "1 hari standar; dapat dikonfigurasi menjadi 2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab",
      "notes": "Perhotelan dapat digunakan sebagai konteks industri; konten dapat dikonfigurasi untuk lingkungan layanan lainnya."
    },
    "en": {
      "name": "Service Excellence",
      "serviceBrand": "BinaLab",
      "tagline": "Ciptakan Layanan yang Diingat Pelanggan."
    }
  },
  {
    "code": "SS-06",
    "product": "signature-self",
    "position": 6,
    "id": {
      "name": "Problem Solving, Decision Making, & Innovation",
      "summary": "Berpikir Jernih. Menyelesaikan Secara Efektif. Ciptakan Hal Berikutnya.",
      "tagline": "Berpikir Jernih. Menyelesaikan Secara Efektif. Ciptakan Hal Berikutnya.",
      "learningObjectives": [
        "Merumuskan masalah, hasil yang diinginkan, dan kendala yang relevan sebelum memilih solusi",
        "Menganalisis penyebab dan pola menggunakan informasi yang relevan serta asumsi yang telah diuji",
        "Membandingkan alternatif berdasarkan kriteria, manfaat, risiko, dan konsekuensi sebelum memutuskan",
        "Menghasilkan, menguji, dan menyempurnakan gagasan perbaikan menggunakan bukti dari eksperimen atau umpan balik"
      ],
      "contentOutline": [
        "Pembingkaian masalah dan berpikir kritis",
        "Analisis akar masalah dan pemecahan masalah terstruktur",
        "Pengambilan keputusan di bawah keterbatasan dan ketidakpastian",
        "Berpikir kreatif dan pola pikir inovasi",
        "Design thinking, eksperimen, dan belajar dari hasil"
      ],
      "outputs": [
        "Peserta dapat membingkai dan menganalisis masalah secara lebih sistematis.",
        "Pendekatan solusi atau keputusan terstruktur yang diterapkan pada kasus nyata.",
        "Gagasan, eksperimen, atau tindakan perbaikan yang dapat dilanjutkan."
      ],
      "bestFor": "Profesional, manajer, pemimpin, tim perbaikan, dan tim inovasi",
      "duration": "1 hari standar; dapat dikonfigurasi menjadi 2 hari atau journey yang lebih panjang",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab",
      "notes": "Design Thinking digunakan sebagai metode/komponen, bukan sebagai Signature Solution tersendiri."
    },
    "en": {
      "name": "Problem Solving, Decision Making, & Innovation",
      "serviceBrand": "BinaLab",
      "tagline": "Berpikir Jernih. Menyelesaikan Secara Efektif. Ciptakan Hal Berikutnya."
    }
  },
  {
    "code": "SS-07",
    "product": "signature-self",
    "position": 7,
    "id": {
      "name": "First-Time Leader",
      "summary": "Dari Kontributor Individu Menjadi People Leader.",
      "tagline": "Dari Kontributor Individu Menjadi People Leader.",
      "learningObjectives": [
        "Memperjelas tanggung jawab dan perilaku yang diharapkan dari people leader yang baru pertama kali memimpin",
        "Menetapkan arah tim dan mendelegasikan tugas dengan hasil, kewenangan, dan tindak lanjut yang jelas",
        "Melakukan percakapan umpan balik dan pengembangan yang konstruktif untuk mendukung pertumbuhan karyawan",
        "Membangun akuntabilitas dan kepercayaan saat bertransisi dari rekan sejawat menjadi pemimpin"
      ],
      "contentOutline": [
        "Transisi dari kontributor individu menjadi people leader",
        "Identitas, pola pikir, dan ekspektasi kepemimpinan",
        "Memimpin mantan rekan sejawat dan menetapkan arah tim",
        "Delegasi, umpan balik, percakapan coaching, dan motivasi",
        "Akuntabilitas dan pengelolaan kinerja orang tingkat dasar"
      ],
      "outputs": [
        "Peserta memperjelas peran dan ekspektasi kepemimpinan mereka.",
        "Alat bantu delegasi, umpan balik, dan coaching yang praktis.",
        "Rencana aksi kepemimpinan pribadi untuk transisi menjadi people leader."
      ],
      "bestFor": "Pemimpin yang baru pertama kali memimpin, supervisor yang baru diangkat, dan people manager pemula",
      "duration": "1–2 hari + tindak lanjut opsional",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "First-Time Leader",
      "serviceBrand": "BinaLab",
      "tagline": "Dari Kontributor Individu Menjadi People Leader."
    }
  },
  {
    "code": "SS-08",
    "product": "signature-self",
    "position": 8,
    "id": {
      "name": "Adaptive Leadership",
      "summary": "Memimpin di Tengah Perubahan dan Ketidakpastian.",
      "tagline": "Memimpin di Tengah Perubahan dan Ketidakpastian.",
      "learningObjectives": [
        "Menilai bagaimana perubahan dan ketidakpastian memengaruhi prioritas tim, pemangku kepentingan, dan kinerja",
        "Menyesuaikan pendekatan kepemimpinan dan prioritas seiring perubahan kondisi dan bukti",
        "Mengomunikasikan perubahan secara jelas dan mendukung orang melewati masa transisi",
        "Mengambil keputusan tepat waktu di tengah ketidakpastian dengan mempertimbangkan risiko serta menjaga efektivitas di bawah tekanan"
      ],
      "contentOutline": [
        "Prinsip kepemimpinan adaptif",
        "Memimpin di tengah perubahan, ambiguitas, dan ketidakpastian",
        "Pengambilan keputusan di bawah ketidakpastian",
        "Komunikasi perubahan dan respons pemangku kepentingan",
        "Ketahanan (resilience) dan kepemimpinan masa transisi"
      ],
      "outputs": [
        "Peserta mengidentifikasi tantangan kepemimpinan adaptif mereka.",
        "Pendekatan praktis untuk memimpin perubahan dan ketidakpastian.",
        "Rencana aksi pribadi/tim untuk kepemimpinan adaptif."
      ],
      "bestFor": "Manajer, pemimpin, change leader, dan profesional yang menghadapi perubahan signifikan",
      "duration": "1–2 hari + tindak lanjut opsional",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Adaptive Leadership",
      "serviceBrand": "BinaLab",
      "tagline": "Memimpin di Tengah Perubahan dan Ketidakpastian."
    }
  },
  {
    "code": "SS-09",
    "product": "signature-self",
    "position": 9,
    "id": {
      "name": "AI-Powered Professional",
      "summary": "Bekerja Lebih Cerdas. Berpikir Kritis. Tetap Manusiawi.",
      "tagline": "Bekerja Lebih Cerdas. Berpikir Kritis. Tetap Manusiawi.",
      "learningObjectives": [
        "Mengidentifikasi tugas kerja yang dapat diperkuat oleh alat digital atau AI dan yang tidak sesuai untuk itu",
        "Menggunakan AI untuk mendukung alur kerja yang telah ditetapkan dengan konteks, instruksi, dan kriteria keluaran yang jelas",
        "Memverifikasi informasi dan keluaran yang dihasilkan AI sebelum digunakan atau dibagikan",
        "Melindungi informasi sensitif serta tetap bertanggung jawab atas akurasi, pertimbangan, dan penggunaan yang bertanggung jawab"
      ],
      "contentOutline": [
        "Literasi AI dan contoh penggunaan praktis",
        "Produktivitas berbantuan AI dan perancangan alur kerja",
        "Prompting, alat bantu, dan kolaborasi manusia–AI",
        "Berpikir kritis, verifikasi, dan pertimbangan",
        "AI yang bertanggung jawab dan batasan profesional"
      ],
      "outputs": [
        "Peserta mengidentifikasi kasus penggunaan AI yang relevan untuk pekerjaan mereka.",
        "Alur kerja atau eksperimen kerja berbantuan AI yang praktis.",
        "Prinsip yang jelas untuk penggunaan AI yang bertanggung jawab dan berpusat pada manusia."
      ],
      "bestFor": "Profesional, manajer, pekerja pengetahuan, dan tim yang beradaptasi dengan pekerjaan berbasis AI",
      "duration": "1 hari standar; dapat dikonfigurasi menjadi 2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab",
      "notes": "Alat dan latihan dapat disesuaikan dengan lingkungan AI yang disetujui organisasi."
    },
    "en": {
      "name": "AI-Powered Professional",
      "serviceBrand": "BinaLab",
      "tagline": "Bekerja Lebih Cerdas. Berpikir Kritis. Tetap Manusiawi."
    }
  },
  {
    "code": "SS-10",
    "product": "signature-self",
    "position": 10,
    "id": {
      "name": "Coaching Skills for Leaders",
      "summary": "Coach with Purpose. Develop People. Enable Performance.",
      "tagline": "Coach with Purpose. Develop People. Enable Performance.",
      "learningObjectives": [
        "Memahami peran, prinsip, dan batasan coaching dalam kepemimpinan sehari-hari",
        "Mempraktikkan keterampilan mendengarkan aktif, pertanyaan terbuka, dan parafrasa untuk membantu anggota tim berpikir",
        "Memberikan umpan balik yang spesifik dan berorientasi pada perilaku serta dampak",
        "Membantu anggota tim menyepakati tujuan, langkah tindakan, dan tindak lanjut pengembangan"
      ],
      "contentOutline": [
        "Prinsip dan etika coaching bagi pemimpin",
        "Perbedaan coaching, mentoring, directing, dan counseling",
        "Batas rujukan",
        "Active listening, pertanyaan terbuka, parafrasa, dan refleksi",
        "Feedback berbasis perilaku dan dampak",
        "Goal setting, action commitment, dan follow-through",
        "Praktik percakapan coaching dengan skenario kerja dan umpan balik terstruktur"
      ],
      "outputs": [
        "Peserta mampu melakukan percakapan coaching terstruktur dengan anggota tim.",
        "Peserta mempraktikkan pertanyaan terbuka, mendengarkan aktif, dan parafrasa.",
        "Peserta memberikan umpan balik spesifik dan membantu coachee menyepakati langkah tindakan.",
        "Peserta menggunakan action plan dan tindak lanjut untuk mendukung pengembangan anggota tim."
      ],
      "bestFor": "Supervisor, manajer, team leader, dan people manager yang perlu mengembangkan anggota tim melalui coaching.",
      "duration": "1 hari standar; opsi 2 hari untuk praktik dan simulasi lanjutan",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab",
      "notes": "Workshop ini melatih keterampilan coaching dalam peran kepemimpinan; bukan layanan coaching individual atau terapi klinis."
    },
    "en": {
      "name": "Coaching Skills for Leaders",
      "serviceBrand": "BinaLab",
      "tagline": "Coach with Purpose. Develop People. Enable Performance.",
      "summary": "Develop team members through structured coaching conversations.",
      "learningObjectives": [
        "Distinguish coaching from other ways of supporting a team member.",
        "Use listening and open questions to clarify the goal and explore options.",
        "Agree a practical next step and follow up."
      ],
      "contentOutline": [
        "The role of coaching in leadership",
        "Listening and asking useful questions",
        "Structured coaching conversations",
        "Practice, feedback, and follow-up"
      ],
      "outputs": [
        "A coaching conversation plan and a practical follow-up plan."
      ],
      "duration": "1 day; optional 2 days for additional practice and simulation",
      "capacity": "Up to 30 participants",
      "bestFor": "Supervisors, managers, team leaders and people managers",
      "engagementFormat": "Workshop"
    }
  },
  {
    "code": "SS-11",
    "product": "signature-team",
    "position": 11,
    "id": {
      "name": "Team Building",
      "summary": "Bangun Koneksi. Perkuat Kolaborasi. Ciptakan Energi Tim.",
      "tagline": "Bangun Koneksi. Perkuat Kolaborasi. Ciptakan Energi Tim.",
      "learningObjectives": [
        "Membangun kepercayaan dan keterbukaan melalui perilaku tim yang dapat diamati dan komitmen bersama",
        "Mengoordinasikan kontribusi dan memperkuat kolaborasi menuju tujuan bersama",
        "Mempraktikkan pemahaman perspektif dan komunikasi konstruktif saat menghadapi tantangan tim",
        "Menerjemahkan pembelajaran experiential menjadi kesepakatan tim dan tindakan praktis di tempat kerja"
      ],
      "contentOutline": [
        "Koneksi dan kebersamaan tim",
        "Kepercayaan dan keterbukaan",
        "Kolaborasi dan sinergi",
        "Empati dan pemahaman perspektif",
        "Aktivasi nilai",
        "Budaya dan penyelarasan prioritas bisnis",
        "Aktivitas experiential, simulasi, permainan, refleksi, dan komitmen tim"
      ],
      "outputs": [
        "Pengalaman tim bersama yang terkait dengan tujuan bisnis atau tim yang jelas.",
        "Wawasan tim dan pola kolaborasi yang teridentifikasi.",
        "Komitmen atau tindakan tim yang konkret setelah pengalaman."
      ],
      "bestFor": "Tim, departemen, tim proyek, tim kepemimpinan, dan kelompok organisasi",
      "duration": "0,5–1 hari standar; dapat dikonfigurasi dari 2–4 jam hingga 2 hari",
      "capacity": "Essential: hingga 30 peserta; Signature: 31–80; Enterprise: 81–150",
      "serviceBrand": "BinaPlay",
      "notes": "Nama paket menunjukkan skala/kapasitas peserta, bukan tingkatan kualitas. Team Building berorientasi hasil, bukan sekadar permainan atau acara rekreasi (outing)."
    },
    "en": {
      "name": "Team Building",
      "serviceBrand": "BinaPlay",
      "tagline": "Bangun Koneksi. Perkuat Kolaborasi. Ciptakan Energi Tim."
    }
  },
  {
    "code": "SS-12",
    "product": "signature-team",
    "position": 12,
    "id": {
      "name": "Trust & Psychological Safety",
      "summary": "Ciptakan Tim Tempat Orang Berani Bicara, Mendengar, dan Berkontribusi.",
      "tagline": "Ciptakan Tim Tempat Orang Berani Bicara, Mendengar, dan Berkontribusi.",
      "learningObjectives": [
        "Menunjukkan perilaku yang membangun keandalan, keterbukaan, dan kepercayaan interpersonal",
        "Berlatih menyampaikan pendapat, mendengarkan tanpa menghakimi lebih dulu, dan mengakui perbedaan pandangan",
        "Menangani perbedaan pendapat secara konstruktif sambil menjaga rasa hormat dan akuntabilitas",
        "Menyepakati norma tim yang mendukung kontribusi yang aman dan diskusi yang jujur"
      ],
      "contentOutline": [
        "Dasar-dasar kepercayaan dan psychological safety",
        "Menyampaikan pendapat, mendengarkan, dan berinteraksi secara konstruktif",
        "Menangani perbedaan pendapat dan kerentanan (vulnerability) di tempat kerja",
        "Perilaku pemimpin",
        "Tim yang memperkuat psychological safety",
        "Norma dan komitmen tim yang praktis"
      ],
      "outputs": [
        "Peserta mengidentifikasi perilaku yang memperkuat atau melemahkan kepercayaan.",
        "Perilaku atau norma tim yang disepakati untuk kolaborasi yang lebih aman.",
        "Tindakan praktis untuk meningkatkan cara berbicara, mendengarkan, dan berkontribusi."
      ],
      "bestFor": "Tim, pemimpin, dan organisasi yang menginginkan kepercayaan dan psychological safety yang lebih kuat",
      "duration": "1–2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Trust & Psychological Safety",
      "serviceBrand": "BinaLab",
      "tagline": "Ciptakan Tim Tempat Orang Berani Bicara, Mendengar, dan Berkontribusi."
    }
  },
  {
    "code": "SS-13",
    "product": "signature-team",
    "position": 13,
    "id": {
      "name": "Team Synergy",
      "summary": "Dari Kontribusi Individu Menuju Kinerja Kolektif.",
      "tagline": "Dari Kontribusi Individu Menuju Kinerja Kolektif.",
      "learningObjectives": [
        "Menyelaraskan anggota tim di sekitar tujuan, peran, dan interdependensi bersama",
        "Mengoordinasikan kontribusi lintas fungsi dan menutup celah kepemilikan atau serah terima pekerjaan (handoff)",
        "Memecahkan masalah kerja secara kolektif dengan memadukan beragam perspektif dan bukti",
        "Mengubah keputusan tim menjadi komitmen yang jelas, penanggung jawab, dan tindak lanjut"
      ],
      "contentOutline": [
        "Tujuan, sasaran, dan keselarasan tim",
        "Kejelasan peran dan interdependensi",
        "Kolaborasi lintas fungsi",
        "Pemecahan masalah dan pengambilan keputusan kolektif",
        "Praktik sinergi dan akuntabilitas bersama"
      ],
      "outputs": [
        "Pemahaman yang lebih jelas tentang peran dan interdependensi.",
        "Hambatan kolaborasi dan tindakan perbaikan yang teridentifikasi.",
        "Kesepakatan tim dan komitmen sinergi yang praktis."
      ],
      "bestFor": "Tim lintas fungsi, departemen, tim proyek, dan tim kepemimpinan",
      "duration": "1–2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Team Synergy",
      "serviceBrand": "BinaLab",
      "tagline": "Dari Kontribusi Individu Menuju Kinerja Kolektif."
    }
  },
  {
    "code": "SS-14",
    "product": "signature-team",
    "position": 14,
    "id": {
      "name": "Empathy Experience",
      "summary": "Experience. Awareness. Choice. Action.",
      "tagline": "Experience. Awareness. Choice. Action.",
      "learningObjectives": [
        "Mengidentifikasi bagaimana orang yang berbeda dapat mengalami situasi kerja yang sama secara berbeda",
        "Menggunakan pemahaman perspektif untuk membedakan asumsi dari apa yang mungkin dipikirkan, dirasakan, atau dibutuhkan orang lain",
        "Memilih respons yang menunjukkan empati sambil menjaga batasan yang sesuai",
        "Menerjemahkan refleksi menjadi perilaku spesifik yang memperbaiki hubungan dan kolaborasi di tempat kerja"
      ],
      "contentOutline": [
        "Empati dan pemahaman perspektif (perspective-taking)",
        "Pengalaman dan kesadaran melalui simulasi",
        "Aktivitas experiential",
        "Memahami SAYS → THINKS → FEELS → DOES",
        "Pilihan dan respons perilaku",
        "Tindakan dan penerapan pada hubungan kerja"
      ],
      "outputs": [
        "Peserta mengalami situasi dari berbagai perspektif.",
        "Kesadaran yang lebih besar akan asumsi, kebutuhan, dan reaksi.",
        "Komitmen empati-dalam-tindakan yang konkret."
      ],
      "bestFor": "Tim, pemimpin, kelompok yang berhadapan dengan pelanggan, dan organisasi yang menginginkan hubungan antarmanusia yang lebih kuat",
      "duration": "1–2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab",
      "notes": "Urutan experiential inti: EXPERIENCE → AWARENESS → CHOICE → ACTION."
    },
    "en": {
      "name": "Empathy Experience",
      "serviceBrand": "BinaLab",
      "tagline": "Experience. Awareness. Choice. Action."
    }
  },
  {
    "code": "SS-15",
    "product": "signature-team",
    "position": 15,
    "id": {
      "name": "High Performing Team",
      "summary": "Bangun Kebiasaan Tim Berkinerja Tinggi.",
      "tagline": "Bangun Kebiasaan Tim Berkinerja Tinggi.",
      "learningObjectives": [
        "Menyelaraskan tujuan tim, ekspektasi kinerja, dan ukuran keberhasilan",
        "Memperjelas peran, hak pengambilan keputusan, dan cara kerja yang mendukung eksekusi yang andal",
        "Meninjau kemajuan dan kualitas, menangani kesenjangan kinerja, dan memperkuat akuntabilitas",
        "Membangun rutinitas tim untuk pembelajaran, perbaikan berkelanjutan, dan hasil yang berkelanjutan"
      ],
      "contentOutline": [
        "Karakteristik dan kebiasaan tim berkinerja tinggi",
        "Norma kinerja dan akuntabilitas",
        "Kolaborasi, disiplin, dan eksekusi",
        "Umpan balik dan siklus pembelajaran",
        "Praktik perbaikan berkelanjutan"
      ],
      "outputs": [
        "Kekuatan dan kesenjangan kinerja tim menjadi terlihat.",
        "Norma dan perilaku kinerja yang disepakati.",
        "Rencana perbaikan tim yang praktis dan tindakan tindak lanjut."
      ],
      "bestFor": "Tim kepemimpinan, tim manajemen, tim proyek, dan tim yang sudah mapan",
      "duration": "1–2 hari + tindak lanjut opsional",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "High Performing Team",
      "serviceBrand": "BinaLab",
      "tagline": "Bangun Kebiasaan Tim Berkinerja Tinggi."
    }
  },
  {
    "code": "SS-16",
    "product": "signature-team",
    "position": 16,
    "id": {
      "name": "Team Agility",
      "summary": "Bangun Tim yang Mampu Beradaptasi.",
      "tagline": "Bangun Tim yang Mampu Beradaptasi.",
      "learningObjectives": [
        "Mengenali perubahan prioritas, ketergantungan, dan kondisi operasi tim sejak dini",
        "Menyesuaikan rencana dan metode kerja sambil menjaga tujuan bersama tetap terlihat",
        "Mengoordinasikan keputusan cepat dan eksperimen di antara anggota tim dengan pengendalian risiko yang memadai",
        "Pulih dari kemunduran, belajar dari hasil, dan menyesuaikan iterasi kerja berikutnya"
      ],
      "contentOutline": [
        "Ketangkasan (agility) dan adaptabilitas tim",
        "Kolaborasi cepat dan siklus keputusan",
        "Eksperimen dan iterasi",
        "Belajar dari umpan balik dan perubahan kondisi",
        "Praktik tim yang mendukung responsivitas"
      ],
      "outputs": [
        "Peserta mengidentifikasi hambatan dan peluang agility.",
        "Praktik atau eksperimen agility tim yang praktis.",
        "Komitmen tim untuk belajar dan beradaptasi lebih cepat."
      ],
      "bestFor": "Tim yang menghadapi perubahan, transformasi, cara kerja baru, atau prioritas yang bergejolak",
      "duration": "1–2 hari + tindak lanjut opsional",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Team Agility",
      "serviceBrand": "BinaLab",
      "tagline": "Bangun Tim yang Mampu Beradaptasi."
    }
  },
  {
    "code": "SS-17",
    "product": "signature-team",
    "position": 17,
    "id": {
      "name": "Leading the Team",
      "summary": "Selaraskan. Kembangkan. Gerakkan.",
      "tagline": "Selaraskan. Kembangkan. Gerakkan.",
      "learningObjectives": [
        "Menetapkan arah, prioritas, peran, dan ekspektasi kinerja tim yang jelas",
        "Mendelegasikan hasil dengan kewenangan, sumber daya, dan akuntabilitas yang sesuai",
        "Melakukan coaching kepada anggota tim melalui percakapan umpan balik dan pengembangan",
        "Memantau komitmen tim, menangani masalah kinerja, dan menjaga motivasi menuju hasil bersama"
      ],
      "contentOutline": [
        "Kepemimpinan dan arah tim",
        "Penyelarasan, delegasi, dan prioritisasi",
        "Pengembangan orang dan coaching",
        "Motivasi dan keterlibatan",
        "Percakapan kinerja dan akuntabilitas"
      ],
      "outputs": [
        "Peserta memperkuat perangkat kepemimpinan tim yang praktis.",
        "Tindakan delegasi, pengembangan, dan komunikasi yang lebih jelas.",
        "Rencana aksi kepemimpinan tim."
      ],
      "bestFor": "Supervisor, manajer, pemimpin tim, dan people manager",
      "duration": "1–2 hari + coaching opsional",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Leading the Team",
      "serviceBrand": "BinaLab",
      "tagline": "Selaraskan. Kembangkan. Gerakkan."
    }
  },
  {
    "code": "SS-18",
    "product": "signature-organization",
    "position": 18,
    "id": {
      "name": "Culture Activation",
      "summary": "Ubah Nilai Menjadi Perilaku Sehari-hari.",
      "tagline": "Ubah Nilai Menjadi Perilaku Sehari-hari.",
      "learningObjectives": [
        "Menerjemahkan nilai organisasi menjadi perilaku kerja yang spesifik dan dapat diamati",
        "Menyelaraskan praktik kepemimpinan, rutinitas tim, dan pengakuan (recognition) dengan budaya yang diinginkan",
        "Meneladankan keputusan dan perilaku yang konsisten untuk memperkuat nilai yang dinyatakan",
        "Mengaktivasi perubahan budaya melalui pelibatan pemangku kepentingan, komunikasi, dan penguatan"
      ],
      "contentOutline": [
        "Penerjemahan nilai menjadi perilaku",
        "Keselarasan budaya dan ekspektasi perilaku",
        "Keteladanan kepemimpinan",
        "Ritual, praktik, dan penguatan sehari-hari",
        "Menanamkan budaya ke dalam rutinitas tim dan organisasi"
      ],
      "outputs": [
        "Interpretasi perilaku atas nilai-nilai organisasi.",
        "Perilaku budaya prioritas dan tindakan aktivasi.",
        "Komitmen pemimpin/tim dan mekanisme penguatan."
      ],
      "bestFor": "Organisasi, unit bisnis, tim kepemimpinan, dan inisiatif transformasi budaya",
      "duration": "3–6 bulan, dapat dikonfigurasi",
      "capacity": "Bergantung pada ruang lingkup",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Culture Activation",
      "serviceBrand": "BinaLab",
      "tagline": "Ubah Nilai Menjadi Perilaku Sehari-hari."
    }
  },
  {
    "code": "SS-19",
    "product": "signature-organization",
    "position": 19,
    "id": {
      "name": "Change & Organizational Agility",
      "summary": "Bangun Organisasi yang Mampu Beradaptasi.",
      "tagline": "Bangun Organisasi yang Mampu Beradaptasi.",
      "learningObjectives": [
        "Menilai kesiapan organisasi, dampak perubahan, dan hambatan adopsi",
        "Merencanakan pelibatan pemangku kepentingan dan komunikasi yang mendukung pemahaman serta transisi",
        "Menyesuaikan rencana implementasi berdasarkan umpan balik, bukti, dan kondisi yang berkembang",
        "Mengidentifikasi risiko adopsi dan memantau tindakan yang menjaga keberlanjutan perubahan yang dimaksud"
      ],
      "contentOutline": [
        "Kesiapan perubahan dan ketangkasan organisasi",
        "Keselarasan pemangku kepentingan dan adopsi",
        "Komunikasi perubahan dan transisi",
        "Kapabilitas adaptif dan pembelajaran",
        "Menanamkan perubahan ke dalam praktik organisasi"
      ],
      "outputs": [
        "Wawasan kesiapan perubahan dan adopsi.",
        "Hambatan prioritas dan area tindakan.",
        "Peta jalan (roadmap) perubahan/adopsi atau rencana intervensi yang terstruktur."
      ],
      "bestFor": "Organisasi yang sedang bertransformasi, restrukturisasi, perubahan digital, atau pergeseran strategis besar",
      "duration": "3–6 bulan, dapat dikonfigurasi",
      "capacity": "Bergantung pada ruang lingkup",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Change & Organizational Agility",
      "serviceBrand": "BinaLab",
      "tagline": "Bangun Organisasi yang Mampu Beradaptasi."
    }
  },
  {
    "code": "SS-20",
    "product": "signature-organization",
    "position": 20,
    "id": {
      "name": "Leadership Academy",
      "summary": "Bangun Pemimpin di Setiap Level.",
      "tagline": "Bangun Pemimpin di Setiap Level.",
      "learningObjectives": [
        "Menilai kekuatan kepemimpinan dan prioritas pengembangan terhadap ekspektasi peran",
        "Menerapkan praktik kepemimpinan orang dalam penetapan arah, delegasi, umpan balik, dan akuntabilitas",
        "Menghubungkan keputusan tim dan pengembangan kapabilitas dengan prioritas organisasi jangka panjang, dengan mempertimbangkan tren dan implikasi jangka panjang",
        "Mempraktikkan perilaku kepemimpinan melalui penugasan penerapan, umpan balik, dan tinjauan"
      ],
      "contentOutline": [
        "Pola pikir kepemimpinan dan kerangka kapabilitas",
        "Kepemimpinan orang dan kinerja",
        "Strategic thinking dan pengambilan keputusan",
        "Memimpin perubahan dan memengaruhi",
        "Praktik, refleksi, umpan balik, dan penerapan"
      ],
      "outputs": [
        "Peta jalan pengembangan kapabilitas kepemimpinan.",
        "Proyek atau praktik kepemimpinan terapan.",
        "Wawasan kemajuan dan rekomendasi pengembangan."
      ],
      "bestFor": "Organisasi yang mengembangkan supervisor, manajer, senior manajer, dan pemimpin",
      "duration": "3–6 bulan, dapat dikonfigurasi",
      "capacity": "Bergantung pada ruang lingkup",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Leadership Academy",
      "serviceBrand": "BinaLab",
      "tagline": "Bangun Pemimpin di Setiap Level."
    }
  },
  {
    "code": "SS-21",
    "product": "signature-organization",
    "position": 21,
    "id": {
      "name": "Future Leaders",
      "summary": "Siapkan Talenta Hari Ini untuk Kepemimpinan Esok.",
      "tagline": "Siapkan Talenta Hari Ini untuk Kepemimpinan Esok.",
      "learningObjectives": [
        "Menafsirkan tren bisnis dan organisasi yang dapat membentuk prioritas masa depan",
        "Menghubungkan pilihan strategis dengan penciptaan nilai, sumber daya, pemangku kepentingan, dan implikasi jangka panjang",
        "Merumuskan dan mengomunikasikan rekomendasi yang beralasan berdasarkan bukti dan asumsi",
        "Menyusun rencana pengembangan pribadi dan mencari peluang menantang (stretch) yang mempersiapkan tanggung jawab kepemimpinan yang lebih luas"
      ],
      "contentOutline": [
        "Ekspektasi kepemimpinan masa depan",
        "Strategic thinking dan perspektif bisnis",
        "Paparan kepemimpinan dan pengaruh",
        "Kesadaran diri, pengembangan, dan pertumbuhan karier",
        "Praktik kepemimpinan terapan"
      ],
      "outputs": [
        "Prioritas pengembangan individu.",
        "Rencana aksi kesiapan kepemimpinan.",
        "Proyek terapan, refleksi, dan bukti pengembangan."
      ],
      "bestFor": "Karyawan potensi tinggi (high-potential), pemimpin yang sedang berkembang, dan kandidat jalur suksesi kepemimpinan (leadership pipeline)",
      "duration": "3–6 bulan, dapat dikonfigurasi",
      "capacity": "Bergantung pada ruang lingkup",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Future Leaders",
      "serviceBrand": "BinaLab",
      "tagline": "Siapkan Talenta Hari Ini untuk Kepemimpinan Esok."
    }
  },
  {
    "code": "SS-22",
    "product": "signature-organization",
    "position": 22,
    "id": {
      "name": "Internal Trainer & Facilitator Academy",
      "summary": "Bangun Kapabilitas Pembelajaran Internal.",
      "tagline": "Bangun Kapabilitas Pembelajaran Internal.",
      "learningObjectives": [
        "Mendiagnosis kebutuhan peserta belajar dan bisnis serta merumuskan hasil belajar yang terukur",
        "Merancang urutan pembelajaran yang logis dengan latihan, aktivitas, dan asesmen yang sesuai",
        "Memfasilitasi pembelajaran orang dewasa dengan presentasi, pertanyaan, dan pelibatan peserta yang jelas",
        "Menilai bukti pembelajaran, memberikan umpan balik konstruktif, dan memperbaiki penyampaian melalui refleksi dan latihan"
      ],
      "contentOutline": [
        "Prinsip pembelajaran orang dewasa (adult learning)",
        "Desain pelatihan dan modul",
        "Keterampilan fasilitasi dan presentasi",
        "Metode pembelajaran dan pelibatan peserta",
        "Asesmen, umpan balik, latihan, dan peningkatan kemampuan trainer",
        "Train-the-Trainer (TTT) merupakan kurikulum",
        "Jalur inti"
      ],
      "outputs": [
        "Peserta dapat merancang dan memfasilitasi sesi pembelajaran internal.",
        "Latihan trainer/fasilitator dengan umpan balik terstruktur.",
        "Rencana perbaikan pribadi dan standar trainer internal."
      ],
      "bestFor": "Trainer internal, subject-matter expert, fasilitator, dan tim HR/L&D",
      "duration": "2–5 hari + tindak lanjut opsional 1–3 bulan",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Internal Trainer & Facilitator Academy",
      "serviceBrand": "BinaLab",
      "tagline": "Bangun Kapabilitas Pembelajaran Internal."
    }
  },
  {
    "code": "SS-23",
    "product": "signature-organization",
    "position": 23,
    "id": {
      "name": "Performance Acceleration",
      "summary": "Hubungkan Kapabilitas Orang dengan Kinerja Bisnis.",
      "tagline": "Hubungkan Kapabilitas Orang dengan Kinerja Bisnis.",
      "learningObjectives": [
        "Menerjemahkan prioritas bisnis menjadi hasil kinerja dan ukuran yang jelas",
        "Mengidentifikasi kesenjangan kinerja berdasarkan bukti dan menganalisis penyebab yang berkontribusi",
        "Memprioritaskan tindakan perbaikan, penanggung jawab, jadwal, dan sumber daya yang dibutuhkan",
        "Meninjau hasil terhadap target dan menyesuaikan tindakan untuk menjaga peningkatan kinerja"
      ],
      "contentOutline": [
        "Penyelarasan dan prioritas kinerja",
        "Keterkaitan kapabilitas dan kinerja",
        "Disiplin eksekusi dan akuntabilitas",
        "Praktik perbaikan kinerja",
        "Tindakan, tinjauan, dan penguatan"
      ],
      "outputs": [
        "Wawasan kesenjangan kinerja dan kapabilitas.",
        "Tindakan perbaikan kinerja prioritas.",
        "Rencana aksi yang menghubungkan pengembangan orang dengan hasil bisnis."
      ],
      "bestFor": "Organisasi, unit bisnis, tim, dan fungsi dengan prioritas kinerja yang jelas",
      "duration": "3–6 bulan, dapat dikonfigurasi",
      "capacity": "Bergantung pada ruang lingkup",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Performance Acceleration",
      "serviceBrand": "BinaLab",
      "tagline": "Hubungkan Kapabilitas Orang dengan Kinerja Bisnis."
    }
  },
  {
    "code": "SS-24",
    "product": "signature-organization",
    "position": 24,
    "id": {
      "name": "AI-Ready Organization",
      "summary": "Siapkan Orang untuk Tempat Kerja Berbasis AI.",
      "tagline": "Siapkan Orang untuk Tempat Kerja Berbasis AI.",
      "learningObjectives": [
        "Menilai peluang, kesiapan, kendala, dan kesenjangan kapabilitas AI organisasi",
        "Memprioritaskan kasus penggunaan (use case) berdasarkan nilai, kelayakan, kesiapan data, dan risiko",
        "Merumuskan praktik adopsi yang bertanggung jawab, pertimbangan tata kelola, dan akuntabilitas manusia",
        "Merencanakan pembangunan kapabilitas tenaga kerja dan adopsi perubahan untuk alur kerja yang dirancang ulang"
      ],
      "contentOutline": [
        "Kesiapan dan adopsi AI",
        "Kolaborasi manusia–AI",
        "Kesadaran AI yang bertanggung jawab dan tata kelola",
        "Perancangan ulang pekerjaan dan peluang alur kerja",
        "Pembangunan kapabilitas dan adopsi perubahan"
      ],
      "outputs": [
        "Wawasan kesiapan AI dan area prioritas.",
        "Peta jalan adopsi/use case yang praktis.",
        "Tindakan kapabilitas dan perubahan untuk tempat kerja berbasis AI."
      ],
      "bestFor": "Organisasi yang merencanakan atau memperluas adopsi AI dan cara kerja berbasis AI",
      "duration": "3–6 bulan, dapat dikonfigurasi",
      "capacity": "Bergantung pada ruang lingkup",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "AI-Ready Organization",
      "serviceBrand": "BinaLab",
      "tagline": "Siapkan Orang untuk Tempat Kerja Berbasis AI."
    }
  },
  {
    "code": "SS-25",
    "product": "signature-organization",
    "position": 25,
    "id": {
      "name": "Future-Ready Organization",
      "summary": "Bangun Kapabilitas untuk Apa yang Akan Datang.",
      "tagline": "Bangun Kapabilitas untuk Apa yang Akan Datang.",
      "learningObjectives": [
        "Mengidentifikasi tren eksternal dan kesenjangan kapabilitas internal yang dapat memengaruhi kinerja masa depan",
        "Mengembangkan skenario yang masuk akal dan menilai implikasinya terhadap strategi dan kapabilitas tenaga kerja",
        "Memprioritaskan investasi kapabilitas dan jalur pembelajaran yang terkait dengan kebutuhan organisasi di masa depan",
        "Menetapkan sinyal dan titik tinjauan untuk menyesuaikan rencana seiring perubahan asumsi dan kondisi"
      ],
      "contentOutline": [
        "Kesiapan masa depan dan strategi kapabilitas",
        "Kapabilitas tenaga kerja dan keterampilan kritis",
        "Adaptabilitas dan budaya belajar",
        "Kesiapan strategis dan berpikir skenario",
        "Prioritas kapabilitas dan jalur pengembangan"
      ],
      "outputs": [
        "Prioritas kapabilitas masa depan dan wawasan kesenjangan.",
        "Peta jalan kapabilitas strategis.",
        "Rekomendasi tindakan pengembangan dan transformasi."
      ],
      "bestFor": "Organisasi yang bersiap menghadapi pergeseran strategis, kesenjangan kapabilitas, atau kebutuhan tenaga kerja masa depan",
      "duration": "3–12 bulan, dapat dikonfigurasi",
      "capacity": "Bergantung pada ruang lingkup",
      "serviceBrand": "BinaLab"
    },
    "en": {
      "name": "Future-Ready Organization",
      "serviceBrand": "BinaLab",
      "tagline": "Bangun Kapabilitas untuk Apa yang Akan Datang."
    }
  },
  {
    "code": "SS-26",
    "product": "signature-organization",
    "position": 26,
    "id": {
      "name": "Impact Measurement & Transformation Review",
      "summary": "Ukur. Belajar. Perbaiki. Tunjukkan Dampak.",
      "tagline": "Ukur. Belajar. Perbaiki. Tunjukkan Dampak.",
      "learningObjectives": [
        "Menetapkan ukuran keberhasilan dan kebutuhan bukti yang terkait dengan tujuan transformasi",
        "Menilai kemajuan dan hasil menggunakan data yang andal, pemeriksaan sumber, dan kriteria yang transparan",
        "Membedakan bukti yang teramati dari asumsi serta mengidentifikasi kesenjangan antara hasil yang dimaksud dan hasil aktual",
        "Memprioritaskan rekomendasi, penanggung jawab, dan ukuran tindak lanjut untuk meningkatkan dampak dan akuntabilitas"
      ],
      "contentOutline": [
        "Tinjauan tujuan, intervensi, dan bukti",
        "Asesmen dan audit",
        "Tinjauan terstruktur",
        "Diagnosis kesenjangan, kekuatan, dan inkonsistensi",
        "Prioritisasi tindakan berikutnya",
        "Pembelajaran dan rekomendasi"
      ],
      "outputs": [
        "Transformation Health Map: ● Mapan / Sesuai; ● Sebagian / Belum Konsisten; ● Perlu Perhatian.",
        "Area prioritas dan wawasan berbasis bukti.",
        "Rekomendasi tindakan dan intervensi berikutnya.",
        "Diskusi tinjauan dan langkah lanjutan yang disepakati."
      ],
      "bestFor": "Organisasi yang telah menyelesaikan atau sedang menjalankan inisiatif transformasi, pembelajaran, budaya, kepemimpinan, atau kapabilitas",
      "duration": "1–2 hari + tindak lanjut opsional 1–3 bulan",
      "capacity": "Bergantung pada ruang lingkup",
      "serviceBrand": "BinaLab",
      "notes": "Warna status adalah alat komunikasi, bukan skor generik atau sertifikasi; kriteria disepakati dengan klien dan dikaitkan dengan tujuan."
    },
    "en": {
      "name": "Impact Measurement & Transformation Review",
      "serviceBrand": "BinaLab",
      "tagline": "Ukur. Belajar. Perbaiki. Tunjukkan Dampak."
    }
  },
  {
    "code": "SS-27",
    "product": "signature-specialized",
    "position": 27,
    "id": {
      "name": "Spiritual Leadership Journey",
      "summary": "Elevating Leadership, Beyond the Limit.",
      "tagline": "Elevating Leadership, Beyond the Limit.",
      "learningObjectives": [
        "Menggunakan refleksi terstruktur untuk mengidentifikasi pola kepemimpinan, nilai, kekuatan, dan kebutuhan pengembangan",
        "Memperjelas niat, tujuan transformasi diri, dan komitmen perilaku sebelum perjalanan Umrah",
        "Memanfaatkan pengalaman Umrah sebagai ruang muhasabah, pembaruan perspektif, dan penguatan komitmen pribadi",
        "Menerjemahkan wawasan perjalanan menjadi sasaran, kebiasaan, dan tindakan transformasi diri selama 90 hari setelah Umrah",
        "Meninjau kemajuan dan menjaga konsistensi praktik setelah kembali ke rutinitas kerja"
      ],
      "contentOutline": [
        "Persiapan perjalanan: niat, refleksi diri, dan tujuan pengembangan",
        "Umrah sebagai pengalaman spiritual yang terintegrasi dengan proses self-transformation",
        "Muhasabah — refleksi dan kesadaran diri",
        "Niyyah — tujuan dan niat",
        "Mujahadah — upaya disiplin dan praktik perubahan",
        "Istiqamah — konsistensi dan kebiasaan berkelanjutan",
        "90-day post-Umrah transformation journey, refleksi berkala, dan Personal Transformation Project"
      ],
      "outputs": [
        "Perjalanan transformasi pribadi 90 hari yang terstruktur.",
        "Refleksi pribadi dan komitmen kepemimpinan.",
        "Personal Transformation Project.",
        "Rencana praktik berkelanjutan setelah journey."
      ],
      "bestFor": "Pemimpin, profesional Muslim, dan organisasi berbasis Syariah",
      "duration": "Tetap 90 hari",
      "capacity": "Dapat dikonfigurasi / bergantung pada ruang lingkup",
      "serviceBrand": "BinaJourney",
      "notes": "Program mengintegrasikan persiapan Umrah, pengalaman spiritual, dan praktik transformasi diri selama 90 hari setelah perjalanan."
    },
    "en": {
      "name": "Spiritual Leadership Journey",
      "serviceBrand": "BinaJourney",
      "tagline": "Elevating Leadership, Beyond the Limit."
    }
  },
  {
    "code": "SS-28",
    "product": "signature-specialized",
    "position": 28,
    "id": {
      "name": "Influence & Inspire",
      "summary": "Build Credibility. Move Ideas. Inspire Action.",
      "tagline": "Build Credibility. Move Ideas. Inspire Action.",
      "learningObjectives": [
        "Menyusun pesan yang mempertimbangkan kebutuhan audiens",
        "Membangun argumen dan rekomendasi yang didukung alasan",
        "Memengaruhi pemangku kepentingan secara etis",
        "Menghubungkan tujuan bersama dengan tindakan yang membangkitkan keterlibatan"
      ],
      "contentOutline": [
        "Pemetaan pemangku kepentingan",
        "Pesan inti dan framing",
        "Persuasi berbasis bukti",
        "Keberatan dan negosiasi awal",
        "Komunikasi kredibel",
        "Storytelling profesional tanpa manipulasi",
        "Mengubah aspirasi menjadi ajakan bertindak"
      ],
      "outputs": [
        "stakeholder message map, rekomendasi/pitch singkat, dan rencana pengaruh yang etis."
      ],
      "duration": "1 hari",
      "capacity": "hingga 30 peserta",
      "serviceBrand": "BinaLab",
      "engagementFormat": "Training / Workshop"
    },
    "en": {
      "name": "Influence & Inspire",
      "serviceBrand": "BinaLab",
      "tagline": "Build Credibility. Move Ideas. Inspire Action.",
      "summary": "Build credibility and influence stakeholders ethically.",
      "learningObjectives": [
        "Adapt the message to the audience.",
        "Build an evidence-based recommendation.",
        "Address objections ethically.",
        "Connect shared goals to action."
      ],
      "contentOutline": [
        "Stakeholder mapping",
        "Message framing",
        "Evidence-based persuasion",
        "Handling objections",
        "Professional storytelling"
      ],
      "outputs": [
        "A stakeholder message map, short pitch and ethical influence plan."
      ],
      "duration": "1 day",
      "capacity": "Up to 30 participants",
      "engagementFormat": "Training / workshop"
    }
  },
  {
    "code": "SS-29",
    "product": "signature-specialized",
    "position": 29,
    "id": {
      "name": "Meeting Excellence & Facilitation",
      "summary": "Make Meetings Clear, Inclusive, and Action-Oriented.",
      "tagline": "Make Meetings Clear, Inclusive, and Action-Oriented.",
      "learningObjectives": [
        "Menetapkan tujuan dan hasil rapat",
        "Merancang agenda dan alokasi waktu",
        "Memfasilitasi diskusi serta partisipasi yang seimbang",
        "Mengelola penyimpangan diskusi dan perbedaan pendapat",
        "Mendokumentasikan keputusan, penanggung jawab, tenggat, dan tindak lanjut"
      ],
      "contentOutline": [
        "Desain rapat",
        "Agenda dan keputusan yang dibutuhkan",
        "Fasilitasi diskusi",
        "Inklusi suara peserta",
        "Pengelolaan waktu dan konflik",
        "Pencatatan keputusan",
        "Action log dan follow-through",
        "Rapat hybrid / digital"
      ],
      "outputs": [
        "template agenda, fasilitasi simulasi rapat, decision log, dan action tracker."
      ],
      "duration": "1 hari",
      "capacity": "hingga 30 peserta",
      "serviceBrand": "BinaLab",
      "engagementFormat": "Training / Workshop"
    },
    "en": {
      "name": "Meeting Excellence & Facilitation",
      "serviceBrand": "BinaLab",
      "tagline": "Make Meetings Clear, Inclusive, and Action-Oriented.",
      "summary": "Design productive meetings and turn decisions into follow-up.",
      "learningObjectives": [
        "Define outcomes and the agenda.",
        "Facilitate inclusive discussion.",
        "Manage time and disagreement.",
        "Record decisions, owners and deadlines."
      ],
      "contentOutline": [
        "Meeting design",
        "Discussion facilitation",
        "Inclusion",
        "Time and conflict management",
        "Decision and action logs",
        "Hybrid meetings"
      ],
      "outputs": [
        "Agenda template, facilitated meeting simulation, decision log and action tracker."
      ],
      "duration": "1 day",
      "capacity": "Up to 30 participants",
      "engagementFormat": "Training / workshop"
    }
  },
  {
    "code": "SS-30",
    "product": "signature-specialized",
    "position": 30,
    "id": {
      "name": "Initiative & Resilience at Work",
      "summary": "Take Ownership. Learn from Setbacks. Keep Moving.",
      "tagline": "Take Ownership. Learn from Setbacks. Keep Moving.",
      "learningObjectives": [
        "Mengenali masalah dan peluang lebih awal",
        "Mengambil langkah yang sesuai tanggung jawab tanpa menunggu instruksi",
        "Mencoba pendekatan alternatif saat menghadapi hambatan",
        "Mengambil pelajaran dari kemunduran",
        "Memulihkan momentum secara konstruktif"
      ],
      "contentOutline": [
        "Ownership dan inisiatif",
        "Batas kewenangan",
        "Action bias yang bertanggung jawab",
        "Ketekunan dan strategi alternatif",
        "Refleksi kegagalan",
        "Pemulihan momentum",
        "Rencana eksperimen perbaikan di tempat kerja"
      ],
      "outputs": [
        "personal initiative plan, setback reflection, dan eksperimen tindakan 30 hari."
      ],
      "duration": "1 hari",
      "capacity": "hingga 30 peserta",
      "serviceBrand": "BinaLab",
      "engagementFormat": "Training / Workshop"
    },
    "en": {
      "name": "Initiative & Resilience at Work",
      "serviceBrand": "BinaLab",
      "tagline": "Take Ownership. Learn from Setbacks. Keep Moving.",
      "summary": "Build initiative and respond constructively to setbacks.",
      "learningObjectives": [
        "Spot problems and opportunities early.",
        "Act within your responsibilities.",
        "Try alternatives and learn from setbacks.",
        "Regain momentum constructively."
      ],
      "contentOutline": [
        "Ownership and initiative",
        "Limits of authority",
        "Responsible action",
        "Alternative approaches",
        "Reflection and workplace experiments"
      ],
      "outputs": [
        "A personal initiative plan, setback reflection and 30-day action experiment."
      ],
      "duration": "1 day",
      "capacity": "Up to 30 participants",
      "engagementFormat": "Training / workshop"
    }
  },
  {
    "code": "SS-31",
    "product": "signature-specialized",
    "position": 31,
    "id": {
      "name": "Risk Intelligence & Management",
      "summary": "Anticipate Risk. Make Informed Choices. Protect Outcomes.",
      "tagline": "Anticipate Risk. Make Informed Choices. Protect Outcomes.",
      "learningObjectives": [
        "Mengidentifikasi risiko yang dapat menghambat tujuan",
        "Menilai kemungkinan dan dampak",
        "Memprioritaskan risiko",
        "Menetapkan mitigasi, pemilik risiko, dan rencana kontingensi",
        "Memutuskan kapan risiko dapat diterima, perlu dimitigasi, atau harus dieskalasikan"
      ],
      "contentOutline": [
        "Risk identification",
        "Likelihood-impact assessment",
        "Risk appetite dan toleransi",
        "Risk register",
        "Mitigasi dan kontingensi",
        "Indikator risiko",
        "Monitoring dan eskalasi",
        "Perbedaan risk management dengan risk taking"
      ],
      "outputs": [
        "risk register sederhana, risk-priority map, dan rencana mitigasi dengan penanggung jawab."
      ],
      "duration": "1 hari",
      "capacity": "hingga 30 peserta",
      "serviceBrand": "BinaLab",
      "engagementFormat": "Workshop / Applied Lab"
    },
    "en": {
      "name": "Risk Intelligence & Management",
      "serviceBrand": "BinaLab",
      "tagline": "Anticipate Risk. Make Informed Choices. Protect Outcomes.",
      "summary": "Identify, prioritize and respond to risks affecting your objectives.",
      "learningObjectives": [
        "Assess the likelihood and impact of risks.",
        "Set mitigation, owners and contingency plans.",
        "Decide when to accept, mitigate or escalate."
      ],
      "contentOutline": [
        "Risk identification",
        "Likelihood and impact",
        "Risk appetite and tolerance",
        "Risk register",
        "Contingency planning, monitoring and escalation"
      ],
      "outputs": [
        "A simple risk register, priority map and mitigation plan with owners."
      ],
      "duration": "1 day",
      "capacity": "Up to 30 participants",
      "engagementFormat": "Workshop / applied lab"
    }
  },
  {
    "code": "SS-32",
    "product": "signature-specialized",
    "position": 32,
    "id": {
      "name": "Self-Development & Individual Development Planning",
      "summary": "Prioritize What Matters. Learn Deliberately. Apply at Work.",
      "tagline": "Prioritize What Matters. Learn Deliberately. Apply at Work.",
      "learningObjectives": [
        "Mengidentifikasi 1–2 kebutuhan belajar prioritas dari tuntutan peran, sasaran kinerja, refleksi pribadi, dan umpan balik yang relevan, tanpa menyamakan skor asesmen dengan kesenjangan objektif.",
        "Memilih fokus materi belajar menggunakan kriteria dampak terhadap pekerjaan, urgensi, relevansi peran, dan kesiapan untuk diterapkan",
        "Merumuskan sasaran belajar yang spesifik dan dapat diuji.",
        "Memilih kombinasi metode belajar yang sesuai, termasuk praktik kerja/proyek, mentoring atau feedback, diskusi sejawat, dan sumber belajar terstruktur",
        "Menilai kredibilitas serta kegunaan sumber.",
        "Merancang penerapan hasil belajar dalam tugas nyata melalui eksperimen terukur, umpan balik, pencatatan bukti, dan refleksi berkala.",
        "Menyusun Individual Development Plan (IDP) 90 hari dengan prioritas kompetensi, materi, metode, aktivitas aplikasi, indikator bukti, kebutuhan dukungan, dan checkpoint 30/60/90 hari."
      ],
      "contentOutline": [
        "Learning diagnosis: refleksi kekuatan dan area pengembangan, bukti perilaku, umpan balik, dan tuntutan peran.",
        "Learning Priority Matrix: impact × relevance × urgency × feasibility",
        "Pemilihan 1–2 fokus utama dan batas cakupan materi.",
        "Learning design: rumusan hasil belajar, pemilihan sumber yang kredibel, kurasi topik, alokasi waktu, dan kecocokan metode.",
        "Metode pembelajaran terapan: action learning, stretch assignment, shadowing, peer learning, mentoring/feedback, kelas, dan microlearning sesuai konteks.",
        "Transfer of learning: tugas praktik, eksperimen perilaku, jurnal refleksi, bukti hasil, umpan balik, dan penyesuaian strategi.",
        "IDP clinic: pengisian template IDP, peer review, komitmen dukungan atasan, serta checkpoint 30/60/90 hari."
      ],
      "outputs": [
        "Learning Priority Canvas berisi 1–2 fokus belajar, alasan prioritas, dan sasaran kompetensi yang relevan dengan pekerjaan.",
        "Individual Development Plan (IDP) 90 hari yang telah diisi peserta: fokus, tujuan, materi, metode, aktivitas penerapan, bukti keberhasilan, timeline, dukungan, dan review 30/60/90 hari.",
        "Satu rencana praktik kerja/learning experiment yang dapat langsung dimulai serta jadwal feedback dengan atasan atau mentor."
      ],
      "bestFor": "Profesional, kontributor individu, supervisor, manajer, dan peserta talent development yang ingin mengelola pembelajaran mandiri secara terarah.",
      "duration": "1 hari",
      "capacity": "hingga 30 peserta",
      "serviceBrand": "BinaLab",
      "engagementFormat": " Workshop + IDP Clinic",
      "notes": "Pendampingan 30/60/90 hari bersifat layanan tambahan sesuai lingkup. IDP adalah rencana pengembangan, bukan bukti otomatis terjadinya peningkatan kompetensi. Template IDP editable tersedia sebagai file pendamping."
    },
    "en": {
      "name": "Self-Development & Individual Development Planning",
      "serviceBrand": "BinaLab",
      "tagline": "Prioritize What Matters. Learn Deliberately. Apply at Work.",
      "summary": "Turn learning priorities into a practical individual development plan.",
      "learningObjectives": [
        "Identify one or two learning priorities from role needs, evidence and feedback.",
        "Set testable learning objectives and choose suitable sources and methods.",
        "Plan a workplace experiment and a 90-day IDP with 30/60/90-day checkpoints."
      ],
      "contentOutline": [
        "Learning diagnosis",
        "Learning Priority Matrix",
        "Learning design and source selection",
        "Applied learning and transfer",
        "IDP clinic and peer review"
      ],
      "outputs": [
        "Learning Priority Canvas, a completed 90-day IDP and a workplace experiment with a feedback schedule."
      ],
      "duration": "1 day",
      "capacity": "Up to 30 participants",
      "bestFor": "Professionals, individual contributors, supervisors, managers and talent development participants",
      "engagementFormat": "Workshop and IDP clinic"
    }
  }
]
$programs$::jsonb) as src(code text, product text, position integer, id jsonb, en jsonb);

do $$
begin
  if (select count(*) from public.catalog_products
      where product_key in ('signature-self','signature-team','signature-organization','signature-specialized')
      and status='ready' and public_visible) <> 4 then
    raise exception 'Publish the existing Signature Solutions categories first';
  end if;
  if (select count(*) from public.catalog_modules m
      join signature_public_copy_32 src on src.code=m.module_code
      where src.position<=27 and not m.is_mock and m.active and m.public_visible and m.readiness_status='ready') <> 27 then
    raise exception 'Verify the 27 existing public Signature Solutions before updating';
  end if;
  if exists (select 1 from public.catalog_modules m
      join signature_public_copy_32 src on src.code=m.module_code
      where src.position>27 and m.catalog_version<>'signature-2026-ss32-public') then
    raise exception 'A new Signature Solutions code already belongs to another module';
  end if;
end $$;

insert into public.catalog_modules (
  product_id, module_code, slug, name, description, standard_scope, deliverables, duration_label,
  pricing_unit, base_price, minimum_quantity, currency, readiness_status, is_mock, active, public_visible,
  featured, display_order, catalog_version, metadata, published_at
)
select p.id, src.code, lower(src.code), src.id->>'name', src.id->>'summary',
  (select string_agg(value,E'\n') from jsonb_array_elements_text(src.id->'contentOutline')),
  (select string_agg(value,E'\n') from jsonb_array_elements_text(src.id->'outputs')),
  src.id->>'duration', 'custom', 0, 1, 'IDR', 'ready', false, true, true,
  false, src.position, 'signature-2026-ss32-public',
  jsonb_build_object('commercialModel','custom_scope','requiresHumanCommercialReview',true),
  now()
from signature_public_copy_32 src join public.catalog_products p on p.product_key=src.product
where src.position>27
on conflict (module_code) do nothing;

update public.catalog_modules as m
set metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object(
  'publicCatalogRevision','signature-2026-ss32',
  'publicCatalog',jsonb_build_object(
    'id', src.id,
    'en', coalesce(m.metadata->'localized'->'en','{}'::jsonb) || src.en
  ))
from signature_public_copy_32 src
where m.module_code=src.code and not m.is_mock;

commit;
