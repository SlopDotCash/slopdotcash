// spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"; spec/backend/accounts.md, "Public reads show only public open members and never publish anything"
import type { Person } from "@repo/backend/client";
import type { ProfileIndex } from "@repo/points/client";
import type { Shown } from "../home/listing.ts";
import { type JournalRow, type StandingHistory, standingHistory } from "./standings.ts";

export const nowMs = Date.parse("2026-11-17T12:00:00.000Z");

const actors = {
  alice: { id: "U_kgDOAAAD6Q", login: "alice" },
  bob: { id: "U_kgDOAAAD6g", login: "bob" },
  carol: { id: "U_kgDOAAAD6w", login: "carol" },
  dave: { id: "U_kgDOAAAD7A", login: "dave" },
};

function row(key: string, actor: { id: string; login: string }, category: string, amount: number, occurredAt: string): JournalRow {
  return { recordedAt: occurredAt, award: { key, actor, projectId: "slop", category, amount, occurredAt } };
}

export const journal = {
  generatedAt: "2026-11-17T00:00:00.000Z",
  revisions: [
    row("a1", actors.alice, "merged-pull-request", 30, "2026-11-05T10:00:00.000Z"),
    row("b1", actors.bob, "merged-pull-request", 30, "2026-11-06T10:00:00.000Z"),
    row("b2", actors.bob, "slopbot-penalty", -50, "2026-11-07T10:00:00.000Z"),
    row("c1", actors.carol, "merged-pull-request", 20, "2026-10-02T10:00:00.000Z"),
    row("d1", actors.dave, "resolved-issue", 30, "2026-11-08T10:00:00.000Z"),
  ],
};

export const history: StandingHistory = standingHistory(journal);

export const current = <T>(value: T): Shown<T> => ({ status: "Current", value, onRetry: () => undefined });
export const loading = <T>(): Shown<T> => ({ status: "Loading", value: undefined });
export const failed = <T>(): Shown<T> => ({ status: "Failed", value: undefined, onRetry: () => undefined });
export const stale = <T>(value: T): Shown<T> => ({ status: "Stale", value, onRetry: () => undefined });

export const census: ProfileIndex = {
  schemaVersion: "1",
  startedAt: "2026-10-01T00:00:00.000Z",
  generatedAt: "2026-11-17T00:00:00.000Z",
  repositories: [],
  people: [
    { id: actors.alice.id, login: "alice", avatarUrl: "https://avatars.githubusercontent.com/u/1001?v=4", repositories: [{ repository: "slopdotcash/slop", merged: 4, open: 1, closed: 1 }] },
    { id: actors.carol.id, login: "carol", avatarUrl: "https://avatars.githubusercontent.com/u/1003?v=4", repositories: [{ repository: "slopdotcash/slop", merged: 1, open: 0, closed: 0 }] },
  ],
};

export const people: ReadonlyArray<Person> = [
  { actor: { id: actors.alice.id, login: "alice" }, welcome: 5, socialPoints: 10, x: { id: "44196397", username: "alice_x", verifiedAt: "2026-11-01T00:00:00.000Z" } },
  { actor: { id: "U_kgDOAAAD7Q", login: "erin" }, welcome: 5, socialPoints: 0, x: null },
];

export const stewards: ReadonlyMap<string, ReadonlyArray<string>> = new Map([[actors.alice.id, ["Slop"]]]);
