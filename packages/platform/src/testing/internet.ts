// spec/contributor/artifactTransport.md, "Each request carries a credential only at the GitHub authority"
import { Response } from "miniflare";
import type { Handler } from "../testing.ts";

export type { Handler } from "../testing.ts";

export interface Outbound {
  readonly method: string;
  readonly url: string;
  readonly host: string;
}

export interface InternetOptions {
  readonly github?: Handler;
  readonly providers?: Handler;
  readonly quotes?: Handler;
  readonly rpc?: Readonly<Record<string, Handler>>;
  readonly hosts?: Readonly<Record<string, Handler>>;
}

export interface Internet {
  readonly handler: Handler;
  readonly requests: ReadonlyArray<Outbound>;
  readonly unexpected: ReadonlyArray<Outbound>;
}

export const githubHosts = ["api.github.com", "github.com", "raw.githubusercontent.com"] as const;
export const providerHosts = ["api.surplusintelligence.ai", "api.orbio.so"] as const;
export const quoteHosts = ["aggregator-api.kyberswap.com", "api.jup.ag", "lite-api.jup.ag", "dln.debridge.finance"] as const;

/** @throws {never} */
export function internet(options: InternetOptions = {}): Internet {
  const requests: Outbound[] = [];
  const unexpected: Outbound[] = [];
  const named = new Map<string, Handler>(Object.entries(options.hosts ?? {}));
  const serve = (hosts: ReadonlyArray<string>, handle: Handler | undefined) => {
    if (handle !== undefined) for (const host of hosts) if (!named.has(host)) named.set(host, handle);
  };
  serve(githubHosts, options.github);
  serve(providerHosts, options.providers);
  serve(quoteHosts, options.quotes);
  const rpc = Object.entries(options.rpc ?? {});
  return {
    requests,
    unexpected,
    handler: (request) => {
      const url = new URL(request.url);
      const seen = { method: request.method, url: request.url, host: url.host };
      requests.push(seen);
      const handle = rpc.find(([prefix]) => request.url.startsWith(prefix))?.[1] ?? named.get(url.host);
      if (handle !== undefined) return handle(request);
      unexpected.push(seen);
      return new Response(`no fake answers ${url.host}`, { status: 599 });
    },
  };
}
