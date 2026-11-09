// Source-only regression definitions for PRD STATE-02/03; not executed in
// this audit. In-memory journal/HTTP outcomes test the publisher contract,
// not D1 durability, server receipt truth, or deployed scanner acceptance.
import { expect, test } from "bun:test";
import { vettingSignedMessage } from "../../backend/vetting/handler";
import { MAX_VETTING_RESULT_BYTES } from "../../backend/vetting/result";
import { parseRecordedVettingResult } from "../../backend/vetting/scan-result";
import { decodeBase64 } from "../../src/lib/byte-encoding";
import { sha256Hex } from "../../src/lib/sha256";
import { vettingResult } from "../../tests/vetting-fixtures";
import { publishResult } from "./publication";
import {
  JOURNAL_SCHEMA,
  type PublicationIntent,
  type PublicationJournal,
  type PublicationReceipt,
  servicePublicationJournal,
} from "./publication-journal";
import type { VettingServiceSigner } from "./service";

const ORIGIN = "https://scanner.example";
const PATH = "/api/v1/vetting/results";
const AT = "2026-11-09T12:00:00.000Z";
type Options = Parameters<typeof publishResult>[0];
const keys = async (): Promise<VettingServiceSigner> =>
  (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

function prepared() {
  const result = parseRecordedVettingResult(
    vettingResult(
      {
        assessmentId: `vet_${"a".repeat(32)}`,
        projectId: "open-registry",
        revision: 1,
        manifestSha256: "b".repeat(64),
        repository: "example/open-registry",
        commitSha: "c".repeat(40),
        templateSha256: "d".repeat(64),
      },
      "incomplete",
    ),
  );
  const body = JSON.stringify(result);
  const approvedSha256 = sha256Hex(body);
  const assessment = {
    id: result.assessmentId,
    revision: result.revision,
    state: result.disposition,
    commitSha: result.assessed.commitSha,
    templateSha256: result.assessed.templateSha256,
    policyVersion: result.policyVersion,
    resultSha256: approvedSha256,
  };
  return { result, body, approvedSha256, assessment };
}

function memoryJournal() {
  const intents: PublicationIntent[] = [];
  const receipts: PublicationReceipt[] = [];
  const journal: PublicationJournal = {
    async has(id) {
      return intents.some((intent) => intent.assessmentId === id);
    },
    async reserve(intent) {
      if (await this.has(intent.assessmentId)) throw new Error("Already reserved");
      intents.push({ ...intent });
    },
    async complete(receipt) {
      receipts.push({ ...receipt });
    },
  };
  return { journal, intents, receipts };
}

function options(
  signer: VettingServiceSigner,
  journal: PublicationJournal,
  fetcher: typeof fetch,
): Options {
  const value = prepared();
  return {
    origin: ORIGIN,
    body: value.body,
    approvedSha256: value.approvedSha256,
    signer: { ...signer },
    journalDirectory: "/unused-with-injected-journal",
    journal,
    fetch: fetcher,
    at: new Date(AT),
  };
}

async function expectSignature(init: RequestInit, signer: VettingServiceSigner) {
  const headers = new Headers(init.headers);
  const body = String(init.body);
  expect(headers.get("x-slop-vetting-timestamp")).toBe(AT);
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", signer.publicKey),
  );
  expect(headers.get("x-slop-vetting-key")).toBe(sha256Hex(raw));
  const message = vettingSignedMessage("POST", PATH, AT, sha256Hex(body));
  expect(
    await crypto.subtle.verify(
      "Ed25519",
      signer.publicKey,
      decodeBase64(headers.get("x-slop-vetting-signature") ?? ""),
      message as Uint8Array<ArrayBuffer>,
    ),
  ).toBe(true);
}

test("publisher owns approved configuration and journal callbacks before signing awaits", async () => {
  const signer = await keys();
  const other = await keys();
  const value = prepared();
  const recorded = memoryJournal();
  let sends = 0;
  const input = options(signer, recorded.journal, (async (url, init) => {
    sends++;
    expect(String(url)).toBe(`${ORIGIN}${PATH}`);
    expect(init?.body).toBe(value.body);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    await expectSignature(init ?? {}, signer);
    return Response.json({ assessment: value.assessment });
  }) as typeof fetch);
  const pending = publishResult(input);
  input.origin = "https://changed.example";
  input.body = "{}";
  input.approvedSha256 = "f".repeat(64);
  input.signer.privateKey = other.privateKey;
  input.signer.publicKey = other.publicKey;
  input.at?.setUTCFullYear(2030);
  input.journalDirectory = "/must-not-be-used";
  input.fetch = (async () => {
    throw new Error("Changed fetch");
  }) as typeof fetch;
  input.journal = {
    has: async () => false,
    reserve: async () => {
      throw new Error("Changed journal");
    },
    complete: async () => {
      throw new Error("Changed journal");
    },
  };
  recorded.journal.reserve = async () => {
    throw new Error("Changed reserve");
  };
  recorded.journal.complete = async () => {
    throw new Error("Changed complete");
  };
  const receipt = await pending;
  expect(receipt).toEqual({
    assessmentId: value.result.assessmentId,
    resultSha256: value.approvedSha256,
    origin: ORIGIN,
    disposition: "incomplete",
    outcome: "accepted",
    httpStatus: 200,
  });
  expect(recorded.intents).toHaveLength(1);
  expect(recorded.receipts).toEqual([receipt]);
  expect(sends).toBe(1);
});

