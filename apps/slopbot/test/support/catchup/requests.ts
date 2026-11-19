// spec/slopbot/historicalImport.md, "Story: An administrator imports a pre-November subscription assessment once"
export function importRequest(url: string, accept: string, cookie: string | undefined, body: string): Request {
  const origin = new URL(url).origin;
  return new Request(url, {
    method: "POST",
    headers: { origin, "content-type": "application/json", accept, ...(cookie === undefined ? {} : { cookie: `__Host-slop_points=${cookie}` }) },
    body,
  });
}
