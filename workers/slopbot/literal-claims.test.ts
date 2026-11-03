// Issue #1930: Slopbot told four contributors that a pinned SHA-256 digest
// "is not a sha256 hex value", and told four more that an ordinary Python
// 0x integer literal was "an undefined name". Both readings are wrong, and a
// finding that rests on one must not be published (PRD section 5: a wrong
// rejection harms a real contributor).
import { expect, test } from "bun:test";
import { refutedLiteralClaim } from "./literal-claims";

// The digest pinned by pumpfun-source #3297, #3302, #3303 and #3392 for
// evidence/dependencies/spl_token/deployed.so.
const DIGEST =
  "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697";

test("a pinned lowercase sha256 digest refutes a 'not a sha256 hex value' claim", () => {
  const refuted = refutedLiteralClaim(
    `The pinned digest ${DIGEST} is not a sha256 hex value, so the hash assertion should fail.`,
  );
  expect(refuted?.kind).toBe("sha256");
  expect(refuted?.value).toBe(DIGEST);
});

test("an uppercase digest is still a sha256 digest", () => {
  const refuted = refutedLiteralClaim(
    `The pinned value ${DIGEST.toUpperCase()} is not a sha256 hex value.`,
  );
  expect(refuted?.kind).toBe("sha256");
  expect(refuted?.value).toBe(DIGEST.toUpperCase());
});

test("a 0x integer literal is not an undefined name", () => {
  const refuted = refutedLiteralClaim(
    "The slice assigns `SLOT_TOKEN_SIDE` to an undefined name, `0xF4`, where 0xF4 appears intended, so it raises NameError.",
  );
  expect(refuted?.kind).toBe("literal");
  expect(refuted?.value).toBe("0xF4");
});

test("an assignment of a 0x literal to a constant is not an undefined name", () => {
  const refuted = refutedLiteralClaim(
    "`SLOT_TOKEN_SIDE=0xF4` assigns the mask to an undefined name and would raise NameError at import time.",
  );
  expect(refuted?.kind).toBe("literal");
  expect(refuted?.value).toBe("0xF4");
});

test("a real undefined name is not refuted without a literal", () => {
  expect(
    refutedLiteralClaim(
      "The module assigns the mask to an undefined name `TOKEN_SIDE`, so importing it raises NameError.",
    ),
  ).toBeNull();
});

test("a short hex string is not a sha256 digest", () => {
  const short = DIGEST.slice(0, 63);
  expect(
    refutedLiteralClaim(`The pinned value ${short} is not a sha256 hex value.`),
  ).toBeNull();
});

test("a 40-character commit sha is not a sha256 digest", () => {
  expect(
    refutedLiteralClaim(
      `The commit sha ${"c".repeat(40)} is not a sha256 hex value.`,
    ),
  ).toBeNull();
});

test("a 0x-prefixed digest is still a sha256 digest", () => {
  const refuted = refutedLiteralClaim(
    `The pinned value 0x${DIGEST} is not a valid sha256 digest.`,
  );
  expect(refuted?.kind).toBe("sha256");
  expect(refuted?.value).toBe(`0x${DIGEST}`);
});

test("a 32-character md5 digest is refuted when its form is rejected", () => {
  const md5 = DIGEST.slice(0, 32);
  const refuted = refutedLiteralClaim(
    `The checksum ${md5} is not a valid md5 digest.`,
  );
  expect(refuted?.kind).toBe("md5");
  expect(refuted?.value).toBe(md5);
});

test("a quoted literal that is present in the source refutes an absence claim", () => {
  const source = `+pinned sha256 ${DIGEST}\n+SLOT_TOKEN_SIDE = 0xF4\n`;
  const refuted = refutedLiteralClaim(
    `The digest \`${DIGEST}\` does not appear anywhere in the diff, so the pin is unverifiable.`,
    source,
  );
  expect(refuted?.kind).toBe("sha256");
  expect(refuted?.value).toBe(DIGEST);
  // Without the reviewed text the absence claim is not refutable.
  expect(
    refutedLiteralClaim(
      `The digest \`${DIGEST}\` does not appear anywhere in the diff, so the pin is unverifiable.`,
    ),
  ).toBeNull();
});

