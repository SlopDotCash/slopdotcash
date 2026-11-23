import type { ReactNode } from "react";

/**
 * One terms page. Each page's words live in its own module beside this one,
 * so a status box or date changes in one place.
 */
export type TermsPage = {
  title: string;
  /** "Terms set ... Status updated ..." or "Last updated ...". */
  stamp: string;
  status?: ReactNode;
  body: ReactNode;
  links: ReactNode;
};
