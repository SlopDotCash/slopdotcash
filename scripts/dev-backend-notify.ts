/**
 * Local stand-in for the private notify service, so the Inbox email preference
 * page works on localhost. It reports the signed-in account's GitHub no-reply
 * address as the verified destination. No email is ever sent.
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
      const email = `${login(body.githubId) ?? `user-${body.githubId}`}@users.noreply.github.com`;
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
