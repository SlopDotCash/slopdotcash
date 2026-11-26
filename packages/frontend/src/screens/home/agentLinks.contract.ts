// spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"
import { Arbitrary } from "effect";
import { contract } from "vibestack/testing";
import { agentLinks, bootstrapPrompt, projectSkillPath } from "./agentLinks.ts";

const sites = ["https://slop.cash", "https://slop.cash/", "http://localhost:5173"] as const;

export const everyDesktopAgentMatchesItsVerifiedSchemeAndOnlyHandoffsTakeANewTab = contract({
  input: Arbitrary.Constant(sites),
  run: (origins) =>
    origins.map((origin) => {
      const prompt = bootstrapPrompt(origin);
      const encoded = encodeURIComponent(prompt);
      const skill = encodeURIComponent(`${origin.replace(/\/$/u, "")}/SKILL.md`);
      const projectSkill = encodeURIComponent(`${origin.replace(/\/$/u, "")}${projectSkillPath("eliza")}`);
      const punctuationPrompt = "Fix a+b and %2F\nline two";
      return {
        links: agentLinks(prompt, origin),
        expected: [
          ["Claude Code", `claude://code/new?q=${encoded}`, false],
          ["Codex", `codex://new?prompt=${encoded}`, false],
          ["Cursor", `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(encoded)}`, false],
          ["Antigravity", `antigravity://open?prompt=${encoded}`, false],
          ["OpenClaw", `openclaw://agent?message=${encoded}`, false],
          ["Hermes Agent", `hermes://skill/install?identifier=${skill}`, false],
          ["GitHub Copilot", `ghapp://session/new?prompt=${encoded}`, false],
          ["Grok Bot", `grokbot://app/v1/prompt?text=${encoded}`, false],
          ["Meta Muse", "https://agent.meta.ai/chat", true],
          ["OpenCode", "opencode://", false],
        ] as const,
        projectHermes: agentLinks(prompt, origin, projectSkillPath("eliza")).find((link) => link.agent === "Hermes Agent")?.href,
        expectedProjectHermes: `hermes://skill/install?identifier=${projectSkill}`,
        cursorPunctuation: agentLinks(punctuationPrompt, origin).find((link) => link.agent === "Cursor")?.href,
        expectedCursorPunctuation: `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(encodeURIComponent(punctuationPrompt))}`,
        grokControl: agentLinks(punctuationPrompt, origin).find((link) => link.agent === "Grok Bot")?.href,
        expectedGrokControl: `grokbot://app/v1/prompt?text=${encodeURIComponent("Fix a+b and %2F line two")}`,
        longOpenClaw: agentLinks("a".repeat(241), origin).find((link) => link.agent === "OpenClaw")?.href,
      };
    }),
  deterministic: true,
  invariant: (_origins, opened) =>
    opened.every(
      ({ links, expected, projectHermes, expectedProjectHermes, cursorPunctuation, expectedCursorPunctuation, grokControl, expectedGrokControl, longOpenClaw }) =>
        links.length === expected.length &&
        links.every((link, index) => {
          const row = expected[index];
          return row !== undefined && link.agent === row[0] && link.href === row[1] && link.newTab === row[2] && link.newTab === link.href.startsWith("https://");
        }) &&
        projectHermes === expectedProjectHermes &&
        cursorPunctuation === expectedCursorPunctuation &&
        grokControl === expectedGrokControl &&
        longOpenClaw === "openclaw://dashboard",
    ),
});
