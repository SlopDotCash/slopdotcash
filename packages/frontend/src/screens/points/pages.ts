// spec/ui/pagination.md, "The page stays within the pages that exist"
import { type PageEvent, type Pages, usePagination } from "@repo/ui";

/** The pages of a list of `count` rows of `size`, starting at the requested page once the rows are known; `onPage` hears each page moved to. @throws {never} */
export function usePages(requested: number, count: number | undefined, size: number, onPage?: (page: number) => void): readonly [Pages, (event: PageEvent) => void] {
  const start = Math.max(1, Math.trunc(requested) || 1);
  const [pages, send] = usePagination({ page: start, pages: start });
  const wanted = count === undefined ? undefined : Math.max(1, Math.ceil(count / size));
  if (wanted !== undefined && pages.pages !== wanted) send({ type: "resize", count: wanted });
  const move = (event: PageEvent) => {
    send(event);
    if (event.type === "forward") onPage?.(pages.page + 1);
    if (event.type === "back") onPage?.(pages.page - 1);
  };
  return [pages, move];
}

/** The rows of the page shown. @throws {never} */
export function pageRows<T>(rows: ReadonlyArray<T>, pages: Pages, size: number): ReadonlyArray<T> {
  return rows.slice((pages.page - 1) * size, pages.page * size);
}
