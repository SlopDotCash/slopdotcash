import { expect, test } from "bun:test";
import {
  frameDeploymentPinBindings,
  readDeploymentPinBinding,
} from "./deployment-pin-bindings";
import { type Environment, PaymentSignerJournal } from "./index";

const ordinary = "PAYMENT_DEPLOYMENTS";
const security = "SECURITY_PAYMENT_DEPLOYMENTS";
const unicodePins = JSON.stringify([
  { name: "x".repeat(4990) + "🌍".repeat(8) },
]);
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

test("keeps empty and exact-limit legacy pins byte-identical", () => {
  const boundary = JSON.stringify(["x".repeat(4996)]);
  expect(bytes(boundary)).toBe(5000);
  const values = { [ordinary]: boundary, SIGNER_ROLE: "attester" };
  expect(frameDeploymentPinBindings(values)).toEqual(values);
  expect(readDeploymentPinBinding(values, ordinary)).toBe(boundary);
  expect(readDeploymentPinBinding(values, security)).toBeUndefined();
  expect(frameDeploymentPinBindings({ [ordinary]: "[]" })).toEqual({
    [ordinary]: "[]",
  });
});

test("preserves exact UTF-8 bytes for independent ordinary and security frames", () => {
  // The next Unicode character cannot fit after these 4,999 bytes.
  const declared = JSON.stringify([
    `${"x".repeat(4997)}🌍${"世".repeat(1700)}`,
  ]);
  const framed = frameDeploymentPinBindings({
    [ordinary]: declared,
    [security]: unicodePins,
  });
  expect(bytes(framed.PAYMENT_DEPLOYMENTS_PART_1)).toBe(4999);
  expect(framed.PAYMENT_DEPLOYMENTS_PART_2.startsWith("🌍")).toBe(true);
  expect(Object.values(framed).every((part) => bytes(part) <= 5000)).toBe(true);
  expect(readDeploymentPinBinding(framed, ordinary)).toBe(declared);
  expect(readDeploymentPinBinding(framed, security)).toBe(unicodePins);
});

test("refuses missing, unexpected, reordered and altered frame data", () => {
  const framed = frameDeploymentPinBindings({ [ordinary]: unicodePins });
  const {
    PAYMENT_DEPLOYMENTS_PART_2: second,
    PAYMENT_DEPLOYMENTS: header,
    ...missing
  } = framed;
  for (const bindings of [
    { ...missing, [ordinary]: header },
    { ...missing, PAYMENT_DEPLOYMENTS_PART_2: second },
    { ...framed, [ordinary]: header.replace("v1", "v2") },
    { ...framed, PAYMENT_DEPLOYMENTS_PART_3: "unexpected" },
    {
      ...framed,
      PAYMENT_DEPLOYMENTS_PART_1: second,
      PAYMENT_DEPLOYMENTS_PART_2: framed.PAYMENT_DEPLOYMENTS_PART_1,
    },
    { ...framed, PAYMENT_DEPLOYMENTS_PART_2: second.replace("🌍", "🍀") },
  ]) {
    expect(() => readDeploymentPinBinding(bindings, ordinary)).toThrow(
      "Invalid deployment pin frame for PAYMENT_DEPLOYMENTS",
    );
  }
});

test("the journal fails closed before accessing other bindings and decodes the other scope independently", async () => {
  const framed = frameDeploymentPinBindings({
    [ordinary]: unicodePins,
    [security]: unicodePins,
  });
  delete framed.PAYMENT_DEPLOYMENTS_PART_2;
  const reads: string[] = [];
  const env = {
    ...framed,
    SIGNER_STACK: "production",
    SIGNER_ROLE: "attester",
    CHAIN_FAMILY: "evm",
    get PAYMENT_RPC_URLS() {
      reads.push("RPC");
      return "{}";
    },
    get SIGNER_PRIVATE_KEY() {
      throw new Error("Unexpected signing key access");
    },
    get PAYMENTS_DB() {
      throw new Error("Unexpected payment database access");
    },
  } as unknown as Environment;
  const journal = new PaymentSignerJournal(
    {
      storage: {
        async get() {
          reads.push("journal");
          return undefined;
        },
        async put() {
          throw new Error("Unexpected journal write");
        },
        async transaction() {
          throw new Error("Unexpected journal transaction");
        },
      },
    },
    env,
  );
  const request = (scope: string) =>
    new Request("https://attester.internal/v1/reconcile-binding", {
      method: "POST",
      body: JSON.stringify({
        scope,
        network: "base-mainnet",
        vault: `0x${"1".repeat(40)}`,
        originalTransactionId: `0x${"2".repeat(64)}`,
        winnerTransactionId: `0x${"3".repeat(64)}`,
      }),
    });
  expect(reads).toEqual([]);
  expect((await journal.fetch(request("ordinary"))).status).toBe(409);
  expect(reads).toEqual([]);
  expect((await journal.fetch(request("security-bounty"))).status).toBe(409);
  expect(reads).toEqual(["RPC", "journal", "journal"]);
});