test("an absence claim about a token that really is absent is not refuted", () => {
  expect(
    refutedLiteralClaim(
      "The digest `deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef` does not appear in the diff.",
      `+pinned sha256 ${DIGEST}\n`,
    ),
  ).toBeNull();
});

test("prose that mentions hex or a literal without rejecting a value is not refuted", () => {
  for (const summary of [
    "The README documents a hex literal but the code parses decimal, so the documented example fails.",
    "The helper is described as a hex digest utility but it hashes the diff text instead of the file.",
    `The digest ${DIGEST} is pinned for the wrong artifact: it belongs to the staged copy, not to the deployed program.`,
    `The digest ${DIGEST} is not the digest of the deployed artifact, so the pin proves nothing.`,
    "The test compares string prefixes instead of the full digest, so a wrong value still passes.",
  ])
    expect(refutedLiteralClaim(summary)).toBeNull();
});

// #2201 review (nh0cksh0ck02, finding 1): models quote Python runtime errors
// in the traceback's own quoting style, not in Markdown backticks, so the
// undefined-name check has to read single quotes, double quotes and prose.
test("a Python NameError with single-quoted name is refuted", () => {
  const refuted = refutedLiteralClaim(
    "Fails with NameError: name '0xF4' is not defined.",
  );
  expect(refuted?.kind).toBe("literal");
  expect(refuted?.value).toBe("0xF4");
});

test("a Python NameError with double-quoted name is refuted", () => {
  const refuted = refutedLiteralClaim(
    'Fails with NameError: name "0xF4" is not defined.',
  );
  expect(refuted?.kind).toBe("literal");
  expect(refuted?.value).toBe("0xF4");
});

test("an unquoted prose undefined-name claim about a 0x literal is refuted", () => {
  const refuted = refutedLiteralClaim(
    "The module raises NameError because 0xF4 is not defined.",
  );
  expect(refuted?.kind).toBe("literal");
  expect(refuted?.value).toBe("0xF4");
});

// #2201 review (remarbical, finding 1): the rejection must be about the
// well-formed digest, not merely mention one.
test("a malformed value rejected next to a correct digest is not refuted", () => {
  expect(
    refutedLiteralClaim(
      `The pinned value 0xDEAD is not a sha256 hex value; use ${DIGEST} instead.`,
    ),
  ).toBeNull();
});

test("a rejected 63-character digest does not borrow a correct pin's form", () => {
  expect(
    refutedLiteralClaim(
      `The pin ${DIGEST.slice(0, 63)} is not a valid sha256 digest; the correct pin is ${DIGEST}.`,
    ),
  ).toBeNull();
});

// #2201 review (remarbical, finding 2): the undefined-name claim is about the
// quoted name, and the 0x literal is the suggested fix.
test("an undefined name claim about another token does not refute the fix's literal", () => {
  expect(
    refutedLiteralClaim(
      "The module assigns the mask to an undefined name `TOKEN_SIDE`, raising NameError; the intended fix is `SLOT_TOKEN_SIDE=0xF4`.",
    ),
  ).toBeNull();
});

// #2201 review (nh0cksh0ck02, finding 3): a token that survives only on a
// removed diff line is genuinely absent from the result.
const DIFF = [
  "--- evidence/dependencies/spl_token/DIGEST.md (modified)",
  "@@ -1,2 +1,2 @@",
  `-pinned sha256 ${DIGEST}`,
  "+pinned sha256 deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
].join("\n");

test("an absence claim about a token only on a removed diff line is not refuted", () => {
  expect(
    refutedLiteralClaim(
      `The digest \`${DIGEST}\` does not appear in the diff.`,
      DIFF,
    ),
  ).toBeNull();
});

test("an absence claim about a token on an added diff line is still refuted", () => {
  const refuted = refutedLiteralClaim(
    `The digest \`${DIGEST}\` does not appear in the diff.`,
    `--- a/x (modified)\n@@ -1 +1 @@\n+sha256 ${DIGEST}\n`,
  );
  expect(refuted?.kind).toBe("sha256");
  expect(refuted?.value).toBe(DIGEST);
});

test("an absence claim about an ordinary name the diff happens to contain is not refuted", () => {
  // The claim is that the check is missing, not that `admin` is absent.
  expect(
    refutedLiteralClaim(
      "The authorization check for `admin` is missing from the handler.",
      "+const admin = true\n+function handler() {}\n",
    ),
  ).toBeNull();
});
