// spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"
import { Arbitrary } from "effect";
import { contract } from "vibestack/testing";
import { agentLinks, bootstrapPrompt } from "./agentLinks.ts";

const sites = ["https://slop.cash", "https://slop.cash/", "http://localhost:5173"] as const;

export const everyAgentOpensWithThePromptAndOnlyWebChatsTakeANewTab = contract({
  input: Arbitrary.Constant(sites),
  run: (origins) => origins.map((origin) => ({ origin, links: agentLinks(bootstrapPrompt(origin), origin) })),
  deterministic: true,
  invariant: (_origins, opened) =>
    opened.every(
      ({ origin, links }) =>
        links.length === 7 &&
        new Set(links.map((link) => link.agent)).size === 7 &&
        links.every((link) => link.newTab === link.href.startsWith("https://")) &&
        links.every((link) => link.href.includes(encodeURIComponent(link.agent === "Hermes Agent" ? `${origin.replace(/\/$/u, "")}/SKILL.md` : bootstrapPrompt(origin)))),
    ),
});
