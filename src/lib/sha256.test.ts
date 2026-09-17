import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

const reference = (input: string | Uint8Array) =>
  createHash("sha256").update(input).digest("hex");

describe("sha256Hex", () => {
  it("matches node:crypto on the FIPS vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches node:crypto across every padding boundary", () => {
    for (let length = 0; length <= 200; length += 1) {
      const input = "x".repeat(length);
      expect(sha256Hex(input), `length ${length}`).toBe(reference(input));
    }
    const long = "https://x.com/example/status/1234567890".repeat(40);
    expect(sha256Hex(long)).toBe(reference(long));
  });

  it("encodes strings as UTF-8 and accepts raw bytes", () => {
    const text = "naïve café 日本語 🚀 https://example.org/?q=ü";
    expect(sha256Hex(text)).toBe(reference(text));
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 64]);
    expect(sha256Hex(bytes)).toBe(reference(bytes));
  });
});
