/**
 * Local stand-in for the private notify service, so the Inbox email preference
 * page can preview consent on localhost. The UI labels this as a simulation;
 * the invalid-domain address is not a verified or deliverable destination.
 */
import { createHash } from "node:crypto";

type Lookup = (githubId: string) => string | undefined;

export function localNotify(login: Lookup) {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (
        request.method !== "POST" ||
        url.pathname !== "/v1/activity-notifications/eligibility"
      )
        return new Response("Not found", { status: 404 });
      const body = (await request.json()) as { githubId?: unknown };
      if (typeof body.githubId !== "string" || !/^\d+$/u.test(body.githubId))
        return Response.json({ error: "invalid_request" }, { status: 400 });
      const account = login(body.githubId);
      if (!account) return Response.json({ available: false });
      const email = `${account}@example.invalid`;
      return Response.json({
        available: true,
        email,
        // Changes with the address, so a renamed account must opt in again.
        destinationVersion: createHash("sha256")
          .update(`${body.githubId}:${email}`)
          .digest("hex"),
      });
    },
  };
}
