// spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"
import { vectors } from "../../kernels/vectors.ts";
import { totals } from "./fixtures.ts";
import { homeRows, type LifetimeTotal, topStandings } from "./standings.ts";

const many: ReadonlyArray<LifetimeTotal> = Array.from({ length: homeRows + 3 }, (_, index) => ({ actor: { id: `U_${index}`, login: `user${index}` }, total: index * 10 }));

export const homeShowsTheTopTenWithSharedRanks = vectors<ReadonlyArray<LifetimeTotal>, Array<readonly [number, string, string]>>([
  [totals, [[1, "bob", "420 pts"], [1, "alice", "420 pts"], [3, "carol", "60 pts"]]],
  [[], []],
  [many, many.toReversed().slice(0, homeRows).map((row, index) => [index + 1, row.actor.login, `${row.total} pts`] as const)],
], (rows) => topStandings(rows).map((row) => [row.rank, row.actor.login, row.points] as const));
