import type { ComponentMeta } from "vibestack/stories";
import type { LogoProps } from "./Logo.tsx";

export const meta: ComponentMeta<LogoProps> = {
  examples: { Wordmark: { wordmark: true }, Inverse: { variant: "inverse" }, Small: { size: "sm", wordmark: true }, Large: { size: "lg" } },
};
