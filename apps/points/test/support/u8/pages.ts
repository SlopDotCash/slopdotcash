// spec/points/ingestion.md, "A multi-part leaderboard is read as one content-addressed generation"

export interface Publication {
  readonly root: Uint8Array;
  readonly parts: ReadonlyArray<{ readonly path: string; readonly bytes: Uint8Array }>;
}

export interface PagesOptions {
  readonly replaceAfter?: { readonly path: string; readonly next: Publication };
  readonly answer?: { readonly path: string; readonly status: number; readonly body: string | null };
}

export interface PagesOrigin {
  readonly fetch: typeof globalThis.fetch;
  readonly origins: string[];
  readonly paths: string[];
  readonly roots: string[];
  /** @throws {never} */
  missingParts(): number;
}

/** @throws {never} */
export function pagesOrigin(initial: Publication, options: PagesOptions = {}): PagesOrigin {
  let active = initial;
  let missing = 0;
  const origins: string[] = [];
  const paths: string[] = [];
  const roots: string[] = [];
  const answer = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    origins.push(url.origin);
    paths.push(url.pathname);
    if (options.answer !== undefined && options.answer.path === url.pathname) return new Response(options.answer.body, { status: options.answer.status });
    if (url.pathname === "/data/leaderboard.json") {
      roots.push(url.searchParams.get("snapshot") ?? "");
      return new Response(active.root.slice());
    }
    const part = active.parts.find((candidate) => candidate.path === url.pathname);
    if (options.replaceAfter !== undefined && url.pathname === options.replaceAfter.path) active = options.replaceAfter.next;
    if (part === undefined) {
      missing += 1;
      return new Response(null, { status: 404 });
    }
    return new Response(part.bytes.slice());
  };
  return { fetch: answer as typeof globalThis.fetch, origins, paths, roots, missingParts: () => missing };
}

/** @throws {never} */
export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** @throws {never} */
export function largeJson(fill: string, label: string): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify({ retained: fill.repeat(Math.ceil((26 * 1024 * 1024) / fill.length)), label })}\n`);
}
