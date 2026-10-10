-- 0063: CEO competency dictionary and module-level mapping only.
-- Requires catalog SS-01..SS-27 from SQL 59. Does NOT change questions,
-- scoring, public catalog, prices, proposal policy, legacy TBOS, or enable payments.
-- Source SHA-256: e54dc6d810a79b682ad9b92a0494472571105bdeba8a25b30e9430b68e04349d
begin;

create table if not exists public.competency_frameworks (
  id text primary key,
  source_file text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  measurement_status text not null default 'awaiting_ceo_kpi_and_questions'
    check (measurement_status in ('awaiting_ceo_kpi_and_questions', 'draft', 'approved')),
  created_at timestamptz not null default now()
);

create table if not exists public.competency_dictionary (
  framework_id text not null references public.competency_frameworks(id) on delete restrict,
  code text not null check (code ~ '^COMP-[0-9]{3}$'),
  name text not null check (btrim(name) <> ''),
  definition text,
  behavioral_indicators jsonb not null default '[]'::jsonb
    check (jsonb_typeof(behavioral_indicators) = 'array'
      and not jsonb_path_exists(behavioral_indicators, '$[*] ? (@.type() != "string")')),
  kpi_source_version text,
  content_status text not null default 'awaiting_ceo'
    check (content_status in ('awaiting_ceo', 'draft', 'approved')),
  created_at timestamptz not null default now(),
  primary key (framework_id, code),
  unique (framework_id, name),
  check (content_status <> 'approved' or (
    nullif(btrim(definition), '') is not null
    and nullif(btrim(kpi_source_version), '') is not null
    and jsonb_array_length(behavioral_indicators) > 0
  ))
);

create table if not exists public.catalog_module_competencies (
  framework_id text not null,
  module_id uuid not null references public.catalog_modules(id) on delete restrict,
  competency_code text not null,
  role text not null check (role in ('core', 'secondary')),
  display_order integer not null check (display_order > 0),
  source_solution_title text not null,
  primary key (framework_id, module_id, competency_code),
  foreign key (framework_id, competency_code)
    references public.competency_dictionary(framework_id, code) on delete restrict,
  unique (framework_id, module_id, role, display_order)
);

create index if not exists catalog_module_competencies_lookup
  on public.catalog_module_competencies(framework_id, competency_code);

alter table public.competency_frameworks enable row level security;
alter table public.competency_dictionary enable row level security;
alter table public.catalog_module_competencies enable row level security;
revoke all on public.competency_frameworks, public.competency_dictionary,
  public.catalog_module_competencies from public, anon, authenticated;
grant select, insert, update, delete on public.competency_frameworks,
  public.competency_dictionary, public.catalog_module_competencies to service_role;
-- Access is through the admin-authenticated API; no public RLS policy.

