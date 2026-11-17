// spec/frontend/navigation.md, "Every existing product route is one Page and only private destinations need an account"; spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"
import type { ComponentType, ReactNode } from "react";
import type { Route, RouteKind } from "../../gen/app.ts";
import type { PageRuntime } from "./runtime.vibe";

export type PageKind = Exclude<RouteKind, "Unknown">;

export type Frame = (children?: ReactNode, title?: string) => ReactNode;

export type PageProps = {
  runtime: PageRuntime;
  route: Route;
};

export type RegisteredPage = ComponentType<PageProps>;

export const signInPurposes: Partial<Record<PageKind, string>> = {
  ManageProject: "Sign in with a maintainer account to change project settings.",
  SecurityCases: "Sign in to see your security cases.",
};