test("configuration changes during reservation cannot redirect the approved post", async () => {
  const signer = await keys();
  const value = prepared();
  const recorded = memoryJournal();
  let entered!: () => void;
  let release!: () => void;
  const reserved = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reserve = recorded.journal.reserve.bind(recorded.journal);
  recorded.journal.reserve = async (intent) => {
    await reserve(intent);
    entered();
    await gate;
  };
  let sends = 0;
  const input = options(signer, recorded.journal, (async (url, init) => {
    sends++;
    expect(String(url)).toBe(`${ORIGIN}${PATH}`);
    expect(init?.body).toBe(value.body);
    return Response.json({ assessment: value.assessment });
  }) as typeof fetch);
  const pending = publishResult(input);
  await reserved;
  expect(sends).toBe(0);
  input.origin = "https://changed.example";
  input.body = "{}";
  input.approvedSha256 = "f".repeat(64);
  input.fetch = (async () => {
    throw new Error("Changed fetch");
  }) as typeof fetch;
  release();
  expect((await pending).outcome).toBe("accepted");
  expect(sends).toBe(1);
});

test("journal callbacks cannot mutate the publisher's retained intent or returned receipt", async () => {
  const signer = await keys();
  const value = prepared();
  let reservedDigest = "";
  let completedDigest = "";
  const journal: PublicationJournal = {
    has: async () => false,
    reserve: async (intent) => {
      reservedDigest = intent.resultSha256;
      intent.resultSha256 = "f".repeat(64);
      intent.origin = "https://changed.example";
    },
    complete: async (receipt) => {
      completedDigest = receipt.resultSha256;
      receipt.resultSha256 = "e".repeat(64);
      receipt.outcome = "rejected";
    },
  };
  const receipt = await publishResult(
    options(
      signer,
      journal,
      (async () => Response.json({ assessment: value.assessment })) as typeof fetch,
    ),
  );
  expect(reservedDigest).toBe(value.approvedSha256);
  expect(completedDigest).toBe(value.approvedSha256);
  expect(receipt.resultSha256).toBe(value.approvedSha256);
  expect(receipt.origin).toBe(ORIGIN);
  expect(receipt.outcome).toBe("accepted");
});

test("invalid origin, unapproved bytes and noncanonical bytes stop before reservation", async () => {
  const signer = await keys();
  for (const change of [
    { origin: `${ORIGIN}/path` },
    { approvedSha256: "f".repeat(64) },
    { body: ` ${prepared().body}` },
    { body: "not-json" },
  ]) {
    const recorded = memoryJournal();
    let sends = 0;
    const input = options(signer, recorded.journal, (async () => {
      sends++;
      return new Response(null, { status: 204 });
    }) as typeof fetch);
    await expect(publishResult({ ...input, ...change })).rejects.toThrow();
    expect(recorded.intents).toHaveLength(0);
    expect(recorded.receipts).toHaveLength(0);
    expect(sends).toBe(0);
  }
});

test("reservation refusal never sends a result or writes a completion", async () => {
  const signer = await keys();
  const recorded = memoryJournal();
  recorded.journal.reserve = async () => {
    throw new Error("Reservation uncertain");
  };
  let sends = 0;
  await expect(
    publishResult(
      options(signer, recorded.journal, (async () => {
        sends++;
        return new Response(null, { status: 204 });
      }) as typeof fetch),
    ),
  ).rejects.toThrow("Reservation uncertain");
  expect(sends).toBe(0);
  expect(recorded.receipts).toHaveLength(0);
});

test("publisher requires the service journal's positive reservation acknowledgement before posting", async () => {
  const signer = await keys();
  const value = prepared();
  for (const acknowledgement of [
    { schemaVersion: JOURNAL_SCHEMA },
    { schemaVersion: JOURNAL_SCHEMA, reserved: false },
  ]) {
    let journalCalls = 0;
    let resultPosts = 0;
    const transport = (async (url) => {
      if (String(url) === `${ORIGIN}/api/v1/vetting/journal`) {
        journalCalls++;
        return Response.json(acknowledgement);
      }
      if (String(url) === `${ORIGIN}${PATH}`) {
        resultPosts++;
        return Response.json({ assessment: value.assessment });
      }
      throw new Error("Unexpected publication route");
    }) as typeof fetch;
    const journal = servicePublicationJournal({
      origin: ORIGIN,
      signer,
      fetch: transport,
      now: () => new Date(AT),
    });
    await expect(
      publishResult(options(signer, journal, transport)),
    ).rejects.toThrow();
    expect(journalCalls).toBe(1);
    expect(resultPosts).toBe(0);
  }
});

