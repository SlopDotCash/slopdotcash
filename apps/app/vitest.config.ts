import tailwindcss from "@tailwindcss/vite";
import { project } from "vibestack/testing/vitest";

/** The browser tests see the page as main.css styles it, so a missing focus ring or token fails them. */
export default project({ root: import.meta.dirname, plugins: [tailwindcss()] });
