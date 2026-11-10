/**
 * Standalone browser fixture for the direct-payment plan check (F1) and the
 * unreadable saved-request recovery (F7). The spec drives this bundle with a
 * fake EVM provider (`window.ethereum`) and a fake Wallet Standard Solana
 * wallet, plus a routed `/api/v1/project-session` that signs the viewer in
 * as githubId `12345`. Nothing here talks to a live chain or backend: the
 * valid plans are built with the same builders the server uses, the
 * tampered plans change one approved field, and the corrupt journal is a
 * literal unparseable record.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { evmDirectTransactions } from "../backend/security/direct-evm";
import { solanaAssociatedTokenAddress } from "../contracts/solana/adapter";
import { TOKEN_PROGRAM } from "../contracts/solana/token-extensions";
import {
  concat,
  createAta,
  le,
  message,
} from "../contracts/solana/transactions";
import {
  DirectBountyPayment,
  type DirectEvmTransaction,
} from "../src/DirectBountyPayment";
import { encodeBase58Bytes } from "../src/lib/base58";
import { encodeBase64 } from "../src/lib/byte-encoding";
import { SolanaBountyPayment } from "../src/SolanaBountyPayment";

type Scenario = {
  rail: "evm" | "solana";
  plan: "valid" | "tampered";
  journal: "clean" | "corrupt";
};

type FixtureWindow = Window & {
  directPaymentScenario?: Scenario;
  directPaymentPlan?: {
    sends: unknown[];
    verified: unknown[];
    ready: boolean;
  };
};

const fixtureWindow = window as FixtureWindow;
const scenario = fixtureWindow.directPaymentScenario ?? {
  rail: "evm",
  plan: "valid",
  journal: "clean",
};
if (!fixtureWindow.directPaymentPlan)
  fixtureWindow.directPaymentPlan = {
    sends: [],
    verified: [],
    ready: false,
  };
const shared = fixtureWindow.directPaymentPlan;

const evmPayer = `0x${"11".repeat(20)}`;
const evmResearcher = `0x${"22".repeat(20)}`;
const evmFee = `0x${"33".repeat(20)}`;
const evmAttacker = `0x${"44".repeat(20)}`;
const evmUsdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const evmTransfers = [
  { recipient: evmResearcher, amountBase: "7500" },
  { recipient: evmFee, amountBase: "2500" },
];
const evmPlanTransfers =
  scenario.plan === "tampered"
    ? [{ recipient: evmAttacker, amountBase: "7500" }, evmTransfers[1]]
    : evmTransfers;
const evmTransactions: DirectEvmTransaction[] = evmDirectTransactions({
  rpcUrl: "https://example.invalid",
  chainId: "0x1",
  payer: evmPayer,
  asset: { address: evmUsdc, decimals: 6 },
  transfers: evmPlanTransfers,
  nonces: ["0", "1"],
}).map((transaction) => ({
  ...transaction,
  nonce: transaction.nonce ?? "0x0",
}));

const solanaAddress = (fill: number) =>
  encodeBase58Bytes(new Uint8Array(32).fill(fill));
const solPayer = solanaAddress(1);
const solResearcher = solanaAddress(2);
const solFee = solanaAddress(3);
const solAttacker = solanaAddress(4);
const solMint = solanaAddress(5);
const solBlockhash = solanaAddress(7);
const solTransfers = [
  { recipient: solResearcher, amountBase: "7500" },
  { recipient: solFee, amountBase: "2500" },
];
const solPlanTransfers =
  scenario.plan === "tampered"
    ? [{ recipient: solAttacker, amountBase: "7500" }, solTransfers[1]]
    : solTransfers;
const solInstructions = [];
for (const transfer of solPlanTransfers)
  solInstructions.push(createAta(solPayer, solMint, transfer.recipient));
for (const transfer of solPlanTransfers) {
  solInstructions.push({
    program: TOKEN_PROGRAM,
    accounts: [
      {
        key: solanaAssociatedTokenAddress(solMint, solPayer),
        write: true,
      },
      { key: solMint, write: false },
      {
        key: solanaAssociatedTokenAddress(solMint, transfer.recipient),
        write: true,
      },
      { key: solPayer, write: false },
    ],
    data: concat(
      Uint8Array.of(12),
      le(BigInt(transfer.amountBase)),
      Uint8Array.of(6),
    ),
  });
}
const solMessage = message(solPayer, solBlockhash, solInstructions);
const solWire = concat(Uint8Array.of(1), new Uint8Array(64), solMessage);
const solPlan = {
  transaction: encodeBase64(solWire),
  messageId: encodeBase58Bytes(sha256(solMessage)),
};
const solAsset = { address: solMint, decimals: 6 };

const fakeSignature = new Uint8Array(64).fill(0x2a);
const fakeHash = `0x${"ab".repeat(32)}`;

/** The fake EVM provider answers the calls the payment component makes. */
let sentCount = 0;
const ethereum = {
  isMetaMask: true,
  async request(input: { method: string; params?: unknown[] }) {
    shared.sends.push(input);
    switch (input.method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [evmPayer];
      case "eth_chainId":
        return "0x1";
      case "eth_getTransactionCount":
        // The pending nonce advances once each queued transfer is sent.
        return `0x${sentCount.toString(16)}`;
      case "eth_estimateGas":
        return "0x5208";
      case "eth_sendTransaction":
        sentCount += 1;
        return fakeHash;
      default:
        throw new Error(`Unexpected wallet method ${input.method}`);
    }
  },
};
Object.assign(window, { ethereum });

