// spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"
import type { ReactNode } from "react";

export interface TermsPage {
  readonly title: string;
  readonly stamp: string;
  readonly status?: ReactNode;
  readonly body: ReactNode;
  readonly links: ReactNode;
}
