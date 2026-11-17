// spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"
import type { OwnerRequest } from "@repo/settlement/client";
import type { Attempt } from "../../../../gen/frontend__walletAttempt.ts";
import type { DirectLeg } from "./DirectBountyPayment.tsx";

const payer = "0x5a1f0c3b8e9d2a4f6c7b8d9e0f1a2b3c4d5e6f70";
const researcher = "0x7e2d4c6b8a0f1e3d5c7b9a1f3e5d7c9b1a3f5e7d";
const fee = "0x2b4d6f8a0c2e4a6c8e0a2c4e6a8c0e2a4c6e8a0c";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export const ownerRequest: OwnerRequest = {
  preparedAt: "2026-11-02T14:00:00.000Z",
  afterBlock: "23456789",
  rail: "direct",
  network: "base-mainnet",
  chain: "base",
  asset: { symbol: "USDC", decimals: 6, address: usdc },
  payer: { id: "wallet-payer", address: payer, digest: "sha256:payer" },
  recipient: { id: "wallet-researcher", address: researcher, digest: "sha256:researcher" },
  grossBase: "10000000000",
  feeBase: "2500000000",
  netBase: "7500000000",
  transfers: [
    { recipient: researcher, amountBase: "7500000000", role: "researcher" },
    { recipient: fee, amountBase: "2500000000", role: "fee" },
  ],
  transactions: [
    { from: payer, to: usdc, value: "0x0", data: `0xa9059cbb000000000000000000000000${researcher.slice(2)}00000000000000000000000000000000000000000000000000000001bf08eb00`, chainId: "0x2105", nonce: "0x7" },
    { from: payer, to: usdc, value: "0x0", data: `0xa9059cbb000000000000000000000000${fee.slice(2)}000000000000000000000000000000000000000000000000000000009502f900`, chainId: "0x2105", nonce: "0x8" },
  ],
};

export const emptyAttempt: Attempt = { identity: "", bytesId: "", hash: "", candidate: "" };

export const sentAttempt: Attempt = { identity: "4f0c2a7e-1b3d-4e5f-8a9b-0c1d2e3f4a5b", bytesId: "first", hash: "0x9c1e5a7b3d2f4e6a8c0b1d3f5e7a9c2b4d6f8e0a1c3b5d7f9e2a4c6b8d0f1e3a", candidate: "" };

export const uncertainAttempt: Attempt = { identity: "6a2b4c8d-0e1f-4a3b-9c5d-7e8f9a0b1c2d", bytesId: "second", hash: "", candidate: "" };

const researcherLeg: DirectLeg = { slot: "FirstLeg", name: "Researcher", amount: "7,500", symbol: "USDC", saved: emptyAttempt, mismatched: false };

const feeLeg: DirectLeg = { slot: "SecondLeg", name: "Slop fee", amount: "2,500", symbol: "USDC", saved: emptyAttempt, mismatched: false };

export const unsentLegs: DirectLeg[] = [researcherLeg, feeLeg];

export const uncertainLegs: DirectLeg[] = [
  { ...researcherLeg, saved: sentAttempt },
  { ...feeLeg, saved: uncertainAttempt },
];

export const solanaSignature = "DyXZZCSiBREJ8YZ5cULd7PVdKpbkhHvHJ7otbJmLJajJtRsyq1irMMqKimYeKvRmZ8Sc2qWLhKjYR4ekM8RSzkV";

export const savedSolana: Attempt = { identity: "3d5e7f9a-1b2c-4d4e-8f6a-7b8c9d0e1f2a", bytesId: "prepared-transaction", hash: solanaSignature, candidate: "" };

export const uncertainSolana: Attempt = { ...savedSolana, hash: "" };

export const submittedHashes = ["0x9c1e5a7b3d2f4e6a8c0b1d3f5e7a9c2b4d6f8e0a1c3b5d7f9e2a4c6b8d0f1e3a", ""];

export const wallets = [{ id: "1", name: "Rabby" }];

export const solanaWallets = [{ id: "2", name: "Phantom" }];
