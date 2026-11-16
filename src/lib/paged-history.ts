/** One page of a public paged history read: rows plus the server's cursor. */
interface HistoryPage<T> {
  rows: T[];
  through: unknown;
  total: unknown;
  next: unknown;
}

/**
 * Reads every page of a public history whose server pins one snapshot by
 * `through` and pages forward by `after`. Rejects a moving snapshot, a
 * non-advancing cursor, duplicate rows and a row count that differs from the
 * announced total. `fetchPage` validates the rows; returning a plain array
 * accepts it as a complete legacy (unpaged) answer.
 */
export async function readCompletePages<T>(options: {
  fetchPage: (query: string) => Promise<HistoryPage<T> | T[]>;
  key: (row: T) => string;
  errors: {
    history: string;
    duplicate: string;
    count: string;
    incomplete: string;
  };
}): Promise<T[]> {
  const { errors } = options;
  const rows: T[] = [];
  const ids = new Set<string>();
  let after = 0;
  let through: number | null = null;
  let total: number | null = null;
  for (;;) {
    const page = await options.fetchPage(
      through === null ? "" : `?after=${after}&through=${through}`,
    );
    if (Array.isArray(page)) return page;
    if (
      !Number.isSafeInteger(page.through) ||
      (page.through as number) < 0 ||
      !Number.isSafeInteger(page.total) ||
      (page.total as number) < 0 ||
      page.rows.length > 100 ||
      (through !== null && page.through !== through) ||
      (total !== null && page.total !== total) ||
      (page.next !== null &&
        (page.rows.length === 0 ||
          !Number.isSafeInteger(page.next) ||
          (page.next as number) <= after ||
          (page.next as number) > (page.through as number)))
    )
      throw new Error(errors.history);
    through = page.through as number;
    total = page.total as number;
    for (const row of page.rows) {
      const id = options.key(row);
      if (ids.has(id)) throw new Error(errors.duplicate);
      ids.add(id);
      rows.push(row);
    }
    if (rows.length > total || (page.next !== null && rows.length >= total))
      throw new Error(errors.count);
    if (page.next === null) {
      if (rows.length !== total) throw new Error(errors.incomplete);
      return rows;
    }
    after = page.next as number;
  }
}