create temporary table competency_seed (payload jsonb) on commit drop;
insert into competency_seed values ($competency_catalog$
{
  "frameworkId": "signature-2026-competency-v1",
  "sourceFile": "BinaHub_Signature_Solutions_Catalog_DETAILED_2026_REVISED_COMPETENCY.docx",
  "sourceSha256": "e54dc6d810a79b682ad9b92a0494472571105bdeba8a25b30e9430b68e04349d",
  "competencyCodeAuthority": "Internal stable identifiers; official names are preserved from the CEO catalog.",
  "measurementStatus": "awaiting_ceo_kpi_and_questions",
  "competencies": [
    {
      "code": "COMP-001",
      "name": "Adaptasi"
    },
    {
      "code": "COMP-002",
      "name": "Agen Perubahan"
    },
    {
      "code": "COMP-003",
      "name": "Berorientasi kepada Kualitas"
    },
    {
      "code": "COMP-004",
      "name": "Bimbingan"
    },
    {
      "code": "COMP-005",
      "name": "Delegasi"
    },
    {
      "code": "COMP-006",
      "name": "Inisiatif"
    },
    {
      "code": "COMP-007",
      "name": "Integritas"
    },
    {
      "code": "COMP-008",
      "name": "Kegigihan & Tahan Banting"
    },
    {
      "code": "COMP-009",
      "name": "Kerjasama"
    },
    {
      "code": "COMP-010",
      "name": "Kesan Positif"
    },
    {
      "code": "COMP-011",
      "name": "Komunikasi"
    },
    {
      "code": "COMP-012",
      "name": "Membangun Hubungan Baik"
    },
    {
      "code": "COMP-013",
      "name": "Membangun Kepercayaan"
    },
    {
      "code": "COMP-014",
      "name": "Membangun Loyalitas Pelanggan"
    },
    {
      "code": "COMP-015",
      "name": "Membangun Tim yang Sukses"
    },
    {
      "code": "COMP-016",
      "name": "Memimpin Rapat"
    },
    {
      "code": "COMP-017",
      "name": "Memimpin Visi & Nilai-Nilai Islam"
    },
    {
      "code": "COMP-018",
      "name": "Mengambil Resiko"
    },
    {
      "code": "COMP-019",
      "name": "Mengelola Pekerjaan"
    },
    {
      "code": "COMP-020",
      "name": "Mengelola Tekanan"
    },
    {
      "code": "COMP-021",
      "name": "Mengembangkan Orang Lain"
    },
    {
      "code": "COMP-022",
      "name": "Menginspirasi Orang Lain"
    },
    {
      "code": "COMP-023",
      "name": "Pembuatan Keputusan"
    },
    {
      "code": "COMP-024",
      "name": "Pengembangan Diri"
    },
    {
      "code": "COMP-025",
      "name": "Public Speaking"
    },
    {
      "code": "COMP-026",
      "name": "Tindak Lanjut"
    }
  ],
  "solutions": [
    {
      "moduleCode": "SS-01",
      "title": "Emotional Intelligence",
      "core": [
        "COMP-012",
        "COMP-013",
        "COMP-020"
      ],
      "secondary": [
        "COMP-011",
        "COMP-010",
        "COMP-009",
        "COMP-024"
      ]
    },
    {
      "moduleCode": "SS-02",
      "title": "Professional Excellence",
      "core": [
        "COMP-007",
        "COMP-003",
        "COMP-019"
      ],
      "secondary": [
        "COMP-026",
        "COMP-006",
        "COMP-008",
        "COMP-024"
      ]
    },
    {
      "moduleCode": "SS-03",
      "title": "Personal Productivity & Effectiveness",
      "core": [
        "COMP-019",
        "COMP-026",
        "COMP-006"
      ],
      "secondary": [
        "COMP-003",
        "COMP-008",
        "COMP-024"
      ]
    },
    {
      "moduleCode": "SS-04",
      "title": "Communication & Presentation",
      "core": [
        "COMP-011",
        "COMP-025",
        "COMP-010"
      ],
      "secondary": [
        "COMP-012",
        "COMP-013",
        "COMP-016"
      ]
    },
    {
      "moduleCode": "SS-05",
      "title": "Service Excellence",
      "core": [
        "COMP-014",
        "COMP-011",
        "COMP-003"
      ],
      "secondary": [
        "COMP-012",
        "COMP-013",
        "COMP-010",
        "COMP-007"
      ]
    },
    {
      "moduleCode": "SS-06",
      "title": "Problem Solving, Decision Making, & Innovation",
      "core": [
        "COMP-023",
        "COMP-006",
        "COMP-018"
      ],
      "secondary": [
        "COMP-001",
        "COMP-002",
        "COMP-003",
        "COMP-008"
      ]
    },
    {
      "moduleCode": "SS-07",
      "title": "First-Time Leader",
      "core": [
        "COMP-005",
        "COMP-004",
        "COMP-021"
      ],
      "secondary": [
        "COMP-015",
        "COMP-011",
        "COMP-026",
        "COMP-022"
      ]
    },
    {
      "moduleCode": "SS-08",
      "title": "Adaptive Leadership",
      "core": [
        "COMP-001",
        "COMP-002",
        "COMP-023"
      ],
      "secondary": [
        "COMP-018",
        "COMP-020",
        "COMP-011",
        "COMP-022",
        "COMP-008"
      ]
    },
    {
      "moduleCode": "SS-09",
      "title": "AI-Powered Professional",
      "core": [
        "COMP-001",
        "COMP-006",
        "COMP-024"
      ],
      "secondary": [
        "COMP-023",
        "COMP-018",
        "COMP-003",
        "COMP-019"
      ]
    },
    {
      "moduleCode": "SS-10",
      "title": "BinaCoach: Growth, Performance & Wellbeing Coaching",
      "core": [
        "COMP-021",
        "COMP-004",
        "COMP-024"
      ],
      "secondary": [
        "COMP-013",
        "COMP-012",
        "COMP-026",
        "COMP-020",
        "COMP-022"
      ]
    },
    {
      "moduleCode": "SS-11",
      "title": "Team Building",
      "core": [
        "COMP-009",
        "COMP-013",
        "COMP-015"
      ],
      "secondary": [
        "COMP-012",
        "COMP-011",
        "COMP-010",
        "COMP-007"
      ]
    },
    {
      "moduleCode": "SS-12",
      "title": "Trust & Psychological Safety",
      "core": [
        "COMP-013",
        "COMP-011",
        "COMP-012"
      ],
      "secondary": [
        "COMP-009",
        "COMP-010",
        "COMP-007"
      ]
    },
    {
      "moduleCode": "SS-13",
      "title": "Team Synergy",
      "core": [
        "COMP-009",
        "COMP-015",
        "COMP-023"
      ],
      "secondary": [
        "COMP-005",
        "COMP-011",
        "COMP-012",
        "COMP-026"
      ]
    },
    {
      "moduleCode": "SS-14",
      "title": "Empathy Experience",
      "core": [
        "COMP-012",
        "COMP-013",
        "COMP-010"
      ],
      "secondary": [
        "COMP-011",
        "COMP-009",
        "COMP-014"
      ]
    },
    {
      "moduleCode": "SS-15",
      "title": "High Performing Team",
      "core": [
        "COMP-015",
        "COMP-003",
        "COMP-026"
      ],
      "secondary": [
        "COMP-009",
        "COMP-019",
        "COMP-007",
        "COMP-013"
      ]
    },
    {
      "moduleCode": "SS-16",
      "title": "Team Agility",
      "core": [
        "COMP-001",
        "COMP-009",
        "COMP-002"
      ],
      "secondary": [
        "COMP-006",
        "COMP-018",
        "COMP-008"
      ]
    },
    {
      "moduleCode": "SS-17",
      "title": "Leading the Team",
      "core": [
        "COMP-015",
        "COMP-005",
        "COMP-021"
      ],
      "secondary": [
        "COMP-004",
        "COMP-022",
        "COMP-011",
        "COMP-026"
      ]
    },
    {
      "moduleCode": "SS-18",
      "title": "Culture Activation",
      "core": [
        "COMP-017",
        "COMP-007",
        "COMP-002"
      ],
      "secondary": [
        "COMP-013",
        "COMP-022",
        "COMP-015",
        "COMP-012"
      ]
    },
    {
      "moduleCode": "SS-19",
      "title": "Change & Organizational Agility",
      "core": [
        "COMP-002",
        "COMP-001",
        "COMP-023"
      ],
      "secondary": [
        "COMP-018",
        "COMP-011",
        "COMP-013",
        "COMP-022"
      ]
    },
    {
      "moduleCode": "SS-20",
      "title": "Leadership Academy",
      "core": [
        "COMP-021",
        "COMP-004",
        "COMP-015"
      ],
      "secondary": [
        "COMP-005",
        "COMP-023",
        "COMP-022",
        "COMP-016",
        "COMP-017",
        "COMP-026"
      ]
    },
    {
      "moduleCode": "SS-21",
      "title": "Future Leaders",
      "core": [
        "COMP-024",
        "COMP-023",
        "COMP-006"
      ],
      "secondary": [
        "COMP-018",
        "COMP-001",
        "COMP-022",
        "COMP-021"
      ]
    },
    {
      "moduleCode": "SS-22",
      "title": "Internal Trainer & Facilitator Academy",
      "core": [
        "COMP-021",
        "COMP-004",
        "COMP-025"
      ],
      "secondary": [
        "COMP-011",
        "COMP-010",
        "COMP-012",
        "COMP-003",
        "COMP-024"
      ]
    },
    {
      "moduleCode": "SS-23",
      "title": "Performance Acceleration",
      "core": [
        "COMP-003",
        "COMP-019",
        "COMP-026"
      ],
      "secondary": [
        "COMP-006",
        "COMP-007",
        "COMP-008",
        "COMP-015"
      ]
    },
    {
      "moduleCode": "SS-24",
      "title": "AI-Ready Organization",
      "core": [
        "COMP-001",
        "COMP-002",
        "COMP-006"
      ],
      "secondary": [
        "COMP-023",
        "COMP-018",
        "COMP-024",
        "COMP-003"
      ]
    },
    {
      "moduleCode": "SS-25",
      "title": "Future-Ready Organization",
      "core": [
        "COMP-001",
        "COMP-002",
        "COMP-024"
      ],
      "secondary": [
        "COMP-006",
        "COMP-023",
        "COMP-018",
        "COMP-008"
      ]
    },
    {
      "moduleCode": "SS-26",
      "title": "Impact Measurement & Transformation Review",
      "core": [
        "COMP-003",
        "COMP-023",
        "COMP-026"
      ],
      "secondary": [
        "COMP-019",
        "COMP-007",
        "COMP-002"
      ]
    },
    {
      "moduleCode": "SS-27",
      "title": "Spiritual Leadership Journey",
      "core": [
        "COMP-017",
        "COMP-007",
        "COMP-024"
      ],
      "secondary": [
        "COMP-008",
        "COMP-020",
        "COMP-013",
        "COMP-022",
        "COMP-001"
      ]
    }
  ]
}
$competency_catalog$::jsonb);

