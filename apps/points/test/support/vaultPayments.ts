interface Page {
  readonly payments: ReadonlyArray<unknown>;
  readonly through: number;
  readonly total: number;
  readonly next: number | null;
}

/** @throws {never} */
export function slopCash(answer: (url: URL, call: number) => Response) {
  const urls: string[] = [];
  let calls = 0;
  /** @throws {never} */
  const fetch = (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    urls.push(url.href);
    calls += 1;
    return Promise.resolve(answer(url, calls));
  };
  return { fetch, urls };
}

export function page(body: Page) {
  return Response.json(body);
}

export function unavailablePaymentPage() {
  return new Response("Unavailable", { status: 503 });
}
