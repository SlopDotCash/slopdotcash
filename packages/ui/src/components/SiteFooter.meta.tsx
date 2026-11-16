import type { ComponentMeta } from "vibestack/stories";
import { Logo } from "./Logo.tsx";
import type { SiteFooterProps } from "./SiteFooter.tsx";

export const meta: ComponentMeta<SiteFooterProps> = {
  args: {
    brand: <Logo size="sm" />,
    children: ["GitHub", "Docs", "X"].map((name) => <a key={name} href={`#${name.toLowerCase()}`}>{name}</a>),
  },
};
