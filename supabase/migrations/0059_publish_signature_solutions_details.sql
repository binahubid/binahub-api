-- CEO Signature Solutions Detailed Product & Commercial Catalog 2026.
-- Publish the 27 catalog entries after loading the CEO's complete non-commercial text.
-- Existing base_price, pricing_unit and metadata.commercial are retained for internal proposals.
-- Deploy the updated public API and website before running this migration in production.
begin;

do $validate$
begin
  if (select count(*) from public.catalog_modules
      where module_code ~ '^SS-[0-9]{2}$'
        and catalog_version = 'signature-2026-ceo-v1'
        and is_mock = false) <> 27 then
    raise exception 'Expected all 27 Signature Solutions from migration 0057 before publishing';
  end if;
end
$validate$;

with source as (
  select * from jsonb_to_recordset($catalog$[
  {
    "code": "SS-01",
    "name": "Emotional Intelligence",
    "public_content": {
      "tagline": "Understand Yourself. Connect Better.",
      "learningObjectives": [
        "Build self-awareness and recognize personal patterns.",
        "Strengthen self-management and emotional regulation.",
        "Develop social awareness, empathy, and relationship management.",
        "Improve interpersonal effectiveness in professional situations."
      ],
      "contentOutline": [
        "Understanding self-awareness, emotions, triggers, and behavioral patterns.",
        "Self-management and self-regulation in challenging situations.",
        "Reading social cues and understanding other perspectives.",
        "Empathy and relationship management.",
        "Application to communication, collaboration, conflict, and leadership."
      ],
      "outputs": [
        "Participants identify key personal patterns and development areas.",
        "Participants have practical strategies for managing emotional responses.",
        "Participants improve perspective-taking and interpersonal responses.",
        "Individual or team development actions are identified."
      ],
      "bestFor": "Professionals, managers, leaders, and teams",
      "engagementFormat": "Experience / Program",
      "duration": "1 day standard; configurable to 2 days",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaInsights / BinaLab",
      "notes": "Assessment such as DISC or other behavioral/personality tools may be used where relevant."
    },
    "public_content_id": {
      "tagline": "Kenali Diri. Bangun Hubungan yang Lebih Baik.",
      "learningObjectives": [
        "Membangun kesadaran diri dan mengenali pola pribadi.",
        "Memperkuat pengelolaan diri dan regulasi emosi.",
        "Mengembangkan kepekaan sosial, empati, dan kemampuan mengelola hubungan.",
        "Meningkatkan efektivitas hubungan interpersonal dalam situasi profesional."
      ],
      "contentOutline": [
        "Memahami kesadaran diri, emosi, pemicu, dan pola perilaku.",
        "Pengelolaan diri dan regulasi emosi dalam situasi menantang.",
        "Membaca isyarat sosial dan memahami sudut pandang orang lain.",
        "Empati dan pengelolaan hubungan.",
        "Penerapan dalam komunikasi, kolaborasi, konflik, dan kepemimpinan."
      ],
      "outputs": [
        "Peserta mengenali pola pribadi utama dan area pengembangan.",
        "Peserta memiliki strategi praktis untuk mengelola respons emosi.",
        "Peserta meningkatkan kemampuan melihat sudut pandang lain dan merespons secara interpersonal.",
        "Tindakan pengembangan individu atau tim teridentifikasi."
      ],
      "bestFor": "Profesional, manajer, pemimpin, dan tim",
      "engagementFormat": "Pengalaman / Program",
      "duration": "Standar 1 hari; dapat disesuaikan menjadi 2 hari",
      "capacity": "Hingga 30 peserta",
      "notes": "Asesmen seperti DISC atau alat perilaku/kepribadian lainnya dapat digunakan jika relevan.",
      "serviceBrand": "BinaInsights / BinaLab"
    }
  },
  {
    "code": "SS-02",
    "name": "Professional Excellence",
    "public_content": {
      "tagline": "The Mindset & Behaviors Behind Professional Impact.",
      "learningObjectives": [
        "Strengthen professional mindset and ownership.",
        "Build accountability and dependable work behaviors.",
        "Develop an excellence mindset in day-to-day execution.",
        "Translate professional standards into observable behaviors."
      ],
      "contentOutline": [
        "Professional mindset and attitude.",
        "Ownership, accountability, and reliability.",
        "Professional behaviors and workplace standards.",
        "Excellence mindset and continuous self-improvement.",
        "Application to work habits, collaboration, and delivery."
      ],
      "outputs": [
        "Participants understand the behaviors associated with professional impact.",
        "Clear personal commitments for stronger ownership and accountability.",
        "Practical behavior changes that can be applied immediately at work."
      ],
      "bestFor": "Professionals, staff, supervisors, and managers",
      "engagementFormat": "Program",
      "duration": "1 day standard; configurable to 2 days",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaAcademy / BinaLab"
    },
    "public_content_id": {
      "tagline": "Pola Pikir dan Perilaku di Balik Dampak Profesional.",
      "learningObjectives": [
        "Memperkuat pola pikir profesional dan rasa memiliki terhadap pekerjaan.",
        "Membangun akuntabilitas dan perilaku kerja yang dapat diandalkan.",
        "Mengembangkan pola pikir unggul dalam pelaksanaan kerja sehari-hari.",
        "Menerjemahkan standar profesional menjadi perilaku yang dapat diamati."
      ],
      "contentOutline": [
        "Pola pikir dan sikap profesional.",
        "Rasa memiliki, akuntabilitas, dan keandalan.",
        "Perilaku profesional dan standar di tempat kerja.",
        "Pola pikir unggul dan perbaikan diri berkelanjutan.",
        "Penerapan pada kebiasaan kerja, kolaborasi, dan penyelesaian tugas."
      ],
      "outputs": [
        "Peserta memahami perilaku yang terkait dengan dampak profesional.",
        "Komitmen pribadi yang jelas untuk memperkuat rasa memiliki dan akuntabilitas.",
        "Perubahan perilaku praktis yang dapat langsung diterapkan di tempat kerja."
      ],
      "bestFor": "Profesional, staf, supervisor, dan manajer",
      "engagementFormat": "Program",
      "duration": "Standar 1 hari; dapat disesuaikan menjadi 2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaAcademy / BinaLab"
    }
  },
  {
    "code": "SS-03",
    "name": "Personal Productivity & Effectiveness",
    "public_content": {
      "tagline": "Work Better. Focus Better. Achieve More.",
      "learningObjectives": [
        "Improve prioritization and focus.",
        "Strengthen time and execution discipline.",
        "Build sustainable productivity habits.",
        "Increase effectiveness without simply increasing activity."
      ],
      "contentOutline": [
        "Prioritization and focus management.",
        "Time and attention management.",
        "Execution discipline and follow-through.",
        "Habit formation and personal work systems.",
        "Managing workload, interruptions, and competing priorities."
      ],
      "outputs": [
        "Participants establish clearer priorities and execution routines.",
        "A practical personal productivity system or action plan.",
        "Specific habits and commitments to improve work effectiveness."
      ],
      "bestFor": "Professionals, managers, and individual contributors",
      "engagementFormat": "Experience / Program",
      "duration": "1 day standard; configurable to 2 days",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaAcademy / BinaLab"
    },
    "public_content_id": {
      "tagline": "Bekerja Lebih Baik. Lebih Fokus. Mencapai Lebih Banyak.",
      "learningObjectives": [
        "Meningkatkan kemampuan menentukan prioritas dan menjaga fokus.",
        "Memperkuat disiplin waktu dan pelaksanaan.",
        "Membangun kebiasaan produktif yang berkelanjutan.",
        "Meningkatkan efektivitas tanpa sekadar menambah aktivitas."
      ],
      "contentOutline": [
        "Pengelolaan prioritas dan fokus.",
        "Pengelolaan waktu dan perhatian.",
        "Disiplin pelaksanaan dan tindak lanjut.",
        "Pembentukan kebiasaan dan sistem kerja pribadi.",
        "Mengelola beban kerja, gangguan, dan prioritas yang saling bersaing."
      ],
      "outputs": [
        "Peserta menetapkan prioritas dan rutinitas pelaksanaan yang lebih jelas.",
        "Sistem produktivitas pribadi atau rencana tindakan yang praktis.",
        "Kebiasaan dan komitmen spesifik untuk meningkatkan efektivitas kerja."
      ],
      "bestFor": "Profesional, manajer, dan kontributor individu",
      "engagementFormat": "Pengalaman / Program",
      "duration": "Standar 1 hari; dapat disesuaikan menjadi 2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaAcademy / BinaLab"
    }
  },
  {
    "code": "SS-04",
    "name": "Communication & Presentation",
    "public_content": {
      "tagline": "Communicate Clearly. Influence Effectively.",
      "learningObjectives": [
        "Communicate ideas clearly and confidently.",
        "Improve interpersonal and workplace communication.",
        "Deliver effective presentations and messages.",
        "Strengthen influencing through clear, audience-centered communication."
      ],
      "contentOutline": [
        "Communication fundamentals and message clarity.",
        "Interpersonal communication and active listening.",
        "Presentation structure, delivery, and presence.",
        "Public speaking and handling questions.",
        "Influencing through audience needs and message design."
      ],
      "outputs": [
        "Participants can structure and deliver clearer messages.",
        "Improved presentation and communication techniques.",
        "Personal communication commitments and practice feedback."
      ],
      "bestFor": "Professionals, managers, leaders, presenters, and client-facing teams",
      "engagementFormat": "Experience / Program",
      "duration": "1 day standard; configurable to 2 days",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaAcademy / BinaLab"
    },
    "public_content_id": {
      "tagline": "Berkomunikasi dengan Jelas. Memengaruhi dengan Efektif.",
      "learningObjectives": [
        "Mengomunikasikan gagasan dengan jelas dan percaya diri.",
        "Meningkatkan komunikasi interpersonal dan di tempat kerja.",
        "Menyampaikan presentasi dan pesan yang efektif.",
        "Memperkuat kemampuan memengaruhi melalui komunikasi yang jelas dan berpusat pada audiens."
      ],
      "contentOutline": [
        "Dasar komunikasi dan kejelasan pesan.",
        "Komunikasi interpersonal dan mendengarkan secara aktif.",
        "Struktur, penyampaian, dan kehadiran dalam presentasi.",
        "Berbicara di depan umum dan menangani pertanyaan.",
        "Memengaruhi melalui pemahaman kebutuhan audiens dan perancangan pesan."
      ],
      "outputs": [
        "Peserta mampu menyusun dan menyampaikan pesan yang lebih jelas.",
        "Teknik presentasi dan komunikasi yang meningkat.",
        "Komitmen komunikasi pribadi dan umpan balik dari praktik."
      ],
      "bestFor": "Profesional, manajer, pemimpin, presenter, dan tim yang berhadapan dengan klien",
      "engagementFormat": "Pengalaman / Program",
      "duration": "Standar 1 hari; dapat disesuaikan menjadi 2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaAcademy / BinaLab"
    }
  },
  {
    "code": "SS-05",
    "name": "Service Excellence",
    "public_content": {
      "tagline": "Create Service That Customers Remember.",
      "learningObjectives": [
        "Strengthen service mindset and customer orientation.",
        "Understand customer needs and experience.",
        "Improve service communication and complaint handling.",
        "Build ownership, responsiveness, service recovery, and consistency."
      ],
      "contentOutline": [
        "Service mindset and customer orientation.",
        "Customer needs and customer experience.",
        "Service communication and expectation management.",
        "Complaint handling and service recovery.",
        "Ownership, responsiveness, and consistent service behavior."
      ],
      "outputs": [
        "Participants understand the behaviors that shape customer experience.",
        "Practical service response and recovery techniques.",
        "Personal/team service standards and action commitments."
      ],
      "bestFor": "Customer-facing teams, service teams, supervisors, managers; especially hospitality/service environments",
      "engagementFormat": "Experience / Program",
      "duration": "1 day standard; configurable to 2 days",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaAcademy / BinaLab",
      "notes": "Hospitality can be used as an industry context; content is configurable to other service environments."
    },
    "public_content_id": {
      "tagline": "Ciptakan Layanan yang Diingat Pelanggan.",
      "learningObjectives": [
        "Memperkuat pola pikir pelayanan dan orientasi pelanggan.",
        "Memahami kebutuhan dan pengalaman pelanggan.",
        "Meningkatkan komunikasi layanan dan penanganan keluhan.",
        "Membangun rasa memiliki, daya tanggap, pemulihan layanan, dan konsistensi."
      ],
      "contentOutline": [
        "Pola pikir pelayanan dan orientasi pelanggan.",
        "Kebutuhan pelanggan dan pengalaman pelanggan.",
        "Komunikasi layanan dan pengelolaan ekspektasi.",
        "Penanganan keluhan dan pemulihan layanan.",
        "Rasa memiliki, daya tanggap, dan perilaku pelayanan yang konsisten."
      ],
      "outputs": [
        "Peserta memahami perilaku yang membentuk pengalaman pelanggan.",
        "Teknik praktis untuk merespons dan memulihkan layanan.",
        "Standar layanan serta komitmen tindakan pribadi atau tim."
      ],
      "bestFor": "Tim yang berhadapan dengan pelanggan, tim layanan, supervisor, dan manajer; terutama lingkungan perhotelan dan layanan",
      "engagementFormat": "Pengalaman / Program",
      "duration": "Standar 1 hari; dapat disesuaikan menjadi 2 hari",
      "capacity": "Hingga 30 peserta",
      "notes": "Perhotelan dapat digunakan sebagai konteks industri; konten dapat disesuaikan dengan lingkungan layanan lainnya.",
      "serviceBrand": "BinaAcademy / BinaLab"
    }
  },
  {
    "code": "SS-06",
    "name": "Problem Solving, Decision Making, & Innovation",
    "public_content": {
      "tagline": "Think Clearly. Solve Effectively. Create What’s Next.",
      "learningObjectives": [
        "Frame problems clearly before solving them.",
        "Apply structured problem-solving and root-cause analysis.",
        "Make better decisions using critical thinking.",
        "Generate and test ideas for improvement and innovation."
      ],
      "contentOutline": [
        "Problem framing and critical thinking.",
        "Root-cause analysis and structured problem solving.",
        "Decision-making under constraints and uncertainty.",
        "Creative thinking and innovation mindset.",
        "Design thinking, experimentation, and learning from results."
      ],
      "outputs": [
        "Participants can frame and analyze problems more systematically.",
        "A structured solution or decision approach applied to a real case.",
        "Ideas, experiments, or improvement actions that can be taken forward."
      ],
      "bestFor": "Professionals, managers, leaders, improvement teams, and innovation teams",
      "engagementFormat": "Experience / Program / Journey",
      "duration": "1 day standard; configurable to 2 days or a longer journey",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaLab / BinaAcademy",
      "notes": "Design Thinking is used as a method/component, not as a separate Signature Solution."
    },
    "public_content_id": {
      "tagline": "Berpikir Jernih. Menyelesaikan Masalah dengan Efektif. Menciptakan Langkah Berikutnya.",
      "learningObjectives": [
        "Merumuskan masalah dengan jelas sebelum menyelesaikannya.",
        "Menerapkan pemecahan masalah terstruktur dan analisis akar penyebab.",
        "Mengambil keputusan yang lebih baik dengan berpikir kritis.",
        "Menghasilkan dan menguji gagasan perbaikan serta inovasi."
      ],
      "contentOutline": [
        "Perumusan masalah dan berpikir kritis.",
        "Analisis akar penyebab dan pemecahan masalah terstruktur.",
        "Pengambilan keputusan di tengah keterbatasan dan ketidakpastian.",
        "Berpikir kreatif dan pola pikir inovatif.",
        "Design Thinking, eksperimen, dan pembelajaran dari hasil."
      ],
      "outputs": [
        "Peserta mampu merumuskan dan menganalisis masalah secara lebih sistematis.",
        "Pendekatan solusi atau keputusan terstruktur yang diterapkan pada kasus nyata.",
        "Gagasan, eksperimen, atau tindakan perbaikan yang dapat ditindaklanjuti."
      ],
      "bestFor": "Profesional, manajer, pemimpin, tim perbaikan, dan tim inovasi",
      "engagementFormat": "Pengalaman / Program / Perjalanan",
      "duration": "Standar 1 hari; dapat disesuaikan menjadi 2 hari atau perjalanan yang lebih panjang",
      "capacity": "Hingga 30 peserta",
      "notes": "Design Thinking digunakan sebagai metode atau komponen, bukan sebagai Signature Solution terpisah.",
      "serviceBrand": "BinaLab / BinaAcademy"
    }
  },
  {
    "code": "SS-07",
    "name": "First-Time Leader",
    "public_content": {
      "tagline": "From Individual Contributor to People Leader.",
      "learningObjectives": [
        "Build the mindset and identity of a first-time people leader.",
        "Lead former peers with clarity and fairness.",
        "Delegate, set expectations, and provide feedback.",
        "Develop people while maintaining accountability for performance."
      ],
      "contentOutline": [
        "Transition from individual contributor to people leader.",
        "Leadership identity, mindset, and expectations.",
        "Leading former peers and setting team direction.",
        "Delegation, feedback, coaching conversations, and motivation.",
        "Accountability and basic people-performance management."
      ],
      "outputs": [
        "Participants clarify their leadership role and expectations.",
        "Practical delegation, feedback, and coaching tools.",
        "A personal leadership action plan for the transition into people leadership."
      ],
      "bestFor": "First-time leaders, newly appointed supervisors, and emerging people managers",
      "engagementFormat": "Program / Journey",
      "duration": "1–2 days + optional follow-up",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaAcademy / BinaCoach"
    },
    "public_content_id": {
      "tagline": "Dari Kontributor Individu Menjadi Pemimpin Orang.",
      "learningObjectives": [
        "Membangun pola pikir dan identitas sebagai pemimpin orang yang baru.",
        "Memimpin mantan rekan sejawat dengan jelas dan adil.",
        "Mendelegasikan, menetapkan ekspektasi, dan memberikan umpan balik.",
        "Mengembangkan orang sambil menjaga akuntabilitas kinerja."
      ],
      "contentOutline": [
        "Peralihan dari kontributor individu menjadi pemimpin orang.",
        "Identitas, pola pikir, dan ekspektasi kepemimpinan.",
        "Memimpin mantan rekan sejawat dan menetapkan arah tim.",
        "Delegasi, umpan balik, percakapan coaching, dan motivasi.",
        "Akuntabilitas dan pengelolaan dasar kinerja orang."
      ],
      "outputs": [
        "Peserta memperjelas peran dan ekspektasi kepemimpinannya.",
        "Perangkat praktis untuk delegasi, umpan balik, dan coaching.",
        "Rencana tindakan kepemimpinan pribadi untuk transisi menjadi pemimpin orang."
      ],
      "bestFor": "Pemimpin baru, supervisor yang baru diangkat, dan calon manajer orang",
      "engagementFormat": "Program / Perjalanan",
      "duration": "1–2 hari dengan tindak lanjut opsional",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaAcademy / BinaCoach"
    }
  },
  {
    "code": "SS-08",
    "name": "Adaptive Leadership",
    "public_content": {
      "tagline": "Lead Through Change & Uncertainty.",
      "learningObjectives": [
        "Strengthen the ability to lead through change and uncertainty.",
        "Make sound decisions when information is incomplete.",
        "Communicate change and manage transition.",
        "Build resilience and adaptive leadership behaviors."
      ],
      "contentOutline": [
        "Adaptive leadership principles.",
        "Leading amid change, ambiguity, and uncertainty.",
        "Decision-making under uncertainty.",
        "Change communication and stakeholder response.",
        "Resilience and transition leadership."
      ],
      "outputs": [
        "Participants identify their adaptive leadership challenges.",
        "Practical approaches for leading change and uncertainty.",
        "A personal/team action plan for adaptive leadership."
      ],
      "bestFor": "Managers, leaders, change leaders, and professionals navigating significant change",
      "engagementFormat": "Program / Journey",
      "duration": "1–2 days + optional follow-up",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaAcademy / BinaCoach"
    },
    "public_content_id": {
      "tagline": "Memimpin di Tengah Perubahan dan Ketidakpastian.",
      "learningObjectives": [
        "Memperkuat kemampuan memimpin melalui perubahan dan ketidakpastian.",
        "Mengambil keputusan yang tepat saat informasi belum lengkap.",
        "Mengomunikasikan perubahan dan mengelola transisi.",
        "Membangun resiliensi dan perilaku kepemimpinan adaptif."
      ],
      "contentOutline": [
        "Prinsip kepemimpinan adaptif.",
        "Memimpin di tengah perubahan, ambiguitas, dan ketidakpastian.",
        "Pengambilan keputusan dalam ketidakpastian.",
        "Komunikasi perubahan dan respons pemangku kepentingan.",
        "Resiliensi dan kepemimpinan dalam transisi."
      ],
      "outputs": [
        "Peserta mengenali tantangan kepemimpinan adaptif mereka.",
        "Pendekatan praktis untuk memimpin perubahan dan ketidakpastian.",
        "Rencana tindakan pribadi atau tim untuk kepemimpinan adaptif."
      ],
      "bestFor": "Manajer, pemimpin, pemimpin perubahan, dan profesional yang menghadapi perubahan besar",
      "engagementFormat": "Program / Perjalanan",
      "duration": "1–2 hari dengan tindak lanjut opsional",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaAcademy / BinaCoach"
    }
  },
  {
    "code": "SS-09",
    "name": "AI-Powered Professional",
    "public_content": {
      "tagline": "Work Smarter. Think Critically. Stay Human.",
      "learningObjectives": [
        "Build practical AI literacy for professional work.",
        "Use AI to improve productivity and workflows.",
        "Maintain critical thinking, judgment, and human accountability.",
        "Collaborate effectively with AI while applying responsible-use principles."
      ],
      "contentOutline": [
        "AI literacy and practical use cases.",
        "AI-assisted productivity and workflow design.",
        "Prompting, tools, and human-AI collaboration.",
        "Critical thinking, verification, and judgment.",
        "Responsible AI and professional boundaries."
      ],
      "outputs": [
        "Participants identify relevant AI use cases for their work.",
        "Practical AI-assisted workflows or work experiments.",
        "Clear principles for responsible and human-centered AI use."
      ],
      "bestFor": "Professionals, managers, knowledge workers, and teams adapting to AI-enabled work",
      "engagementFormat": "Experience / Program",
      "duration": "1 day standard; configurable to 2 days",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaAcademy / BinaLab",
      "notes": "Tools and exercises can be adapted to the organization's approved AI environment."
    },
    "public_content_id": {
      "tagline": "Bekerja Lebih Cerdas. Berpikir Kritis. Tetap Manusiawi.",
      "learningObjectives": [
        "Membangun literasi AI yang praktis untuk pekerjaan profesional.",
        "Menggunakan AI untuk meningkatkan produktivitas dan alur kerja.",
        "Mempertahankan berpikir kritis, pertimbangan, dan akuntabilitas manusia.",
        "Berkolaborasi secara efektif dengan AI sambil menerapkan prinsip penggunaan yang bertanggung jawab."
      ],
      "contentOutline": [
        "Literasi AI dan kasus penggunaan praktis.",
        "Produktivitas dengan bantuan AI dan perancangan alur kerja.",
        "Prompting, alat, dan kolaborasi manusia dengan AI.",
        "Berpikir kritis, verifikasi, dan pertimbangan.",
        "AI yang bertanggung jawab dan batasan profesional."
      ],
      "outputs": [
        "Peserta mengidentifikasi kasus penggunaan AI yang relevan bagi pekerjaannya.",
        "Alur kerja atau eksperimen kerja praktis dengan bantuan AI.",
        "Prinsip yang jelas untuk penggunaan AI yang bertanggung jawab dan berpusat pada manusia."
      ],
      "bestFor": "Profesional, manajer, pekerja pengetahuan, dan tim yang beradaptasi dengan pekerjaan berbantuan AI",
      "engagementFormat": "Pengalaman / Program",
      "duration": "Standar 1 hari; dapat disesuaikan menjadi 2 hari",
      "capacity": "Hingga 30 peserta",
      "notes": "Alat dan latihan dapat disesuaikan dengan lingkungan AI yang disetujui organisasi.",
      "serviceBrand": "BinaAcademy / BinaLab"
    }
  },
  {
    "code": "SS-10",
    "name": "BinaCoach: Growth, Performance & Wellbeing Coaching",
    "public_content": {
      "tagline": "From Insight to Sustainable Change.",
      "learningObjectives": [
        "Turn insight into sustained behavioral and performance change.",
        "Clarify goals, priorities, and development needs.",
        "Strengthen accountability and follow-through.",
        "Support growth, performance, career, transition, and wellbeing within coaching scope."
      ],
      "contentOutline": [
        "Leadership & Executive Coaching.",
        "Performance Coaching.",
        "Career & Development Coaching.",
        "Mental Health & Wellbeing Coaching within coaching/wellbeing scope.",
        "Transition & Change Coaching.",
        "Team / Group Coaching.",
        "Journey architecture: Assess → Align → Activate → Accelerate."
      ],
      "outputs": [
        "A clearly defined coaching goal and development focus.",
        "Documented progress and action between sessions.",
        "Greater accountability and practical behavioral change.",
        "End-of-coaching reflection and next-step plan."
      ],
      "bestFor": "Executives, leaders, managers, professionals, teams, and individuals with defined development goals",
      "engagementFormat": "Journey",
      "duration": "1 or 3 months",
      "capacity": "1–5 pax/session",
      "serviceBrand": "BinaCoach",
      "notes": "Wellbeing coaching is not diagnosis or clinical treatment; referral is required for needs beyond coaching scope."
    },
    "public_content_id": {
      "tagline": "Dari Pemahaman Menuju Perubahan Berkelanjutan.",
      "learningObjectives": [
        "Mengubah pemahaman menjadi perubahan perilaku dan kinerja yang berkelanjutan.",
        "Memperjelas tujuan, prioritas, dan kebutuhan pengembangan.",
        "Memperkuat akuntabilitas dan tindak lanjut.",
        "Mendukung pertumbuhan, kinerja, karier, transisi, dan kesejahteraan dalam cakupan coaching."
      ],
      "contentOutline": [
        "Coaching Kepemimpinan dan Eksekutif.",
        "Coaching Kinerja.",
        "Coaching Karier dan Pengembangan.",
        "Coaching Kesehatan Mental dan Kesejahteraan dalam cakupan coaching dan kesejahteraan.",
        "Coaching Transisi dan Perubahan.",
        "Coaching Tim / Kelompok.",
        "Arsitektur perjalanan: Asesmen → Penyelarasan → Aktivasi → Akselerasi."
      ],
      "outputs": [
        "Tujuan coaching dan fokus pengembangan yang jelas.",
        "Kemajuan dan tindakan antarsesi yang terdokumentasi.",
        "Akuntabilitas yang lebih kuat dan perubahan perilaku yang praktis.",
        "Refleksi akhir coaching dan rencana langkah berikutnya."
      ],
      "bestFor": "Eksekutif, pemimpin, manajer, profesional, tim, dan individu dengan tujuan pengembangan yang jelas",
      "engagementFormat": "Perjalanan",
      "duration": "1 atau 3 bulan",
      "capacity": "1–5 peserta per sesi",
      "notes": "Coaching kesejahteraan bukan diagnosis atau perawatan klinis; kebutuhan di luar cakupan coaching harus dirujuk.",
      "serviceBrand": "BinaCoach"
    }
  },
  {
    "code": "SS-11",
    "name": "Team Building",
    "public_content": {
      "tagline": "Build Connection. Strengthen Collaboration. Create Team Energy.",
      "learningObjectives": [
        "Build connection, trust, openness, and team energy.",
        "Strengthen collaboration and synergy.",
        "Develop empathy and perspective-taking.",
        "Connect team experience to values, culture, and business priorities."
      ],
      "contentOutline": [
        "Team connection and bonding.",
        "Trust and openness.",
        "Collaboration and synergy.",
        "Empathy and perspective-taking.",
        "Values/culture activation and business-priority alignment.",
        "Experiential activities, simulations, games, reflection, and team commitments."
      ],
      "outputs": [
        "A shared team experience linked to a clear business or team objective.",
        "Team insights and identified collaboration patterns.",
        "Concrete team commitments or actions after the experience."
      ],
      "bestFor": "Teams, departments, project teams, leadership teams, and organizational groups",
      "engagementFormat": "Experience / Program / Journey",
      "duration": "0.5–1 day standard; configurable from 2–4 hours to 2 days",
      "capacity": "Essential: up to 30 pax; Signature: 31–80; Enterprise: 81–150",
      "serviceBrand": "BinaPlay / BinaLab",
      "notes": "Package names indicate participant scale/capacity, not quality hierarchy. Team Building is outcome-led, not merely games/outing."
    },
    "public_content_id": {
      "tagline": "Bangun Koneksi. Perkuat Kolaborasi. Hidupkan Energi Tim.",
      "learningObjectives": [
        "Membangun koneksi, kepercayaan, keterbukaan, dan energi tim.",
        "Memperkuat kolaborasi dan sinergi.",
        "Mengembangkan empati dan kemampuan melihat sudut pandang lain.",
        "Menghubungkan pengalaman tim dengan nilai, budaya, dan prioritas bisnis."
      ],
      "contentOutline": [
        "Koneksi dan ikatan tim.",
        "Kepercayaan dan keterbukaan.",
        "Kolaborasi dan sinergi.",
        "Empati dan kemampuan melihat sudut pandang lain.",
        "Aktivasi nilai dan budaya serta penyelarasan prioritas bisnis.",
        "Aktivitas pengalaman, simulasi, permainan, refleksi, dan komitmen tim."
      ],
      "outputs": [
        "Pengalaman tim bersama yang terhubung dengan tujuan bisnis atau tim yang jelas.",
        "Pemahaman tentang tim dan pola kolaborasi yang teridentifikasi.",
        "Komitmen atau tindakan tim yang konkret setelah pengalaman."
      ],
      "bestFor": "Tim, departemen, tim proyek, tim kepemimpinan, dan kelompok organisasi",
      "engagementFormat": "Pengalaman / Program / Perjalanan",
      "duration": "Standar 0,5–1 hari; dapat disesuaikan dari 2–4 jam hingga 2 hari",
      "capacity": "Essential: hingga 30 peserta; Signature: 31–80; Enterprise: 81–150",
      "notes": "Nama paket menunjukkan skala atau kapasitas peserta, bukan jenjang kualitas. Team Building berorientasi pada hasil, bukan sekadar permainan atau outing.",
      "serviceBrand": "BinaPlay / BinaLab"
    }
  },
  {
    "code": "SS-12",
    "name": "Trust & Psychological Safety",
    "public_content": {
      "tagline": "Create a Team Where People Can Speak, Listen & Contribute.",
      "learningObjectives": [
        "Build trust and openness within teams.",
        "Strengthen speaking-up and listening behaviors.",
        "Create conditions for constructive contribution and disagreement.",
        "Improve interpersonal safety in day-to-day collaboration."
      ],
      "contentOutline": [
        "Trust and psychological safety fundamentals.",
        "Speaking up, listening, and constructive interaction.",
        "Handling disagreement and vulnerability at work.",
        "Leader/team behaviors that reinforce psychological safety.",
        "Practical team norms and commitments."
      ],
      "outputs": [
        "Participants identify behaviors that strengthen or weaken trust.",
        "Agreed team behaviors or norms for safer collaboration.",
        "Practical actions to improve speaking, listening, and contribution."
      ],
      "bestFor": "Teams, leaders, and organizations seeking stronger trust and psychological safety",
      "engagementFormat": "Experience / Program",
      "duration": "1–2 days",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaLab / BinaAcademy"
    },
    "public_content_id": {
      "tagline": "Bangun Tim Tempat Semua Orang Dapat Berbicara, Mendengar, dan Berkontribusi.",
      "learningObjectives": [
        "Membangun kepercayaan dan keterbukaan dalam tim.",
        "Memperkuat perilaku berani berbicara dan mendengarkan.",
        "Menciptakan kondisi untuk kontribusi dan perbedaan pendapat yang konstruktif.",
        "Meningkatkan rasa aman dalam hubungan interpersonal pada kolaborasi sehari-hari."
      ],
      "contentOutline": [
        "Dasar kepercayaan dan keamanan psikologis.",
        "Berani berbicara, mendengarkan, dan berinteraksi secara konstruktif.",
        "Menangani perbedaan pendapat dan kerentanan di tempat kerja.",
        "Perilaku pemimpin dan tim yang memperkuat keamanan psikologis.",
        "Norma dan komitmen tim yang praktis."
      ],
      "outputs": [
        "Peserta mengidentifikasi perilaku yang memperkuat atau melemahkan kepercayaan.",
        "Perilaku atau norma tim yang disepakati untuk kolaborasi yang lebih aman.",
        "Tindakan praktis untuk meningkatkan keberanian berbicara, mendengarkan, dan berkontribusi."
      ],
      "bestFor": "Tim, pemimpin, dan organisasi yang ingin memperkuat kepercayaan dan keamanan psikologis",
      "engagementFormat": "Pengalaman / Program",
      "duration": "1–2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab / BinaAcademy"
    }
  },
  {
    "code": "SS-13",
    "name": "Team Synergy",
    "public_content": {
      "tagline": "From Individual Contribution to Collective Performance.",
      "learningObjectives": [
        "Improve team alignment and role clarity.",
        "Strengthen cross-functional cooperation.",
        "Solve problems collectively.",
        "Convert individual contribution into stronger collective performance."
      ],
      "contentOutline": [
        "Team purpose, goals, and alignment.",
        "Role clarity and interdependencies.",
        "Cross-functional collaboration.",
        "Collective problem solving and decision making.",
        "Synergy practices and shared accountability."
      ],
      "outputs": [
        "Clearer understanding of roles and interdependencies.",
        "Identified collaboration barriers and improvement actions.",
        "Team agreements and practical synergy commitments."
      ],
      "bestFor": "Cross-functional teams, departments, project teams, and leadership teams",
      "engagementFormat": "Program",
      "duration": "1–2 days",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaLab / BinaAcademy"
    },
    "public_content_id": {
      "tagline": "Dari Kontribusi Individu Menuju Kinerja Bersama.",
      "learningObjectives": [
        "Meningkatkan penyelarasan tim dan kejelasan peran.",
        "Memperkuat kerja sama lintas fungsi.",
        "Menyelesaikan masalah secara kolektif.",
        "Mengubah kontribusi individu menjadi kinerja bersama yang lebih kuat."
      ],
      "contentOutline": [
        "Tujuan, sasaran, dan penyelarasan tim.",
        "Kejelasan peran dan saling ketergantungan.",
        "Kolaborasi lintas fungsi.",
        "Pemecahan masalah dan pengambilan keputusan kolektif.",
        "Praktik sinergi dan akuntabilitas bersama."
      ],
      "outputs": [
        "Pemahaman yang lebih jelas tentang peran dan saling ketergantungan.",
        "Hambatan kolaborasi dan tindakan perbaikan yang teridentifikasi.",
        "Kesepakatan tim dan komitmen sinergi yang praktis."
      ],
      "bestFor": "Tim lintas fungsi, departemen, tim proyek, dan tim kepemimpinan",
      "engagementFormat": "Program",
      "duration": "1–2 hari",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab / BinaAcademy"
    }
  },
  {
    "code": "SS-14",
    "name": "Empathy Experience",
    "public_content": {
      "tagline": "Experience. Understand. Choose. Act.",
      "learningObjectives": [
        "Develop perspective-taking and empathy.",
        "Increase awareness of how others experience situations.",
        "Translate awareness into conscious behavioral choice.",
        "Turn empathy into observable action."
      ],
      "contentOutline": [
        "Empathy and perspective-taking.",
        "Experience and awareness through simulations/experiential activities.",
        "Understanding SAYS → THINKS → FEELS → DOES.",
        "Behavioral choice and response.",
        "Action and application to workplace relationships."
      ],
      "outputs": [
        "Participants experience situations from different perspectives.",
        "Greater awareness of assumptions, needs, and reactions.",
        "Concrete empathy-in-action commitments."
      ],
      "bestFor": "Teams, leaders, customer-facing groups, and organizations seeking stronger human connection",
      "engagementFormat": "Experience / Program",
      "duration": "1–2 days",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaPlay / BinaLab",
      "notes": "Core experiential sequence: EXPERIENCE → AWARENESS → CHOICE → ACTION."
    },
    "public_content_id": {
      "tagline": "Alami. Pahami. Pilih. Bertindak.",
      "learningObjectives": [
        "Mengembangkan kemampuan melihat sudut pandang lain dan berempati.",
        "Meningkatkan kesadaran tentang cara orang lain mengalami suatu situasi.",
        "Menerjemahkan kesadaran menjadi pilihan perilaku yang disadari.",
        "Mengubah empati menjadi tindakan yang dapat diamati."
      ],
      "contentOutline": [
        "Empati dan kemampuan melihat sudut pandang lain.",
        "Pengalaman dan kesadaran melalui simulasi atau aktivitas pengalaman.",
        "Memahami yang DIKATAKAN → DIPIKIRKAN → DIRASAKAN → DILAKUKAN.",
        "Pilihan perilaku dan respons.",
        "Tindakan serta penerapannya dalam hubungan di tempat kerja."
      ],
      "outputs": [
        "Peserta mengalami situasi dari sudut pandang yang berbeda.",
        "Kesadaran yang lebih besar tentang asumsi, kebutuhan, dan reaksi.",
        "Komitmen konkret untuk menerapkan empati dalam tindakan."
      ],
      "bestFor": "Tim, pemimpin, kelompok yang berhadapan dengan pelanggan, dan organisasi yang ingin memperkuat hubungan antarmanusia",
      "engagementFormat": "Pengalaman / Program",
      "duration": "1–2 hari",
      "capacity": "Hingga 30 peserta",
      "notes": "Urutan inti pengalaman: PENGALAMAN → KESADARAN → PILIHAN → TINDAKAN.",
      "serviceBrand": "BinaPlay / BinaLab"
    }
  },
  {
    "code": "SS-15",
    "name": "High Performing Team",
    "public_content": {
      "tagline": "Build the Habits of High-Performing Teams.",
      "learningObjectives": [
        "Build team effectiveness and performance habits.",
        "Strengthen accountability and performance norms.",
        "Improve collaboration and execution discipline.",
        "Create a foundation for continuous improvement."
      ],
      "contentOutline": [
        "Characteristics and habits of high-performing teams.",
        "Performance norms and accountability.",
        "Collaboration, discipline, and execution.",
        "Feedback and learning loops.",
        "Continuous improvement practices."
      ],
      "outputs": [
        "Team performance strengths and gaps become visible.",
        "Agreed performance norms and behaviors.",
        "A practical team improvement plan and follow-through actions."
      ],
      "bestFor": "Leadership teams, management teams, project teams, and established teams",
      "engagementFormat": "Program / Journey",
      "duration": "1–2 days + optional follow-up",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaLab / BinaAcademy / BinaCoach"
    },
    "public_content_id": {
      "tagline": "Bangun Kebiasaan Tim Berkinerja Tinggi.",
      "learningObjectives": [
        "Membangun efektivitas tim dan kebiasaan berkinerja.",
        "Memperkuat akuntabilitas dan norma kinerja.",
        "Meningkatkan kolaborasi dan disiplin pelaksanaan.",
        "Menciptakan fondasi untuk perbaikan berkelanjutan."
      ],
      "contentOutline": [
        "Ciri dan kebiasaan tim berkinerja tinggi.",
        "Norma kinerja dan akuntabilitas.",
        "Kolaborasi, disiplin, dan pelaksanaan.",
        "Umpan balik dan siklus pembelajaran.",
        "Praktik perbaikan berkelanjutan."
      ],
      "outputs": [
        "Kekuatan dan kesenjangan kinerja tim menjadi terlihat.",
        "Norma dan perilaku kinerja yang disepakati.",
        "Rencana perbaikan tim yang praktis dan tindakan tindak lanjut."
      ],
      "bestFor": "Tim kepemimpinan, tim manajemen, tim proyek, dan tim yang sudah terbentuk",
      "engagementFormat": "Program / Perjalanan",
      "duration": "1–2 hari dengan tindak lanjut opsional",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab / BinaAcademy / BinaCoach"
    }
  },
  {
    "code": "SS-16",
    "name": "Team Agility",
    "public_content": {
      "tagline": "Build Teams That Adapt.",
      "learningObjectives": [
        "Increase team adaptability and change readiness.",
        "Improve rapid collaboration and response.",
        "Encourage experimentation and learning.",
        "Build habits for working effectively amid changing priorities."
      ],
      "contentOutline": [
        "Team agility and adaptability.",
        "Rapid collaboration and decision cycles.",
        "Experimentation and iteration.",
        "Learning from feedback and changing conditions.",
        "Team practices that support responsiveness."
      ],
      "outputs": [
        "Participants identify agility barriers and opportunities.",
        "Practical team agility practices or experiments.",
        "Team commitments for faster learning and adaptation."
      ],
      "bestFor": "Teams facing change, transformation, new ways of working, or volatile priorities",
      "engagementFormat": "Experience / Program / Journey",
      "duration": "1–2 days + optional follow-up",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaLab / BinaAcademy / BinaWorks"
    },
    "public_content_id": {
      "tagline": "Bangun Tim yang Mampu Beradaptasi.",
      "learningObjectives": [
        "Meningkatkan kemampuan adaptasi dan kesiapan tim menghadapi perubahan.",
        "Meningkatkan kolaborasi dan respons yang cepat.",
        "Mendorong eksperimen dan pembelajaran.",
        "Membangun kebiasaan bekerja efektif saat prioritas berubah."
      ],
      "contentOutline": [
        "Ketangkasan dan kemampuan adaptasi tim.",
        "Kolaborasi cepat dan siklus pengambilan keputusan.",
        "Eksperimen dan iterasi.",
        "Belajar dari umpan balik dan kondisi yang berubah.",
        "Praktik tim yang mendukung daya tanggap."
      ],
      "outputs": [
        "Peserta mengidentifikasi hambatan dan peluang ketangkasan.",
        "Praktik atau eksperimen ketangkasan tim yang dapat diterapkan.",
        "Komitmen tim untuk belajar dan beradaptasi lebih cepat."
      ],
      "bestFor": "Tim yang menghadapi perubahan, transformasi, cara kerja baru, atau prioritas yang tidak stabil",
      "engagementFormat": "Pengalaman / Program / Perjalanan",
      "duration": "1–2 hari dengan tindak lanjut opsional",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaLab / BinaAcademy / BinaWorks"
    }
  },
  {
    "code": "SS-17",
    "name": "Leading the Team",
    "public_content": {
      "tagline": "Align. Develop. Mobilize.",
      "learningObjectives": [
        "Lead teams with clearer direction and alignment.",
        "Delegate and develop people effectively.",
        "Motivate and mobilize team members.",
        "Conduct practical performance conversations."
      ],
      "contentOutline": [
        "Team leadership and direction.",
        "Alignment, delegation, and prioritization.",
        "People development and coaching.",
        "Motivation and engagement.",
        "Performance conversations and accountability."
      ],
      "outputs": [
        "Participants strengthen their practical team leadership toolkit.",
        "Clearer delegation, development, and communication actions.",
        "A team leadership action plan."
      ],
      "bestFor": "Supervisors, managers, team leaders, and people managers",
      "engagementFormat": "Program / Journey",
      "duration": "1–2 days + optional coaching",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaAcademy / BinaCoach"
    },
    "public_content_id": {
      "tagline": "Selaraskan. Kembangkan. Gerakkan.",
      "learningObjectives": [
        "Memimpin tim dengan arah dan penyelarasan yang lebih jelas.",
        "Mendelegasikan dan mengembangkan orang secara efektif.",
        "Memotivasi dan menggerakkan anggota tim.",
        "Melakukan percakapan kinerja yang praktis."
      ],
      "contentOutline": [
        "Kepemimpinan dan arah tim.",
        "Penyelarasan, delegasi, dan penentuan prioritas.",
        "Pengembangan orang dan coaching.",
        "Motivasi dan keterlibatan.",
        "Percakapan kinerja dan akuntabilitas."
      ],
      "outputs": [
        "Peserta memperkuat perangkat praktis kepemimpinan tim mereka.",
        "Tindakan delegasi, pengembangan, dan komunikasi yang lebih jelas.",
        "Rencana tindakan kepemimpinan tim."
      ],
      "bestFor": "Supervisor, manajer, pemimpin tim, dan manajer orang",
      "engagementFormat": "Program / Perjalanan",
      "duration": "1–2 hari dengan coaching opsional",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaAcademy / BinaCoach"
    }
  },
  {
    "code": "SS-18",
    "name": "Culture Activation",
    "public_content": {
      "tagline": "Turn Values Into Everyday Behaviors.",
      "learningObjectives": [
        "Translate organizational values into observable behaviors.",
        "Align leadership and employee practices with desired culture.",
        "Strengthen everyday culture activation.",
        "Create mechanisms for reinforcement and role modeling."
      ],
      "contentOutline": [
        "Values-to-behavior translation.",
        "Culture alignment and behavioral expectations.",
        "Leadership role modeling.",
        "Everyday rituals, practices, and reinforcement.",
        "Embedding culture into team and organizational routines."
      ],
      "outputs": [
        "Behavioral interpretation of organizational values.",
        "Priority culture behaviors and activation actions.",
        "Leadership/team commitments and reinforcement mechanisms."
      ],
      "bestFor": "Organizations, business units, leadership teams, and culture transformation initiatives",
      "engagementFormat": "Program / Journey / Transformation",
      "duration": "3–6 months configurable",
      "capacity": "Scope-dependent",
      "serviceBrand": "BinaLab / BinaAcademy / BinaWorks"
    },
    "public_content_id": {
      "tagline": "Ubah Nilai Menjadi Perilaku Sehari-hari.",
      "learningObjectives": [
        "Menerjemahkan nilai organisasi menjadi perilaku yang dapat diamati.",
        "Menyelaraskan praktik pemimpin dan karyawan dengan budaya yang diinginkan.",
        "Memperkuat aktivasi budaya sehari-hari.",
        "Menciptakan mekanisme penguatan dan keteladanan."
      ],
      "contentOutline": [
        "Penerjemahan nilai menjadi perilaku.",
        "Penyelarasan budaya dan ekspektasi perilaku.",
        "Keteladanan pemimpin.",
        "Ritual, praktik, dan penguatan sehari-hari.",
        "Melekatkan budaya dalam rutinitas tim dan organisasi."
      ],
      "outputs": [
        "Penafsiran perilaku atas nilai-nilai organisasi.",
        "Perilaku budaya prioritas dan tindakan aktivasi.",
        "Komitmen pemimpin dan tim serta mekanisme penguatan."
      ],
      "bestFor": "Organisasi, unit bisnis, tim kepemimpinan, dan inisiatif transformasi budaya",
      "engagementFormat": "Program / Perjalanan / Transformasi",
      "duration": "3–6 bulan, dapat disesuaikan",
      "capacity": "Bergantung pada cakupan",
      "serviceBrand": "BinaLab / BinaAcademy / BinaWorks"
    }
  },
  {
    "code": "SS-19",
    "name": "Change & Organizational Agility",
    "public_content": {
      "tagline": "Build an Organization That Can Adapt.",
      "learningObjectives": [
        "Strengthen organizational change readiness.",
        "Improve adoption and stakeholder alignment.",
        "Build adaptive organizational capability.",
        "Support sustainable change behaviors and ways of working."
      ],
      "contentOutline": [
        "Change readiness and organizational agility.",
        "Stakeholder alignment and adoption.",
        "Change communication and transition.",
        "Adaptive capability and learning.",
        "Embedding change into organizational practices."
      ],
      "outputs": [
        "Change-readiness and adoption insights.",
        "Priority barriers and action areas.",
        "A structured change/adoption roadmap or intervention plan."
      ],
      "bestFor": "Organizations undergoing transformation, restructuring, digital change, or major strategic shifts",
      "engagementFormat": "Journey / Transformation",
      "duration": "3–6 months configurable",
      "capacity": "Scope-dependent",
      "serviceBrand": "BinaLab / BinaWorks / BinaCoach"
    },
    "public_content_id": {
      "tagline": "Bangun Organisasi yang Mampu Beradaptasi.",
      "learningObjectives": [
        "Memperkuat kesiapan organisasi menghadapi perubahan.",
        "Meningkatkan adopsi dan penyelarasan pemangku kepentingan.",
        "Membangun kapabilitas organisasi yang adaptif.",
        "Mendukung perilaku perubahan dan cara kerja yang berkelanjutan."
      ],
      "contentOutline": [
        "Kesiapan perubahan dan ketangkasan organisasi.",
        "Penyelarasan pemangku kepentingan dan adopsi.",
        "Komunikasi perubahan dan transisi.",
        "Kapabilitas adaptif dan pembelajaran.",
        "Melekatkan perubahan dalam praktik organisasi."
      ],
      "outputs": [
        "Pemahaman tentang kesiapan perubahan dan adopsi.",
        "Hambatan prioritas dan area tindakan.",
        "Peta jalan perubahan atau adopsi yang terstruktur maupun rencana intervensi."
      ],
      "bestFor": "Organisasi yang menjalani transformasi, restrukturisasi, perubahan digital, atau pergeseran strategi besar",
      "engagementFormat": "Perjalanan / Transformasi",
      "duration": "3–6 bulan, dapat disesuaikan",
      "capacity": "Bergantung pada cakupan",
      "serviceBrand": "BinaLab / BinaWorks / BinaCoach"
    }
  },
  {
    "code": "SS-20",
    "name": "Leadership Academy",
    "public_content": {
      "tagline": "Build Leaders at Every Level.",
      "learningObjectives": [
        "Develop leadership capability systematically.",
        "Strengthen people leadership and strategic leadership.",
        "Provide structured practice and continuity.",
        "Create a sustainable leadership development pathway."
      ],
      "contentOutline": [
        "Leadership mindset and capability framework.",
        "People leadership and performance.",
        "Strategic thinking and decision making.",
        "Leading change and influencing.",
        "Practice, reflection, feedback, and application."
      ],
      "outputs": [
        "Leadership capability development roadmap.",
        "Applied leadership projects or practices.",
        "Progress insights and development recommendations."
      ],
      "bestFor": "Organizations developing supervisors, managers, senior managers, and leaders",
      "engagementFormat": "Journey / Transformation",
      "duration": "3–6 months configurable",
      "capacity": "Scope-dependent",
      "serviceBrand": "BinaAcademy / BinaCoach"
    },
    "public_content_id": {
      "tagline": "Bangun Pemimpin di Setiap Jenjang.",
      "learningObjectives": [
        "Mengembangkan kapabilitas kepemimpinan secara sistematis.",
        "Memperkuat kepemimpinan orang dan kepemimpinan strategis.",
        "Menyediakan praktik terstruktur dan kesinambungan.",
        "Menciptakan jalur pengembangan kepemimpinan yang berkelanjutan."
      ],
      "contentOutline": [
        "Pola pikir kepemimpinan dan kerangka kapabilitas.",
        "Kepemimpinan orang dan kinerja.",
        "Berpikir strategis dan pengambilan keputusan.",
        "Memimpin perubahan dan memengaruhi.",
        "Praktik, refleksi, umpan balik, dan penerapan."
      ],
      "outputs": [
        "Peta jalan pengembangan kapabilitas kepemimpinan.",
        "Proyek atau praktik kepemimpinan yang diterapkan.",
        "Pemahaman tentang kemajuan dan rekomendasi pengembangan."
      ],
      "bestFor": "Organisasi yang mengembangkan supervisor, manajer, manajer senior, dan pemimpin",
      "engagementFormat": "Perjalanan / Transformasi",
      "duration": "3–6 bulan, dapat disesuaikan",
      "capacity": "Bergantung pada cakupan",
      "serviceBrand": "BinaAcademy / BinaCoach"
    }
  },
  {
    "code": "SS-21",
    "name": "Future Leaders",
    "public_content": {
      "tagline": "Prepare Today’s Talent for Tomorrow’s Leadership.",
      "learningObjectives": [
        "Prepare high-potential talent for future leadership.",
        "Strengthen strategic thinking and leadership readiness.",
        "Increase exposure to leadership challenges.",
        "Support intentional career and development growth."
      ],
      "contentOutline": [
        "Future leadership expectations.",
        "Strategic thinking and business perspective.",
        "Leadership exposure and influence.",
        "Self-awareness, development, and career growth.",
        "Applied leadership practice."
      ],
      "outputs": [
        "Individual development priorities.",
        "Leadership readiness action plans.",
        "Applied projects, reflection, and development evidence."
      ],
      "bestFor": "High-potential employees, emerging leaders, and leadership pipeline candidates",
      "engagementFormat": "Journey",
      "duration": "3–6 months configurable",
      "capacity": "Scope-dependent",
      "serviceBrand": "BinaAcademy / BinaCoach"
    },
    "public_content_id": {
      "tagline": "Siapkan Talenta Masa Kini untuk Kepemimpinan Masa Depan.",
      "learningObjectives": [
        "Mempersiapkan talenta berpotensi tinggi untuk kepemimpinan masa depan.",
        "Memperkuat berpikir strategis dan kesiapan kepemimpinan.",
        "Meningkatkan paparan terhadap tantangan kepemimpinan.",
        "Mendukung pertumbuhan karier dan pengembangan yang terarah."
      ],
      "contentOutline": [
        "Ekspektasi kepemimpinan masa depan.",
        "Berpikir strategis dan perspektif bisnis.",
        "Paparan kepemimpinan dan kemampuan memengaruhi.",
        "Kesadaran diri, pengembangan, dan pertumbuhan karier.",
        "Praktik kepemimpinan yang diterapkan."
      ],
      "outputs": [
        "Prioritas pengembangan individu.",
        "Rencana tindakan kesiapan kepemimpinan.",
        "Proyek terapan, refleksi, dan bukti pengembangan."
      ],
      "bestFor": "Karyawan berpotensi tinggi, calon pemimpin, dan kandidat jalur kepemimpinan",
      "engagementFormat": "Perjalanan",
      "duration": "3–6 bulan, dapat disesuaikan",
      "capacity": "Bergantung pada cakupan",
      "serviceBrand": "BinaAcademy / BinaCoach"
    }
  },
  {
    "code": "SS-22",
    "name": "Internal Trainer & Facilitator Academy",
    "public_content": {
      "tagline": "Build Internal Learning Capability.",
      "learningObjectives": [
        "Build internal trainer and facilitator capability.",
        "Design learning that supports business needs.",
        "Facilitate adult learning effectively.",
        "Engage participants and evaluate learning.",
        "Create sustainable internal TTT capability."
      ],
      "contentOutline": [
        "Adult learning principles.",
        "Training and module design.",
        "Facilitation and presentation skills.",
        "Learning methods and participant engagement.",
        "Assessment, feedback, practice, and trainer improvement.",
        "Train-the-Trainer (TTT) is a core curriculum/track."
      ],
      "outputs": [
        "Participants can design and facilitate an internal learning session.",
        "Trainer/facilitator practice with structured feedback.",
        "Personal improvement plan and internal trainer standards."
      ],
      "bestFor": "Internal trainers, subject-matter experts, facilitators, HR/L&D teams",
      "engagementFormat": "Program / Journey",
      "duration": "2–5 days + optional 1–3 month follow-up",
      "capacity": "Up to 30 pax",
      "serviceBrand": "BinaAcademy / BinaLab"
    },
    "public_content_id": {
      "tagline": "Bangun Kapabilitas Pembelajaran Internal.",
      "learningObjectives": [
        "Membangun kapabilitas pelatih dan fasilitator internal.",
        "Merancang pembelajaran yang mendukung kebutuhan bisnis.",
        "Memfasilitasi pembelajaran orang dewasa secara efektif.",
        "Melibatkan peserta dan mengevaluasi pembelajaran.",
        "Menciptakan kapabilitas Train-the-Trainer internal yang berkelanjutan."
      ],
      "contentOutline": [
        "Prinsip pembelajaran orang dewasa.",
        "Perancangan pelatihan dan modul.",
        "Keterampilan fasilitasi dan presentasi.",
        "Metode pembelajaran dan keterlibatan peserta.",
        "Asesmen, umpan balik, praktik, dan peningkatan kemampuan pelatih.",
        "Train-the-Trainer (TTT) merupakan kurikulum atau jalur inti."
      ],
      "outputs": [
        "Peserta mampu merancang dan memfasilitasi sesi pembelajaran internal.",
        "Praktik pelatih atau fasilitator dengan umpan balik terstruktur.",
        "Rencana perbaikan pribadi dan standar pelatih internal."
      ],
      "bestFor": "Pelatih internal, ahli materi, fasilitator, serta tim SDM dan L&D",
      "engagementFormat": "Program / Perjalanan",
      "duration": "2–5 hari dengan tindak lanjut opsional 1–3 bulan",
      "capacity": "Hingga 30 peserta",
      "serviceBrand": "BinaAcademy / BinaLab"
    }
  },
  {
    "code": "SS-23",
    "name": "Performance Acceleration",
    "public_content": {
      "tagline": "Connect People Capability With Business Performance.",
      "learningObjectives": [
        "Connect people capability with performance priorities.",
        "Strengthen execution discipline and accountability.",
        "Identify capability-performance gaps.",
        "Translate development into business-relevant action."
      ],
      "contentOutline": [
        "Performance alignment and priorities.",
        "Capability-performance linkage.",
        "Execution discipline and accountability.",
        "Performance improvement practices.",
        "Action, review, and reinforcement."
      ],
      "outputs": [
        "Performance and capability gap insights.",
        "Priority performance improvement actions.",
        "Action plan connecting people development to business outcomes."
      ],
      "bestFor": "Organizations, business units, teams, and functions with defined performance priorities",
      "engagementFormat": "Journey / Transformation",
      "duration": "3–6 months configurable",
      "capacity": "Scope-dependent",
      "serviceBrand": "BinaWorks / BinaImpact"
    },
    "public_content_id": {
      "tagline": "Hubungkan Kapabilitas Manusia dengan Kinerja Bisnis.",
      "learningObjectives": [
        "Menghubungkan kapabilitas manusia dengan prioritas kinerja.",
        "Memperkuat disiplin pelaksanaan dan akuntabilitas.",
        "Mengidentifikasi kesenjangan kapabilitas dan kinerja.",
        "Menerjemahkan pengembangan menjadi tindakan yang relevan bagi bisnis."
      ],
      "contentOutline": [
        "Penyelarasan dan prioritas kinerja.",
        "Hubungan kapabilitas dengan kinerja.",
        "Disiplin pelaksanaan dan akuntabilitas.",
        "Praktik peningkatan kinerja.",
        "Tindakan, tinjauan, dan penguatan."
      ],
      "outputs": [
        "Pemahaman tentang kesenjangan kinerja dan kapabilitas.",
        "Tindakan peningkatan kinerja yang diprioritaskan.",
        "Rencana tindakan yang menghubungkan pengembangan orang dengan hasil bisnis."
      ],
      "bestFor": "Organisasi, unit bisnis, tim, dan fungsi dengan prioritas kinerja yang jelas",
      "engagementFormat": "Perjalanan / Transformasi",
      "duration": "3–6 bulan, dapat disesuaikan",
      "capacity": "Bergantung pada cakupan",
      "serviceBrand": "BinaWorks / BinaImpact"
    }
  },
  {
    "code": "SS-24",
    "name": "AI-Ready Organization",
    "public_content": {
      "tagline": "Prepare People for an AI-Enabled Workplace.",
      "learningObjectives": [
        "Assess and build organizational AI readiness.",
        "Strengthen human-AI collaboration.",
        "Build responsible AI adoption.",
        "Redesign work and capabilities where appropriate."
      ],
      "contentOutline": [
        "AI readiness and adoption.",
        "Human-AI collaboration.",
        "Responsible AI and governance awareness.",
        "Work redesign and workflow opportunities.",
        "Capability building and change adoption."
      ],
      "outputs": [
        "AI readiness insights and priority areas.",
        "Practical adoption/use-case roadmap.",
        "Capability and change actions for an AI-enabled workplace."
      ],
      "bestFor": "Organizations planning or scaling AI adoption and AI-enabled ways of working",
      "engagementFormat": "Program / Journey / Transformation",
      "duration": "3–6 months configurable",
      "capacity": "Scope-dependent",
      "serviceBrand": "BinaWorks / BinaAcademy / BinaInsights"
    },
    "public_content_id": {
      "tagline": "Siapkan Orang untuk Tempat Kerja Berdaya AI.",
      "learningObjectives": [
        "Menilai dan membangun kesiapan organisasi terhadap AI.",
        "Memperkuat kolaborasi manusia dengan AI.",
        "Membangun adopsi AI yang bertanggung jawab.",
        "Merancang ulang pekerjaan dan kapabilitas jika sesuai."
      ],
      "contentOutline": [
        "Kesiapan dan adopsi AI.",
        "Kolaborasi manusia dengan AI.",
        "AI yang bertanggung jawab dan kesadaran tata kelola.",
        "Perancangan ulang pekerjaan dan peluang alur kerja.",
        "Pengembangan kapabilitas dan adopsi perubahan."
      ],
      "outputs": [
        "Pemahaman tentang kesiapan AI dan area prioritas.",
        "Peta jalan adopsi dan kasus penggunaan yang praktis.",
        "Tindakan kapabilitas dan perubahan untuk tempat kerja berdaya AI."
      ],
      "bestFor": "Organisasi yang merencanakan atau memperluas adopsi AI dan cara kerja berdaya AI",
      "engagementFormat": "Program / Perjalanan / Transformasi",
      "duration": "3–6 bulan, dapat disesuaikan",
      "capacity": "Bergantung pada cakupan",
      "serviceBrand": "BinaWorks / BinaAcademy / BinaInsights"
    }
  },
  {
    "code": "SS-25",
    "name": "Future-Ready Organization",
    "public_content": {
      "tagline": "Build Capability for What Comes Next.",
      "learningObjectives": [
        "Strengthen organizational future readiness.",
        "Build capability strategy and adaptability.",
        "Develop learning and workforce capability.",
        "Improve strategic preparedness for emerging needs."
      ],
      "contentOutline": [
        "Future readiness and capability strategy.",
        "Workforce capability and critical skills.",
        "Adaptability and learning culture.",
        "Strategic preparedness and scenario thinking.",
        "Capability priorities and development pathways."
      ],
      "outputs": [
        "Future capability priorities and gap insights.",
        "Strategic capability roadmap.",
        "Recommended development and transformation actions."
      ],
      "bestFor": "Organizations preparing for strategic shifts, capability gaps, or future workforce needs",
      "engagementFormat": "Journey / Transformation",
      "duration": "3–12 months configurable",
      "capacity": "Scope-dependent",
      "serviceBrand": "BinaInsights / BinaAcademy / BinaWorks"
    },
    "public_content_id": {
      "tagline": "Bangun Kapabilitas untuk Tantangan Berikutnya.",
      "learningObjectives": [
        "Memperkuat kesiapan organisasi menghadapi masa depan.",
        "Membangun strategi kapabilitas dan kemampuan adaptasi.",
        "Mengembangkan pembelajaran dan kapabilitas tenaga kerja.",
        "Meningkatkan kesiapan strategis terhadap kebutuhan yang muncul."
      ],
      "contentOutline": [
        "Kesiapan masa depan dan strategi kapabilitas.",
        "Kapabilitas tenaga kerja dan keterampilan kritis.",
        "Kemampuan adaptasi dan budaya belajar.",
        "Kesiapan strategis dan pemikiran skenario.",
        "Prioritas kapabilitas dan jalur pengembangan."
      ],
      "outputs": [
        "Prioritas kapabilitas masa depan dan pemahaman tentang kesenjangan.",
        "Peta jalan kapabilitas strategis.",
        "Rekomendasi tindakan pengembangan dan transformasi."
      ],
      "bestFor": "Organisasi yang bersiap menghadapi pergeseran strategis, kesenjangan kapabilitas, atau kebutuhan tenaga kerja masa depan",
      "engagementFormat": "Perjalanan / Transformasi",
      "duration": "3–12 bulan, dapat disesuaikan",
      "capacity": "Bergantung pada cakupan",
      "serviceBrand": "BinaInsights / BinaAcademy / BinaWorks"
    }
  },
  {
    "code": "SS-26",
    "name": "Impact Measurement & Transformation Review",
    "public_content": {
      "tagline": "Measure. Learn. Improve. Demonstrate Impact.",
      "learningObjectives": [
        "Review whether transformation objectives are being achieved.",
        "Identify strong, incomplete, or inconsistent areas.",
        "Surface intended-versus-observed gaps using evidence.",
        "Prioritize next actions and improvement opportunities."
      ],
      "contentOutline": [
        "Review of objectives, interventions, and evidence.",
        "Assessment and structured audit/review.",
        "Diagnosis of gaps, strengths, and inconsistencies.",
        "Prioritization of next actions.",
        "Learning and recommendations."
      ],
      "outputs": [
        "Transformation Health Map: 🟢 Established / OK; 🟡 Partial / Inconsistent; 🔴 Needs Attention.",
        "Priority areas and evidence-based insights.",
        "Recommended actions and next intervention.",
        "Review discussion and agreed next steps."
      ],
      "bestFor": "Organizations that have completed or are running a transformation, learning, culture, leadership, or capability initiative",
      "engagementFormat": "Program / Journey",
      "duration": "1–2 days + optional 1–3 month follow-up",
      "capacity": "Scope-dependent",
      "serviceBrand": "BinaImpact",
      "notes": "Status colors are a communication device, not a generic score or certification; criteria are agreed with the client and tied to objectives."
    },
    "public_content_id": {
      "tagline": "Ukur. Pelajari. Perbaiki. Tunjukkan Dampak.",
      "learningObjectives": [
        "Meninjau apakah tujuan transformasi tercapai.",
        "Mengidentifikasi area yang kuat, belum lengkap, atau tidak konsisten.",
        "Mengungkap kesenjangan antara niat dan hasil yang diamati berdasarkan bukti.",
        "Memprioritaskan langkah berikutnya dan peluang perbaikan."
      ],
      "contentOutline": [
        "Tinjauan tujuan, intervensi, dan bukti.",
        "Asesmen serta audit atau tinjauan terstruktur.",
        "Diagnosis kesenjangan, kekuatan, dan ketidakkonsistenan.",
        "Penentuan prioritas tindakan berikutnya.",
        "Pembelajaran dan rekomendasi."
      ],
      "outputs": [
        "Peta Kesehatan Transformasi: 🟢 Terbentuk / Baik; 🟡 Sebagian / Tidak Konsisten; 🔴 Perlu Perhatian.",
        "Area prioritas dan pemahaman berbasis bukti.",
        "Rekomendasi tindakan dan intervensi berikutnya.",
        "Diskusi tinjauan dan langkah berikutnya yang disepakati."
      ],
      "bestFor": "Organisasi yang telah menyelesaikan atau sedang menjalankan inisiatif transformasi, pembelajaran, budaya, kepemimpinan, atau kapabilitas",
      "engagementFormat": "Program / Perjalanan",
      "duration": "1–2 hari dengan tindak lanjut opsional 1–3 bulan",
      "capacity": "Bergantung pada cakupan",
      "notes": "Warna status adalah alat komunikasi, bukan skor umum atau sertifikasi; kriteria disepakati dengan klien dan dikaitkan dengan tujuan.",
      "serviceBrand": "BinaImpact"
    }
  },
  {
    "code": "SS-27",
    "name": "Spiritual Leadership Journey",
    "public_content": {
      "tagline": "Elevating Leadership, Beyond the Limit.",
      "learningObjectives": [
        "Develop reflective and purposeful leadership.",
        "Strengthen spiritual awareness and personal accountability.",
        "Translate reflection into sustained leadership behavior.",
        "Build disciplined practices for personal transformation."
      ],
      "contentOutline": [
        "Muhasabah — reflection and self-awareness.",
        "Niyyah — purpose and intention.",
        "Mujahadah — disciplined effort and growth.",
        "Istiqamah — consistency and sustained practice.",
        "Personal Transformation Project and leadership application."
      ],
      "outputs": [
        "A structured 90-day personal transformation journey.",
        "Personal reflection and leadership commitments.",
        "Personal Transformation Project.",
        "Sustained practice plan for after the journey."
      ],
      "bestFor": "Leaders, Muslim professionals, and Syariah-based organizations",
      "engagementFormat": "Journey",
      "duration": "Fixed 90 days",
      "capacity": "Configurable / scope-dependent",
      "serviceBrand": "BinaJourney / BinaCoach",
      "notes": "Sequence: Muhasabah → Niyyah → Mujahadah → Istiqamah."
    },
    "public_content_id": {
      "tagline": "Mengangkat Kepemimpinan Melampaui Batas.",
      "learningObjectives": [
        "Mengembangkan kepemimpinan yang reflektif dan bertujuan.",
        "Memperkuat kesadaran spiritual dan akuntabilitas pribadi.",
        "Menerjemahkan refleksi menjadi perilaku kepemimpinan yang berkelanjutan.",
        "Membangun praktik disiplin untuk transformasi diri."
      ],
      "contentOutline": [
        "Muhasabah — refleksi dan kesadaran diri.",
        "Niyyah — tujuan dan niat.",
        "Mujahadah — upaya disiplin dan pertumbuhan.",
        "Istiqamah — konsistensi dan praktik berkelanjutan.",
        "Proyek Transformasi Diri dan penerapan kepemimpinan."
      ],
      "outputs": [
        "Perjalanan transformasi diri yang terstruktur selama 90 hari.",
        "Refleksi pribadi dan komitmen kepemimpinan.",
        "Proyek Transformasi Diri.",
        "Rencana praktik berkelanjutan setelah perjalanan."
      ],
      "bestFor": "Pemimpin, profesional Muslim, dan organisasi berbasis Syariah",
      "engagementFormat": "Perjalanan",
      "duration": "Tetap 90 hari",
      "capacity": "Dapat disesuaikan / bergantung pada cakupan",
      "notes": "Urutan: Muhasabah → Niyyah → Mujahadah → Istiqamah.",
      "serviceBrand": "BinaJourney / BinaCoach"
    }
  }
]$catalog$::jsonb)
    as entry(code text, name text, public_content jsonb, public_content_id jsonb)
)
update public.catalog_modules module
set metadata = coalesce(module.metadata, '{}'::jsonb) || jsonb_build_object(
      'localized', coalesce(module.metadata->'localized', '{}'::jsonb)
        || jsonb_build_object('en', coalesce(module.metadata->'localized'->'en', '{}'::jsonb)
          || jsonb_build_object('name', source.name, 'summary', source.public_content->>'tagline')
          || source.public_content,
          'id', coalesce(module.metadata->'localized'->'id', '{}'::jsonb)
          || jsonb_build_object('summary', source.public_content_id->>'tagline')
          || source.public_content_id)
    ),
    standard_scope = array_to_string(
      array(select jsonb_array_elements_text(source.public_content_id->'contentOutline')), E'\n'
    ),
    deliverables = array_to_string(
      array(select jsonb_array_elements_text(source.public_content_id->'outputs')), E'\n'
    ),
    duration_label = source.public_content_id->>'duration',
    readiness_status = 'ready',
    active = true,
    public_visible = true,
    published_at = coalesce(module.published_at, now())
from source
where module.module_code = source.code
  and module.catalog_version = 'signature-2026-ceo-v1'
  and module.is_mock = false;

update public.catalog_products product
set status = 'ready',
    public_visible = true,
    published_at = coalesce(product.published_at, now())
where product.product_key in (
  'signature-self', 'signature-team', 'signature-organization', 'signature-specialized'
);

commit;
