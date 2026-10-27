import { expect, test } from "bun:test";
import { decodeJupiterRoute } from "./jupiter-wire";

// Encodings from the captured Jupiter IDL, deliberately independent of the
// decoder's schema lookup. TokenSwap=3; Whirlpool=17; WhirlpoolSwapV2=47.
const route = [229, 23, 203, 151, 122, 227, 173, 42];
const routeV2 = [187, 100, 250, 204, 49, 196, 175, 20];
const u64 = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return [...b];
};
const amounts = [...u64(1000n), ...u64(2000n), 50, 0, 0];

test("variable route fields cannot move the exact-in amounts or hide trailing bytes", () => {
  const raw = Uint8Array.from([
    ...route,
    2,
    0,
    0,
    0,
    17,
    1,
    100,
    0,
    1,
    3,
    100,
    1,
    2,
    ...amounts,
  ]);
  const decoded = decodeJupiterRoute(raw);
  expect(decoded.args.in_amount).toBe(1000n);
  expect(decoded.args.quoted_out_amount).toBe(2000n);
  expect(decoded.args.slippage_bps).toBe(50);
  expect(decoded.args.route_plan).toEqual([
    {
      swap: { variant: "Whirlpool", a_to_b: true },
      percent: 100,
      input_index: 0,
      output_index: 1,
    },
    {
      swap: { variant: "TokenSwap" },
      percent: 100,
      input_index: 1,
      output_index: 2,
    },
  ]);
  // A trailer-only reader would accept these spoofed amounts; the program uses
  // the original ones and may ignore the added bytes. Refuse the whole message.
  expect(() =>
    decodeJupiterRoute(
      Uint8Array.from([...raw, ...u64(1n), ...u64(999999n), 0, 0, 0]),
    ),
  ).toThrow("Trailing bytes");
  expect(() => decodeJupiterRoute(raw.slice(0, -1))).toThrow("Truncated");
});

test("V2 headers retain exact amounts while nested remaining-account metadata is consumed", () => {
  const raw = Uint8Array.from([
    ...routeV2,
    ...u64(500n),
    ...u64(900n),
    25,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    47,
    1,
    1,
    1,
    0,
    0,
    0,
    0,
    3,
    16,
    39,
    0,
    1,
  ]);
  const decoded = decodeJupiterRoute(raw);
  expect(decoded.name).toBe("route_v2");
  expect(decoded.args.in_amount).toBe(500n);
  expect(decoded.args.quoted_out_amount).toBe(900n);
  expect(decoded.args.route_plan).toEqual([
    {
      swap: {
        variant: "WhirlpoolSwapV2",
        a_to_b: true,
        remaining_accounts_info: { slices: [{ accounts_type: 0, length: 3 }] },
      },
      bps: 10000,
      input_index: 0,
      output_index: 1,
    },
  ]);
  const invalidBoolean = raw.slice();
  invalidBoolean[35] = 2;
  expect(() => decodeJupiterRoute(invalidBoolean)).toThrow();
});

test("unknown route operations and hostile vector lengths refuse before allocation", () => {
  expect(() =>
    decodeJupiterRoute(
      Uint8Array.from([...route, 1, 0, 0, 0, 255, 100, 0, 1, ...amounts]),
    ),
  ).toThrow("Unknown Jupiter route variant");
  expect(() =>
    decodeJupiterRoute(
      Uint8Array.from([...route, 255, 255, 255, 255, ...amounts]),
    ),
  ).toThrow("collection exceeds");
  expect(() =>
    decodeJupiterRoute(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, ...amounts])),
  ).toThrow("not an admitted exact-in route");
});
