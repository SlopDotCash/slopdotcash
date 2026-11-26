// spec/app/index.md, "Story: Open a page by its address"; spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"
import { SITE_ORIGIN } from "../platform/site.ts";
import { StandingDepositPage } from "../screens/fee/StandingDepositPage.tsx";
import { ReceiptsPage } from "../screens/public/ReceiptsPage.tsx";
import { RecordPage } from "../screens/public/RecordPage.tsx";
import { RecordTermsPage, type TermsPageName } from "../screens/public/RecordTermsPage.tsx";
import type { PageRuntime } from "./runtime.vibe";

export type ExtraRoute =
  | { readonly kind: "Deposit" }
  | { readonly kind: "Record" }
  | { readonly kind: "Receipts" }
  | { readonly kind: "Terms"; readonly name: TermsPageName };

export interface ExtraHead {
  readonly title: string;
  readonly canonical: string | undefined;
}

const termsTitles: Readonly<Record<TermsPageName, string>> = {
  referrals: "Referral program",
  buyback: "SLOP buyback",
  "october-allocation": "October allocation",
  "sponsored-pools": "Sponsored pools",
  privacy: "Privacy policy",
};

export function extraRouteOf(pathname: string): ExtraRoute | undefined {
  const normalized = pathname.replace(/\/+$/u, "") || "/";
  switch (normalized) {
    case "/deposit":
      return { kind: "Deposit" };
    case "/record":
      return { kind: "Record" };
    case "/receipts":
      return { kind: "Receipts" };
    case "/referrals":
      return { kind: "Terms", name: "referrals" };
    case "/buyback":
      return { kind: "Terms", name: "buyback" };
    case "/october-allocation":
      return { kind: "Terms", name: "october-allocation" };
    case "/sponsored-pools":
      return { kind: "Terms", name: "sponsored-pools" };
    case "/privacy":
      return { kind: "Terms", name: "privacy" };
    default:
      return undefined;
  }
}

export function extraRouteHead(route: ExtraRoute): ExtraHead {
  switch (route.kind) {
    case "Deposit":
      return { title: "Standing deposit · Slop", canonical: undefined };
    case "Record":
      return { title: "Public record · Slop", canonical: `${SITE_ORIGIN}/record` };
    case "Receipts":
      return { title: "Receipts · Slop", canonical: `${SITE_ORIGIN}/receipts` };
    case "Terms":
      return { title: `${termsTitles[route.name]} · Slop`, canonical: `${SITE_ORIGIN}/${route.name}` };
    default: {
      const _exhaustive: never = route;
      return _exhaustive;
    }
  }
}

export function ExtraRoutePage({ route, runtime }: { route: ExtraRoute; runtime: PageRuntime }) {
  switch (route.kind) {
    case "Deposit":
      return <StandingDepositPage runtime={runtime} />;
    case "Record":
      return <RecordPage runtime={runtime} />;
    case "Receipts":
      return <ReceiptsPage runtime={runtime} />;
    case "Terms":
      return <RecordTermsPage name={route.name} />;
    default: {
      const _exhaustive: never = route;
      return _exhaustive;
    }
  }
}
