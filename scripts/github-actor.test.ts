/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";

describe("githubUserIdFromNodeId canonical spellings", () => {
  it("decodes the canonical legacy and current spellings GitHub emits", () => {
    expect(githubUserIdFromNodeId("MDQ6VXNlcjE0NTg0NQ==")).toBe("145845");
    expect(githubUserIdFromNodeId("MDQ6VXNlcjE0MDAzODA=")).toBe("1400380");
    expect(githubUserIdFromNodeId("U_kgDOAAAAAQ")).toBe("1");
    expect(githubUserIdFromNodeId("U_kgDOB-0I6w")).toBe("132974827");
  });

  it("rejects legacy spellings with stripped padding or non-zero trailing bits", () => {
    expect(githubUserIdFromNodeId("MDQ6VXNlcjE0NTg0NQ")).toBeNull();
    expect(githubUserIdFromNodeId("MDQ6VXNlcjE0NTg0NR==")).toBeNull();
    expect(githubUserIdFromNodeId("MDQ6VXNlcjE0NTg0NS==")).toBeNull();
  });

  it("rejects current spellings that re-encode the ID at another MessagePack width", () => {
    // Canonical uint32 spelling of GitHub ID 254897651.
    expect(githubUserIdFromNodeId("U_kgDODzFt8w")).toBe("254897651");
    // The same ID re-encoded as a uint64 (review on PR #726).
    expect(githubUserIdFromNodeId("U_kgDPAAAAAA8xbfM")).toBeNull();
    // ID 1 at every non-canonical width: fixint, uint8, uint16, uint64.
    expect(githubUserIdFromNodeId("U_kgAB")).toBeNull();
    expect(githubUserIdFromNodeId("U_kgDMAQ")).toBeNull();
    expect(githubUserIdFromNodeId("U_kgDNAAE")).toBeNull();
    expect(githubUserIdFromNodeId("U_kgDPAAAAAAAAAAE")).toBeNull();
  });

  it("rejects current spellings with padding, trailing bits, or the standard alphabet", () => {
    expect(githubUserIdFromNodeId("U_kgDOAAAAAQ==")).toBeNull();
    expect(githubUserIdFromNodeId("U_kgDOAAAAAR")).toBeNull();
    expect(githubUserIdFromNodeId("U_kgDOB+0I6w")).toBeNull();
  });
});
