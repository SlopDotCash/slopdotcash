import type { ReactNode } from "react";
import { Identity } from "./Identity.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, type TableProps, TableRow } from "./Table.tsx";

export interface LeaderboardRow {
  /** The standing as the caller ranked it; equal totals share a rank. */
  rank: number;
  actor: { login: string; href?: string; avatarUrl?: string };
  /** The Points total, already formatted. */
  points: string;
  /** One fact under the login. */
  detail?: ReactNode;
  /** The row's share of the reward, already formatted. */
  share?: string;
}

export type LeaderboardProps = Omit<TableProps, "children"> & {
  /** Standings in the order to show them. */
  rows: LeaderboardRow[];
  /** The column titles. */
  headings?: { rank: string; actor: string; points: string; share: string };
};

/**
 * Points standings. Ranks are shown as given, so equal totals read as equal ranks.
 * @model spec/frontend/projections.md
 */
export function Leaderboard({ rows, headings = { rank: "Rank", actor: "Contributor", points: "Points", share: "Share" }, ...props }: LeaderboardProps) {
  const shares = rows.some((row) => row.share !== undefined);
  // spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history": rank and points come decided.
  return (
    <Table {...props}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16 text-right">{headings.rank}</TableHead>
          <TableHead>{headings.actor}</TableHead>
          <TableHead className="text-right">{headings.points}</TableHead>
          {shares && <TableHead className="text-right">{headings.share}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.actor.login}>
            <TableCell className="text-right font-mono text-muted-foreground tabular-nums">{row.rank}</TableCell>
            <TableCell>
              <Identity login={row.actor.login} href={row.actor.href} avatarUrl={row.actor.avatarUrl} detail={row.detail} size="sm" />
            </TableCell>
            <TableCell className="text-right font-mono font-medium tabular-nums">{row.points}</TableCell>
            {shares && <TableCell className="text-right font-mono tabular-nums">{row.share}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
