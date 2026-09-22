import { TARGET_REPOSITORIES } from "./repositories.mjs";
export interface ProfileRecord {
  id: string;
  login: string;
  avatarUrl: string;
  repositories: {
    repository: string;
    merged: number;
    open: number;
    closed: number;
  }[];
}
export interface ProfileIndex {
  schemaVersion: "1";
  startedAt: string;
  generatedAt: string;
  repositories: { repository: string; count: number; excluded: number }[];
  people: ProfileRecord[];
}
export function assertProfiles(value: unknown): asserts value is ProfileIndex {
  const v = value as ProfileIndex;
  const validCount = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (
    !v ||
    v.schemaVersion !== "1" ||
    !Number.isFinite(Date.parse(v.startedAt)) ||
    !Number.isFinite(Date.parse(v.generatedAt)) ||
    Date.parse(v.startedAt) > Date.parse(v.generatedAt) ||
    !Array.isArray(v.people) ||
    !Array.isArray(v.repositories)
  )
    throw Error("Invalid profile census");
  const targets = TARGET_REPOSITORIES.map((r) => r.id).sort();
  if (
    JSON.stringify(v.repositories.map((r) => r.repository).sort()) !==
    JSON.stringify(targets)
  )
    throw Error("Profile repository inventory mismatch");
  const ids = new Set<string>();
  const totals = new Map<string, number>();
  for (const p of v.people) {
    if (
      !p ||
      typeof p.id !== "string" ||
      typeof p.login !== "string" ||
      !/^[A-Za-z0-9_=-]{4,256}$/.test(p.id) ||
      ids.has(p.id) ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(p.login) ||
      !Array.isArray(p.repositories)
    )
      throw Error("Invalid profile identity");
    ids.add(p.id);
    const url = new URL(p.avatarUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "avatars.githubusercontent.com" ||
      url.username ||
      url.password ||
      url.port
    )
      throw Error("Invalid profile image");
    const repos = new Set<string>();
    for (const r of p.repositories) {
      if (
        !targets.includes(r.repository) ||
        repos.has(r.repository) ||
        ![r.merged, r.open, r.closed].every(validCount)
      )
        throw Error("Invalid profile counts");
      repos.add(r.repository);
      totals.set(
        r.repository,
        (totals.get(r.repository) ?? 0) + r.merged + r.open + r.closed,
      );
    }
  }
  for (const r of v.repositories)
    if (
      ![r.count, r.excluded].every(validCount) ||
      (totals.get(r.repository) ?? 0) + r.excluded !== r.count
    )
      throw Error("Incomplete profile census");
}
export function profileCounts(p: ProfileRecord) {
  return p.repositories.reduce(
    (a, r) => ({
      merged: a.merged + r.merged,
      open: a.open + r.open,
      closed: a.closed + r.closed,
    }),
    { merged: 0, open: 0, closed: 0 },
  );
}
