// Native filesystem regression definitions, authored without execution.
// These exercise returned writes and refusal boundaries, not power-loss or
// storage-hardware guarantees. Directory fsync must work on the test platform.
import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filePublicationJournal, type PublicationIntent, type PublicationReceipt } from "./publication-journal";

const id = `vet_${"1".repeat(32)}`;
const otherId = `vet_${"2".repeat(32)}`;
const intent = (): PublicationIntent => ({ assessmentId: id, resultSha256: "a".repeat(64),
  origin: "https://slop.cash", disposition: "incomplete" });
const receipt = (): PublicationReceipt => ({ ...intent(), outcome: "unknown", httpStatus: null });
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "slop-file-journal-"));
  const root = join(parent, "private", "journal");
  return { parent, root, journal: filePublicationJournal(root),
    close: () => rm(parent, { recursive: true, force: true }) };
}

test("reservation creates private metadata, survives reopening, and remains exclusive", async () => {
  const f = await fixture();
  try {
    expect(await f.journal.has(id)).toBe(false);
    await f.journal.reserve(intent());
    expect(JSON.parse(await readFile(join(f.root, id, "intent.json"), "utf8"))).toEqual(intent());
    expect((await lstat(join(f.root, id))).mode & 0o777).toBe(0o700);
    expect((await lstat(join(f.root, id, "intent.json"))).mode & 0o777).toBe(0o600);
    expect(await filePublicationJournal(f.root).has(id)).toBe(true);
    await expect(filePublicationJournal(f.root).reserve(intent())).rejects.toThrow();
    expect(await readdir(join(f.root, id))).toEqual(["intent.json"]);
  } finally { await f.close(); }
});

test.each(["", ".", "..", "../outside", "nested/id", "nested\\id", "/absolute", "trailing.", "a:b"])(
  "invalid id %s refuses before creating a journal root", async (assessmentId) => {
    const f = await fixture();
    try {
      await expect(f.journal.has(assessmentId)).rejects.toThrow("assessment id");
      await expect(f.journal.reserve({ ...intent(), assessmentId })).rejects.toThrow("assessment id");
      await expect(f.journal.complete({ ...receipt(), assessmentId })).rejects.toThrow("assessment id");
      expect(await readdir(f.parent)).toEqual([]);
    } finally { await f.close(); }
  },
);

test("reservation snapshots its directory identity and JSON before yielding", async () => {
  const f = await fixture();
  try {
    const mutable = intent();
    const expected = { ...mutable };
    const pending = f.journal.reserve(mutable);
    mutable.assessmentId = otherId;
    mutable.resultSha256 = "b".repeat(64);
    mutable.origin = "https://changed.example";
    await pending;
    expect(await readdir(f.root)).toEqual([id]);
    expect(JSON.parse(await readFile(join(f.root, id, "intent.json"), "utf8"))).toEqual(expected);
  } finally { await f.close(); }
});

test.each([{ resultSha256: "a" }, { resultSha256: "A".repeat(64) }, { origin: "" },
  { origin: "x".repeat(201) }, { disposition: "pending" }])(
  "invalid intent metadata %j refuses before creating a journal root", async (patch) => {
    const f = await fixture();
    try {
      await expect(f.journal.reserve({ ...intent(), ...patch } as PublicationIntent)).rejects.toThrow("intent is invalid");
      expect(await readdir(f.parent)).toEqual([]);
    } finally { await f.close(); }
  },
);

