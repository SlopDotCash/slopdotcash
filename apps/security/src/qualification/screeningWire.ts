// spec/security/screening.md, "The fixed private route treats missing and partial provider evidence as unavailable"
import type { AnalysisInput } from "../analysis/prompts.ts";

export const screeningEndpoint = "https://api.surplusintelligence.ai/anthropic/v1/messages";
export const screeningModel = "claude-sonnet-5.5";
export const maximumMicroUsd = 1_000_000;
export const maximumAttempts = 3;
export const totalMaximumMicroUsd = maximumMicroUsd * maximumAttempts;
export const outputTokens = 1024;
export const attemptTimeoutMs = 55_000;
export const backoffMs: ReadonlyArray<number> = [2_000, 5_000];
const maximumRequestBytes = 16_384;
const microUsdPerMillionTokens = { input: 2_000_000n, cacheWrite: 2_500_000n, cacheRead: 100_000n, output: 10_000_000n };

export type WireStop = "dry-run" | "request-bound" | "price-bound" | "total-over-budget";

export interface WireGate {
  stop: WireStop | undefined;
  sent: boolean;
}

const demoVault = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DemoVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(address account, uint256 amount) public virtual {
        require(balances[account] >= amount, "balance");
        balances[account] -= amount;
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent, "transfer");
    }
}
`;

export const syntheticReport: AnalysisInput = {
  report: {
    summary: "Included DemoVault.sol lets Bob withdraw Alice's deposit",
    description:
      "Public synthetic qualification only; no deployed target or real funds. " +
      "The complete affected Solidity component is included below. " +
      "The local EVM test deploys DemoVault, gives Alice 100 wei and Bob 0, " +
      "then Alice calls deposit with value 100. Bob calls withdraw(Alice, 100). " +
      "The call succeeds: balances[Alice] is 0, Bob's balance is 100, and " +
      "the vault balance is 0. The test asserts all three outcomes. " +
      "withdraw selects the debited account from caller input but transfers " +
      "its funds to msg.sender without checking that caller owns that account. " +
      "A second local EVM test adds require(msg.sender == account) before " +
      "the same body. Bob's call then reverts, Alice's deposit remains 100, " +
      "and Bob receives nothing. Both tests pass with Solidity 0.8.28.\n\n" +
      demoVault,
    severity: null,
    cvss: null,
    cweIds: ["CWE-862"],
    packages: [],
  },
  scope: null,
  priorCases: [],
};

/** @throws {never} */
export function priceBoundMicroUsd(bytes: number): number {
  const tokens = BigInt(bytes);
  const micro = tokens * microUsdPerMillionTokens.input + tokens * microUsdPerMillionTokens.cacheWrite + tokens * microUsdPerMillionTokens.cacheRead + BigInt(outputTokens) * microUsdPerMillionTokens.output;
  return Number((micro + 999_999n) / 1_000_000n);
}

/** @throws {never} */
export function shortToken(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/u.test(value) ? value : null;
}

function wireOf(text: string): { readonly model?: unknown; readonly max_tokens?: unknown } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function boundedFetch(gate: WireGate, dryRun: boolean, spentMicroUsd: number, send: typeof fetch): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const stop = (reason: WireStop): never => {
      gate.stop = reason;
      throw new Error(reason);
    };
    if (request.url !== screeningEndpoint || request.method !== "POST" || gate.sent) stop("request-bound");
    const body = await request.text();
    const wire = wireOf(body);
    if (wire?.model !== screeningModel || wire.max_tokens !== outputTokens) stop("request-bound");
    const bytes = new TextEncoder().encode(body).byteLength;
    if (bytes > maximumRequestBytes) stop("request-bound");
    if (priceBoundMicroUsd(bytes) > maximumMicroUsd) stop("price-bound");
    if (spentMicroUsd + maximumMicroUsd > totalMaximumMicroUsd) stop("total-over-budget");
    if (dryRun) stop("dry-run");
    gate.sent = true;
    return send(request.url, { method: "POST", headers: request.headers, body, redirect: "manual", signal: request.signal });
  };
}