-- Stop atomically rather than silently skipping missing/misidentified modules.
do $$
declare missing_codes text;
begin
  select string_agg(solution->>'moduleCode', ', ' order by solution->>'moduleCode')
    into missing_codes
    from competency_seed, jsonb_array_elements(payload->'solutions') solution
    left join public.catalog_modules module on module.module_code = solution->>'moduleCode'
    where module.id is null or module.is_mock
      or module.catalog_version <> 'signature-2026-ceo-v1';
  if missing_codes is not null then
    raise exception 'COMPETENCY_CATALOG_PREREQUISITE: run/verify SQL 59 first (%).', missing_codes;
  end if;
  if exists (
    select 1 from public.competency_frameworks framework, competency_seed seed
    where framework.id = seed.payload->>'frameworkId'
      and (framework.source_sha256 <> seed.payload->>'sourceSha256'
        or framework.source_file <> seed.payload->>'sourceFile')
  ) then
    raise exception 'COMPETENCY_SOURCE_CONFLICT: use a new framework version for a different source.';
  end if;
end $$;

insert into public.competency_frameworks (id, source_file, source_sha256)
select payload->>'frameworkId', payload->>'sourceFile', payload->>'sourceSha256'
from competency_seed
on conflict (id) do nothing;

insert into public.competency_dictionary (framework_id, code, name)
select payload->>'frameworkId', competency->>'code', competency->>'name'
from competency_seed, jsonb_array_elements(payload->'competencies') competency
on conflict (framework_id, code) do nothing;

insert into public.catalog_module_competencies
  (framework_id, module_id, competency_code, role, display_order, source_solution_title)
select payload->>'frameworkId', module.id, entry.code, roles.role, entry.position::integer,
  solution->>'title'
from competency_seed
cross join lateral jsonb_array_elements(payload->'solutions') solution
join public.catalog_modules module on module.module_code = solution->>'moduleCode'
cross join (values ('core'), ('secondary')) roles(role)
cross join lateral jsonb_array_elements_text(solution->roles.role)
  with ordinality entry(code, position)
on conflict (framework_id, module_id, competency_code) do nothing;

-- Reapplication preserves future CEO-approved definitions and does not reset their status.
commit;