test("every committed receipt binding must match the approved result", async () => {
  const signer = await keys();
  const value = prepared();
  for (const field of [
    "id",
    "revision",
    "state",
    "commitSha",
    "templateSha256",
    "policyVersion",
    "resultSha256",
  ] as const) {
    const recorded = memoryJournal();
    const assessment = {
      ...value.assessment,
      [field]: field === "revision" ? 2 : "changed",
    };
    const receipt = await publishResult(
      options(
        signer,
        recorded.journal,
        (async () => Response.json({ assessment })) as typeof fetch,
      ),
    );
    expect(receipt.outcome).toBe("unknown");
    expect(receipt.httpStatus).toBe(200);
    expect(recorded.receipts).toEqual([receipt]);
  }
});

test("only explicit pre-write rejection statuses prove rejection", async () => {
  const signer = await keys();
  for (const status of [
    400, 401, 403, 404, 413, 422, 201, 204, 301, 408, 409, 429, 500, 503,
  ]) {
    const recorded = memoryJournal();
    let cancelled = false;
    const body =
      status === 204
        ? null
        : new ReadableStream({
            cancel: () => {
              cancelled = true;
            },
          });
    const receipt = await publishResult(
      options(
        signer,
        recorded.journal,
        (async () => new Response(body, { status })) as typeof fetch,
      ),
    );
    expect(receipt.outcome).toBe(
      [400, 401, 403, 404, 413, 422].includes(status) ? "rejected" : "unknown",
    );
    expect(receipt.httpStatus).toBe(status);
    if (body) expect(cancelled).toBe(true);
    expect(recorded.receipts).toEqual([receipt]);
  }
});

test("missing, malformed, oversized or unreadable success receipts remain unknown", async () => {
  const signer = await keys();
  for (const response of [
    Response.json(null),
    Response.json({}),
    new Response("not-json", { status: 200 }),
    new Response("{}", {
      headers: { "content-length": String(MAX_VETTING_RESULT_BYTES + 1) },
    }),
    new Response(
      new ReadableStream({
        start: (controller) => {
          controller.error(new Error("Read failed"));
        },
      }),
    ),
  ]) {
    const recorded = memoryJournal();
    const receipt = await publishResult(
      options(signer, recorded.journal, (async () => response) as typeof fetch),
    );
    expect(receipt.outcome).toBe("unknown");
    expect(receipt.httpStatus).toBe(200);
    expect(recorded.receipts).toEqual([receipt]);
  }
});

test("a lost response after server commit stays unknown and cannot trigger a second post", async () => {
  const signer = await keys();
  const recorded = memoryJournal();
  let commits = 0;
  const input = options(signer, recorded.journal, (async () => {
    commits++;
    throw new Error("Response lost after commit");
  }) as typeof fetch);
  const receipt = await publishResult(input);
  expect(receipt.outcome).toBe("unknown");
  expect(receipt.httpStatus).toBeNull();
  await expect(publishResult(input)).rejects.toThrow("Already reserved");
  expect(commits).toBe(1);
  expect(recorded.receipts).toEqual([receipt]);
});

test("failed completion retains the reservation and cannot claim a recorded outcome", async () => {
  const signer = await keys();
  const value = prepared();
  const recorded = memoryJournal();
  recorded.journal.complete = async () => {
    throw new Error("Completion uncertain");
  };
  let sends = 0;
  const input = options(signer, recorded.journal, (async () => {
    sends++;
    return Response.json({ assessment: value.assessment });
  }) as typeof fetch);
  await expect(publishResult(input)).rejects.toThrow("Completion uncertain");
  await expect(publishResult(input)).rejects.toThrow("Already reserved");
  expect(recorded.intents).toHaveLength(1);
  expect(recorded.receipts).toHaveLength(0);
  expect(sends).toBe(1);
});

test("concurrent attempts rely on one atomic reservation before either result post", async () => {
  const signer = await keys();
  const value = prepared();
  const recorded = memoryJournal();
  // A synchronous claimed-ID set stands in for the journal's atomic create.
  const claimed = new Set<string>();
  recorded.journal.reserve = async (intent) => {
    if (claimed.has(intent.assessmentId)) throw new Error("Already reserved");
    claimed.add(intent.assessmentId);
    recorded.intents.push({ ...intent });
  };
  let sends = 0;
  const input = options(signer, recorded.journal, (async () => {
    sends++;
    return Response.json({ assessment: value.assessment });
  }) as typeof fetch);
  const outcomes = await Promise.allSettled([
    publishResult(input),
    publishResult(input),
  ]);
  expect(
    outcomes.filter((outcome) => outcome.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    outcomes.filter((outcome) => outcome.status === "rejected"),
  ).toHaveLength(1);
  expect(sends).toBe(1);
  expect(recorded.intents).toHaveLength(1);
  expect(recorded.receipts).toHaveLength(1);
});
