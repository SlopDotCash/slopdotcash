// spec/security/sandbox.md, "The digest check and the isolation profile precede execution"
import { Sandbox, getSandbox } from "@cloudflare/sandbox";
import type { Box, Isolation, Transport } from "../sandbox/container.vibe";

export const isolation: Isolation = { enableInternet: false, envVars: {} };

export class OfflineSandbox extends Sandbox {
  override enableInternet = isolation.enableInternet;
  override sleepAfter = "1m";
  override envVars = { ...isolation.envVars };
}

export type Runner = Parameters<typeof getSandbox<OfflineSandbox>>[0];

/** @throws {never} */
export function openSandbox(runner: Runner, id: string, transport: Transport): Box {
  return transport === "rpc" ? getSandbox(runner, id, { transport: "rpc" }) : getSandbox(runner, id);
}
