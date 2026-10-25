/// <reference path="../workers/operator-keeper/sql.d.ts" />
/** Test-only entry. Production exports no query route, local-chain override or fault switch. */

import type { KeeperConfiguration } from "../scripts/payment-keeper/keeper";
import keeperWorker, {
  type OperatorEnvironment,
  OperatorKeeper,
} from "../workers/operator-keeper/index";

interface FixtureEnvironment extends OperatorEnvironment {
  TEST_NOW: string;
  TEST_OBSERVER: string;
  TEST_FAIL_AFTER_SIGN?: string;
  TEST_SOLANA_GENESIS?: string;
}

export class FixtureKeeper extends OperatorKeeper {
  protected override dependencies(config: KeeperConfiguration) {
    const deps = super.dependencies(config);
    const signer = deps.evmSigner;
    const env = this.env as FixtureEnvironment;
    return {
      ...deps,
      now: new Date(env.TEST_NOW),
      localChain: { solanaGenesis: env.TEST_SOLANA_GENESIS },
      ...(signer
        ? {
            evmSigner: {
              address: signer.address,
              async signTransaction(
                input: Parameters<typeof signer.signTransaction>[0],
              ) {
                // This real local HTTP await occurs after the budget SQL insert.
                // It proves that native SQL survives an async signer boundary.
                const response = await fetch(env.TEST_OBSERVER, {
                  method: "POST",
                });
                if (!response.ok) throw new Error("Fixture observer failed");
                const raw = await signer.signTransaction(input);
                if (env.TEST_FAIL_AFTER_SIGN === "yes")
                  throw new Error("Fixture interruption after local signing");
                return raw;
              },
            },
          }
        : {}),
    };
  }

  override async fetch(request: Request) {
    if (new URL(request.url).pathname === "/inspect") {
      const { sql, values = [] } = (await request.json()) as {
        sql: string;
        values?: (string | number | null)[];
      };
      return Response.json(this.store.db.query(sql).all(...values));
    }
    return super.fetch(request);
  }
}

export default {
  async fetch(request: Request, env: FixtureEnvironment) {
    const path = new URL(request.url).pathname;
    if (path === "/public")
      return Response.json({ status: (await keeperWorker.fetch()).status });
    if (path === "/scheduled") {
      try {
        await keeperWorker.scheduled({}, env);
        return new Response(null, { status: 204 });
      } catch (error) {
        return Response.json({
          scheduledError: String((error as Error).message),
        });
      }
    }
    if (!env.KEEPER_CONFIG) throw new Error("Fixture configuration missing");
    const config = JSON.parse(env.KEEPER_CONFIG) as KeeperConfiguration;
    const signer = config.network.startsWith("solana")
      ? config.signer
      : config.signer.toLowerCase();
    const stub = env.KEEPER.get(
      env.KEEPER.idFromName(JSON.stringify([config.network, signer])),
    );
    if (path === "/inspect")
      return stub.fetch(
        new Request("https://keeper.internal/inspect", request),
      );
    if (path === "/concurrent") {
      const results: unknown[] = [];
      const observedEnvironment: OperatorEnvironment = {
        ...env,
        KEEPER: {
          idFromName: (name) => env.KEEPER.idFromName(name),
          get(id) {
            return {
              async fetch(request) {
                const response = await env.KEEPER.get(id).fetch(request);
                results.push(await response.clone().json());
                return response;
              },
            };
          },
        },
      };
      // The fixture deliberately selects one missing project. Cron reports that
      // failure after the valid project runs; neither trigger may run it twice.
      const settled = await Promise.allSettled([
        keeperWorker.scheduled({}, observedEnvironment),
        keeperWorker.scheduled({}, observedEnvironment),
      ]);
      for (const result of settled) {
        if (
          result.status === "rejected" &&
          !String(result.reason).includes("unavailable work")
        )
          throw result.reason;
      }
      if (results.length !== 2)
        throw new Error("Both native cron handlers must call the object");
      return Response.json(results);
    }
    return stub.fetch(
      new Request("https://keeper.internal/tick", { method: "POST" }),
    );
  },
};
