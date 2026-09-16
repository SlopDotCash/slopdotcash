/**
 * Proves that an external evaluated source must be the one canonical public
 * URL for its platform, that GitHub-hosted and mirror-hosted addresses cannot
 * enter through the `web` kind, that differently written URLs for the same
 * work resolve to one work key, and that archive evidence must point at the
 * exact source so a deleted post can still be audited.
 */

import { describe, expect, it } from "vitest";
import {
  assertExternalSourceEvidence,
  assertExternalSourceUrl,
  externalSourceId,
  externalWorkKey,
  isReservedExternalHost,
} from "./external-sources";

const post = "https://x.com/shawmakesmagic/status/1830000000000000000";

describe("external evaluated sources", () => {
  it("accepts exactly one canonical public URL form per platform", () => {
    expect(assertExternalSourceUrl(post, "x", "url")).toBe(post);
    expect(
      assertExternalSourceUrl(
        "https://discord.com/channels/1/2/3",
        "discord",
        "url",
      ),
    ).toBe("https://discord.com/channels/1/2/3");
    expect(
      assertExternalSourceUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "youtube",
        "url",
      ),
    ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(
      assertExternalSourceUrl(
        "https://blog.example.org/eliza-plugin-tutorial",
        "web",
        "url",
      ),
    ).toBe("https://blog.example.org/eliza-plugin-tutorial");
    expect(
      assertExternalSourceUrl(
        "https://forum.example.org/t/eliza-runtime-migration?post=12",
        "web",
        "url",
      ),
    ).toBe("https://forum.example.org/t/eliza-runtime-migration?post=12");

    for (const [value, platform] of [
      ["https://x.com/shawmakesmagic", "x"],
      [`${post}?s=20`, "x"],
      ["http://x.com/shawmakesmagic/status/1", "x"],
      ["https://twitter.com/shawmakesmagic/status/1830000000000000000", "x"],
      ["https://mobile.twitter.com/shawmakesmagic/status/1", "x"],
      ["https://discord.gg/invite", "discord"],
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "youtube"],
      ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
      ["https://youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
      ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
      ["https://github.com/elizaOS/eliza/discussions/1", "web"],
      ["https://x.com/shawmakesmagic/status/1", "web"],
      ["https://example.org/", "web"],
      ["https://user:pw@example.org/post", "web"],
      ["https://example.org/post#section", "web"],
    ] as const) {
      expect(() => assertExternalSourceUrl(value, platform, "url")).toThrow(
        /canonical public|plain https/u,
      );
    }
  });

  it("names the accepted form when it rejects a URL", () => {
    expect(() =>
      assertExternalSourceUrl("https://youtu.be/dQw4w9WgXcQ", "youtube", "url"),
    ).toThrow("use https://www.youtube.com/watch?v=<video id>");
    expect(() =>
      assertExternalSourceUrl(
        "https://twitter.com/shawmakesmagic/status/1830000000000000000",
        "x",
        "url",
      ),
    ).toThrow("use https://x.com/<handle>/status/<id>");
  });

  it("keeps every GitHub host and every subdomain out of the web kind", () => {
    for (const value of [
      "https://gist.github.com/someone/abcdef123456",
      "https://raw.githubusercontent.com/o/r/main/README.md",
      "https://someone.github.io/writeup",
      "https://api.github.com/repos/o/r",
      "https://objects.githubusercontent.com/blob/1",
    ]) {
      expect(() => assertExternalSourceUrl(value, "web", "url")).toThrow(
        /canonical public web URL/u,
      );
    }
    expect(isReservedExternalHost("GIST.GITHUB.COM")).toBe(true);
    expect(isReservedExternalHost("notgithub.com")).toBe(false);
    expect(isReservedExternalHost("example.org")).toBe(false);
  });

  it("keeps platform mirrors out of the web kind", () => {
    for (const value of [
      "https://fxtwitter.com/shawmakesmagic/status/1830000000000000000",
      "https://vxtwitter.com/shawmakesmagic/status/1830000000000000000",
      "https://fixupx.com/shawmakesmagic/status/1830000000000000000",
      "https://nitter.net/shawmakesmagic/status/1830000000000000000",
      "https://xcancel.com/shawmakesmagic/status/1830000000000000000",
      "https://threadreaderapp.com/thread/1830000000000000000.html",
      "https://mobile.twitter.com/shawmakesmagic/status/1830000000000000000",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://ptb.discord.com/channels/1/2/3",
      "https://discordapp.com/channels/1/2/3",
    ]) {
      expect(() => assertExternalSourceUrl(value, "web", "url")).toThrow(
        /canonical public web URL/u,
      );
    }
  });

  it("resolves differently written URLs for one piece of work to one key", () => {
    expect(externalWorkKey(post, "x")).toBe(
      externalWorkKey(
        "https://x.com/ShawMakesMagic_/status/1830000000000000000",
        "x",
      ),
    );
    expect(externalWorkKey(post, "x")).not.toBe(
      externalWorkKey(
        "https://x.com/shawmakesmagic/status/1830000000000000001",
        "x",
      ),
    );
    expect(
      externalWorkKey("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"),
    ).toBe("youtube\0video\0dQw4w9WgXcQ");
    expect(
      externalWorkKey("https://discord.com/channels/1/2/3", "discord"),
    ).toBe("discord\0message\x001/2/3");
    expect(
      externalWorkKey("https://blog.example.org/post?page=2", "web"),
    ).not.toBe(externalWorkKey("https://blog.example.org/post?page=3", "web"));
    expect(() =>
      externalWorkKey("https://youtu.be/dQw4w9WgXcQ", "youtube"),
    ).toThrow(/canonical public youtube URL/u);
  });

  it("requires archive evidence that points at the exact source", () => {
    const evidence = {
      archiveUrl: `https://web.archive.org/web/20260901120000/${post}`,
      contentSha256: "a".repeat(64),
      capturedAt: "2026-09-01T12:00:00.000Z",
    };
    expect(assertExternalSourceEvidence(evidence, post, "evidence")).toEqual(
      evidence,
    );
    expect(
      assertExternalSourceEvidence(
        { ...evidence, archiveUrl: "https://archive.ph/AbCdE" },
        post,
        "evidence",
      ).archiveUrl,
    ).toBe("https://archive.ph/AbCdE");

    expect(() =>
      assertExternalSourceEvidence(
        {
          ...evidence,
          archiveUrl:
            "https://web.archive.org/web/20260901120000/https://x.com/other/status/2",
        },
        post,
        "evidence",
      ),
    ).toThrow(/capture of the source/u);
    expect(() =>
      assertExternalSourceEvidence(
        { ...evidence, archiveUrl: "https://example.org/mirror" },
        post,
        "evidence",
      ),
    ).toThrow(/capture of the source/u);
    expect(() =>
      assertExternalSourceEvidence(
        { ...evidence, contentSha256: "A".repeat(64) },
        post,
        "evidence",
      ),
    ).toThrow(/contentSha256/u);
    expect(() =>
      assertExternalSourceEvidence(
        { ...evidence, capturedAt: "2026-09-01T12:00:00Z" },
        post,
        "evidence",
      ),
    ).toThrow(/capturedAt/u);
    expect(() =>
      assertExternalSourceEvidence(
        { ...evidence, screenshot: "data:image/png;base64,AAAA" },
        post,
        "evidence",
      ),
    ).toThrow(/unexpected or missing/u);
  });

  it("derives one deterministic id per URL", () => {
    expect(externalSourceId(post)).toMatch(/^external-[0-9a-f]{64}$/u);
    expect(externalSourceId(post)).toBe(externalSourceId(post));
    expect(externalSourceId(post)).not.toBe(externalSourceId(`${post}1`));
  });
});
