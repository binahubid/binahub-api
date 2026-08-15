type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function collectAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; maxRows?: number } = {},
) {
  const pageSize = options.pageSize ?? 1000;
  const maxRows = options.maxRows ?? 50_000;
  const rows: T[] = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }

  throw new Error(`Jumlah data melebihi batas export/agregasi ${maxRows.toLocaleString("id-ID")} baris.`);
}
