-- Enforce one completed observation per program/team/mission and synchronize
-- every behavioral rubric with the CEO-approved observation brief.

begin;

do $$
declare
  v_duplicate_groups integer;
begin
  select count(*)
    into v_duplicate_groups
  from (
    select program_id, team_id, mission_id
    from public.tbos_observations
    group by program_id, team_id, mission_id
    having count(*) > 1
  ) duplicates;

  if v_duplicate_groups > 0 then
    raise exception using
      errcode = '23505',
      message = format(
        '%s duplicate T-BOS team/mission observation group(s) exist. Review them before applying migration 0018.',
        v_duplicate_groups
      );
  end if;
end;
$$;

create unique index if not exists tbos_observations_program_team_mission_unique
  on public.tbos_observations (program_id, team_id, mission_id);

with approved_levels(dimension_code, level_value, level_label, description) as (
  values
    ('goal_alignment', 1, 'Reactive', 'Langsung bekerja tanpa diskusi.'),
    ('goal_alignment', 2, 'Emerging', 'Diskusi singkat tetapi belum menghasilkan arah yang jelas.'),
    ('goal_alignment', 3, 'Functional', 'Menentukan tujuan bersama sebelum mulai bekerja.'),
    ('goal_alignment', 4, 'Effective', 'Menentukan tujuan dan strategi pelaksanaan.'),
    ('goal_alignment', 5, 'Exemplary', 'Menentukan tujuan, strategi, pembagian peran, serta contingency plan.'),
    ('communication', 1, 'Reactive', 'Banyak miskomunikasi dan informasi tidak tersampaikan.'),
    ('communication', 2, 'Emerging', 'Informasi hanya berputar pada beberapa anggota.'),
    ('communication', 3, 'Functional', 'Informasi mengalir tetapi belum konsisten.'),
    ('communication', 4, 'Effective', 'Komunikasi jelas, dua arah, dan saling memperbarui.'),
    ('communication', 5, 'Exemplary', 'Seluruh anggota aktif berbagi informasi secara real-time.'),
    ('data_based_decision', 1, 'Reactive', 'Keputusan berdasarkan tebakan.'),
    ('data_based_decision', 2, 'Emerging', 'Keputusan berdasarkan asumsi.'),
    ('data_based_decision', 3, 'Functional', 'Sebagian keputusan menggunakan data yang tersedia.'),
    ('data_based_decision', 4, 'Effective', 'Mayoritas keputusan menggunakan data dan informasi.'),
    ('data_based_decision', 5, 'Exemplary', 'Semua keputusan dibuat berdasarkan fakta, data, dan evaluasi alternatif.'),
    ('execution_discipline', 1, 'Reactive', 'Banyak pekerjaan tidak selesai.'),
    ('execution_discipline', 2, 'Emerging', 'Target selesai tetapi terburu-buru.'),
    ('execution_discipline', 3, 'Functional', 'Target selesai sesuai ketentuan.'),
    ('execution_discipline', 4, 'Effective', 'Target selesai dan dilakukan pengecekan.'),
    ('execution_discipline', 5, 'Exemplary', 'Target selesai, diverifikasi, dan siap digunakan oleh tim/proses berikutnya.'),
    ('accountability', 1, 'Reactive', 'Saling menyalahkan.'),
    ('accountability', 2, 'Emerging', 'Menunggu arahan fasilitator.'),
    ('accountability', 3, 'Functional', 'Bertanggung jawab terhadap tugas masing-masing.'),
    ('accountability', 4, 'Effective', 'Bertanggung jawab terhadap hasil tim.'),
    ('accountability', 5, 'Exemplary', 'Proaktif mengambil kepemilikan dan segera menyelesaikan masalah.'),
    ('adaptability', 1, 'Reactive', 'Bingung dan kehilangan arah.'),
    ('adaptability', 2, 'Emerging', 'Terlambat menyesuaikan.'),
    ('adaptability', 3, 'Functional', 'Menyesuaikan sebagian strategi.'),
    ('adaptability', 4, 'Effective', 'Cepat menyusun strategi baru.'),
    ('adaptability', 5, 'Exemplary', 'Langsung beradaptasi tanpa kehilangan momentum kerja.'),
    ('collaboration', 1, 'Reactive', 'Bekerja sendiri-sendiri.'),
    ('collaboration', 2, 'Emerging', 'Kerja sama masih terbatas.'),
    ('collaboration', 3, 'Functional', 'Bekerja sama ketika diperlukan.'),
    ('collaboration', 4, 'Effective', 'Aktif saling membantu selama mission.'),
    ('collaboration', 5, 'Exemplary', 'Kolaborasi sangat solid dan saling melengkapi.'),
    ('org_ownership', 1, 'Reactive', 'Menunggu mission selesai setelah target tim tercapai.'),
    ('org_ownership', 2, 'Emerging', 'Fokus pada kemenangan tim sendiri.'),
    ('org_ownership', 3, 'Functional', 'Membantu tim lain jika diminta.'),
    ('org_ownership', 4, 'Effective', 'Secara aktif menawarkan bantuan kepada tim lain.'),
    ('org_ownership', 5, 'Exemplary', 'Berinisiatif memastikan seluruh tim berhasil mencapai target organisasi.')
)
update public.tbos_dimension_levels level
set level_label = approved.level_label,
    description = approved.description
from approved_levels approved
join public.tbos_behavioral_dimensions dimension
  on dimension.code = approved.dimension_code
where level.dimension_id = dimension.id
  and level.level_value = approved.level_value;

commit;
