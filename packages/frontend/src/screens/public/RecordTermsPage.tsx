// spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"
import { PageHeader } from "@repo/ui";
import { PageShell } from "../../app/PageShell.tsx";
import { buyback } from "./terms/buyback.tsx";
import { octoberAllocation } from "./terms/october-allocation.tsx";
import { privacy } from "./terms/privacy.tsx";
import { referrals } from "./terms/referrals.tsx";
import { sponsoredPools } from "./terms/sponsored-pools.tsx";
import type { TermsPage } from "./terms/terms.ts";

export const TERMS_PAGES = {
  referrals,
  buyback,
  "october-allocation": octoberAllocation,
  "sponsored-pools": sponsoredPools,
  privacy,
} satisfies Record<string, TermsPage>;

export type TermsPageName = keyof typeof TERMS_PAGES;

export function RecordTermsPage({ name }: { name: TermsPageName }) {
  const page = TERMS_PAGES[name];
  return (
    <PageShell width="md" gap="6">
      <PageHeader title={page.title} />
      <p className="text-xs text-muted-foreground">{page.stamp}</p>
      {page.status ? <div className="rounded-lg border border-border bg-card p-4 text-sm leading-relaxed text-foreground">{page.status}</div> : null}
      <article className="flex flex-col gap-4 text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_p]:text-muted-foreground [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {page.body}
      </article>
      <p className="border-t border-border pt-4 text-sm text-muted-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4">
        {page.links}
      </p>
    </PageShell>
  );
}