test("concurrent reservations have one winner and never replace its bytes", async () => {
  const f = await fixture();
  try {
    const first = intent(), second = { ...intent(), resultSha256: "b".repeat(64) };
    const results = await Promise.allSettled([f.journal.reserve(first), filePublicationJournal(f.root).reserve(second)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const retained = JSON.parse(await readFile(join(f.root, id, "intent.json"), "utf8"));
    expect([first.resultSha256, second.resultSha256]).toContain(retained.resultSha256);
    expect(await f.journal.has(id)).toBe(true);
  } finally { await f.close(); }
});

test.each(["directory", "file", "dangling-symlink"])(
  "an existing %s marker blocks retry even without a complete intent", async (kind) => {
    const f = await fixture();
    try {
      await mkdir(f.root, { recursive: true });
      const marker = join(f.root, id);
      if (kind === "directory") await mkdir(marker);
      else if (kind === "file") await writeFile(marker, "orphan");
      else await symlink(join(f.parent, "missing"), marker, "dir");
      expect(await f.journal.has(id)).toBe(true);
      await expect(f.journal.reserve(intent())).rejects.toThrow();
      await expect(f.journal.complete(receipt())).rejects.toThrow();
      expect(await lstat(marker)).toBeDefined();
    } finally { await f.close(); }
  },
);

test("symlinked roots and assessment directories cannot redirect writes", async () => {
  const f = await fixture();
  try {
    const outside = join(f.parent, "outside");
    await mkdir(outside);
    await mkdir(join(f.parent, "private"));
    await symlink(outside, f.root, "dir");
    await expect(f.journal.reserve(intent())).rejects.toThrow();
    await expect(f.journal.has(id)).rejects.toThrow();
    await expect(f.journal.complete(receipt())).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
    await rm(f.root);
    await mkdir(f.root);
    await symlink(outside, join(f.root, id), "dir");
    expect(await f.journal.has(id)).toBe(true);
    await expect(f.journal.complete(receipt())).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  } finally { await f.close(); }
});

test("a system-style parent alias still resolves to the private journal", async () => {
  const f = await fixture();
  try {
    const physical = join(f.parent, "physical");
    const alias = join(f.parent, "alias");
    await mkdir(physical);
    await symlink(physical, alias, "dir");
    const journal = filePublicationJournal(join(alias, "journal"));
    await journal.reserve(intent());
    await journal.complete(receipt());
    expect(JSON.parse(await readFile(join(physical, "journal", id, "receipt.json"), "utf8"))).toEqual(receipt());
    expect(await journal.has(id)).toBe(true);
  } finally { await f.close(); }
});

test.each(["", "{partial", "null", "[]", JSON.stringify({ assessmentId: id })])(
  "an interrupted or invalid retained intent %j never permits completion", async (body) => {
    const f = await fixture();
    try {
      await mkdir(join(f.root, id), { recursive: true });
      await writeFile(join(f.root, id, "intent.json"), body);
      await expect(f.journal.complete(receipt())).rejects.toThrow();
      expect(await readFile(join(f.root, id, "intent.json"), "utf8")).toBe(body);
      expect(await f.journal.has(id)).toBe(true);
      expect(await readdir(join(f.root, id))).toEqual(["intent.json"]);
    } finally { await f.close(); }
  },
);

test("a symlinked retained intent is refused without writing a receipt", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, id), { recursive: true });
    const outside = join(f.parent, "outside-intent.json");
    await writeFile(outside, JSON.stringify(intent()));
    await symlink(outside, join(f.root, id, "intent.json"));
    await expect(f.journal.complete(receipt())).rejects.toThrow("intent is not a file");
    expect(await readdir(join(f.root, id))).toEqual(["intent.json"]);
    expect(await readFile(outside, "utf8")).toBe(JSON.stringify(intent()));
  } finally { await f.close(); }
});

test.each([
  { resultSha256: "b".repeat(64) }, { origin: "https://other.example" }, { disposition: "clean" as const },
])("receipt identity must match the immutable reservation %j", async (patch) => {
  const f = await fixture();
  try {
    await f.journal.reserve(intent());
    await expect(f.journal.complete({ ...receipt(), ...patch })).rejects.toThrow("no matching intent");
    expect(await readdir(join(f.root, id))).toEqual(["intent.json"]);
  } finally { await f.close(); }
});

test("a different assessment cannot borrow another reservation", async () => {
  const f = await fixture();
  try {
    await f.journal.reserve(intent());
    await mkdir(join(f.root, otherId));
    await writeFile(join(f.root, otherId, "intent.json"), JSON.stringify(intent()));
    await expect(f.journal.complete({ ...receipt(), assessmentId: otherId })).rejects.toThrow("no matching intent");
    expect(await readdir(join(f.root, otherId))).toEqual(["intent.json"]);
  } finally { await f.close(); }
});

test("completion snapshots its receipt before reading the reservation", async () => {
  const f = await fixture();
  try {
    await f.journal.reserve(intent());
    const mutable = receipt(), expected = { ...mutable };
    const pending = f.journal.complete(mutable);
    mutable.assessmentId = otherId;
    mutable.resultSha256 = "b".repeat(64);
    mutable.outcome = "accepted";
    mutable.httpStatus = 200;
    await pending;
    expect(JSON.parse(await readFile(join(f.root, id, "receipt.json"), "utf8"))).toEqual(expected);
  } finally { await f.close(); }
});

test("concurrent and repeated completions preserve the first receipt", async () => {
  const f = await fixture();
  try {
    await f.journal.reserve(intent());
    const first = receipt(), second = { ...receipt(), outcome: "accepted" as const, httpStatus: 200 };
    const results = await Promise.allSettled([f.journal.complete(first), f.journal.complete(second)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const path = join(f.root, id, "receipt.json");
    const bytes = await readFile(path, "utf8");
    expect([JSON.stringify(first), JSON.stringify(second)]).toContain(bytes);
    await expect(filePublicationJournal(f.root).complete(first)).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(bytes);
  } finally { await f.close(); }
});

test("an interrupted receipt or symlink never becomes replaceable", async () => {
  const f = await fixture();
  try {
    await f.journal.reserve(intent());
    const path = join(f.root, id, "receipt.json");
    await writeFile(path, "{partial");
    await expect(f.journal.complete(receipt())).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("{partial");
    await rm(path);
    const outside = join(f.parent, "outside-receipt.json");
    await writeFile(outside, "outside");
    await symlink(outside, path);
    await expect(f.journal.complete(receipt())).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("outside");
    expect(await f.journal.has(id)).toBe(true);
  } finally { await f.close(); }
});

test.each([{ outcome: "invalid" }, { httpStatus: undefined }, { httpStatus: 99 }, { httpStatus: 600 }, { httpStatus: 200.5 }])(
  "invalid receipt metadata %j refuses before creating the journal root", async (patch) => {
    const f = await fixture();
    try {
      await expect(f.journal.complete({ ...receipt(), ...patch } as PublicationReceipt)).rejects.toThrow("receipt is invalid");
      expect(await readdir(f.parent)).toEqual([]);
    } finally { await f.close(); }
  },
);