/** The fake Solana wallet signs through the Wallet Standard registry. */
const solAccount = {
  address: solPayer,
  publicKey: new Uint8Array(32).fill(1),
  chains: ["solana:mainnet"],
  features: ["solana:signMessage", "solana:signAndSendTransaction"],
};
const solWallet = {
  version: "1.0.0",
  name: "Fixture Solana",
  icon: "",
  chains: ["solana:mainnet"],
  features: {
    "standard:connect": {
      version: "1.0.0",
      connect: async () => ({ accounts: [solAccount] }),
    },
    "solana:signMessage": {
      version: "1.0.0",
      signMessage: async () => [
        { signature: fakeSignature, signedMessage: new Uint8Array(0) },
      ],
    },
    "solana:signAndSendTransaction": {
      version: "1.0.0",
      supportedTransactionVersions: ["legacy"],
      signAndSendTransaction: async (input: unknown) => {
        shared.sends.push(input);
        return [{ signature: fakeSignature }];
      },
    },
  },
  accounts: [solAccount],
};
window.addEventListener("wallet-standard:app-ready", (event) => {
  (
    event as CustomEvent<{ register: (wallet: unknown) => void }>
  ).detail.register(solWallet);
});
window.dispatchEvent(
  new CustomEvent("wallet-standard:register-wallet", {
    detail: (api: { register: (wallet: unknown) => void }) =>
      api.register(solWallet),
  }),
);

if (scenario.journal === "corrupt") {
  if (scenario.rail === "evm")
    sessionStorage.setItem(
      "slop:bounty-send:v1:fixture-case:1:pay:12345",
      "{corrupt",
    );
  else
    sessionStorage.setItem(
      `slop:bounty-solana:v1:fixture-case:1:${solPlan.messageId}:12345`,
      "{corrupt",
    );
}

function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    shared.ready = true;
    setReady(true);
  }, []);
  return (
    <>
      {ready ? <p>Payment fixture ready</p> : null}
      {scenario.rail === "evm" ? (
        <DirectBountyPayment
          caseId="fixture-case"
          generation={1}
          payer={evmPayer}
          transactions={evmTransactions}
          expectedTransfers={evmTransfers}
          assetAddress={evmUsdc}
          authorize={async () => {}}
          verify={async (hashes) => {
            shared.verified.push(...hashes);
          }}
        />
      ) : (
        <SolanaBountyPayment
          caseId="fixture-case"
          generation={1}
          payer={solPayer}
          plan={solPlan}
          expectedTransfers={solTransfers}
          asset={solAsset}
          authorize={async () => {}}
          authorizeVerification={async () => {}}
          verify={async (signature) => {
            shared.verified.push(signature);
          }}
        />
      )}
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<App />);
