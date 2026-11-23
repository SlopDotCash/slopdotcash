/**
 * Program terms pages and the privacy policy (PRD section 7, "Public record
 * pages"). Ported from the retired record site; the words of each page live in
 * src/record-terms/.
 */
import { buyback } from "./record-terms/buyback";
import { octoberAllocation } from "./record-terms/october-allocation";
import { privacy } from "./record-terms/privacy";
import { referrals } from "./record-terms/referrals";
import { sponsoredPools } from "./record-terms/sponsored-pools";
import type { TermsPage } from "./record-terms/terms";
import "./record-pages.css";

export const TERMS_PAGES = {
  referrals,
  buyback,
  "october-allocation": octoberAllocation,
  "sponsored-pools": sponsoredPools,
  privacy,
} satisfies Record<string, TermsPage>;

export type TermsPageName = keyof typeof TERMS_PAGES;

export default function RecordTermsPage({ name }: { name: TermsPageName }) {
  const page = TERMS_PAGES[name];
  return (
    <main className="shell route-main record-page record-terms">
      <h1>{page.title}</h1>
      <p className="record-stamp">{page.stamp}</p>
      {page.status ? <div className="record-status">{page.status}</div> : null}
      {page.body}
      <p className="record-links">{page.links}</p>
    </main>
  );
}
