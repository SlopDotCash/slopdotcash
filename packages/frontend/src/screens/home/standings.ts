// spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"
import type { LeaderboardRow } from "@repo/ui";
import { rankAt } from "../../../gen/frontend__projections.ts";

export interface LifetimeTotal {
  readonly actor: { readonly id: string; readonly login: string };
  readonly total: number;
}

export const homeRows = 10;

/** @throws {URIError} */
export function topStandings(totals: ReadonlyArray<LifetimeTotal>): LeaderboardRow[] {
  const points = totals.map((row) => row.total);
  return [...totals]
    .sort((left, right) => right.total - left.total || left.actor.id.localeCompare(right.actor.id))
    .slice(0, homeRows)
    .map((row) => {
      const login = encodeURIComponent(row.actor.login);
      return {
        rank: rankAt(points, row.total),
        actor: { login: row.actor.login, href: `/contributors/${login}`, avatarUrl: `https://avatars.githubusercontent.com/${login}?size=80` },
        points: `${row.total.toLocaleString("en-US")} pts`,
      };
    });
}
