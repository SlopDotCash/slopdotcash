// spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent's skill address together"; spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"
import { skillPath } from "../../../gen/frontend__presentation.ts";
import { vectors } from "../../kernels/vectors.ts";
import { agentLinks, bootstrapPrompt } from "./agentLinks.ts";
import { journeyAddress, journeyOf } from "./audience.ts";

const at = (href: string) => new URL(href);

export const theAudienceParameterAloneNamesTheJourney = vectors<string, string>([
  ["https://slop.cash/", "Contributor"],
  ["https://slop.cash/?audience=maintainer", "Maintainer"],
  ["https://slop.cash/?audience=contributor", "Contributor"],
  ["https://slop.cash/?audience=Maintainer", "Contributor"],
  ["https://slop.cash/?audience=invalid#projects", "Contributor"],
  ["https://slop.cash/?ref=x&audience=maintainer#leaderboard", "Maintainer"],
], (href) => journeyOf(at(href)));

export const choosingAJourneyChangesOnlyTheAudienceParameter = vectors<[string, "Contributor" | "Maintainer"], string>([
  [["https://slop.cash/", "Maintainer"], "https://slop.cash/?audience=maintainer"],
  [["https://slop.cash/?audience=maintainer", "Contributor"], "https://slop.cash/"],
  [["https://slop.cash/?ref=x#projects", "Maintainer"], "https://slop.cash/?ref=x&audience=maintainer#projects"],
  [["https://slop.cash/?ref=x&audience=maintainer#projects", "Contributor"], "https://slop.cash/?ref=x#projects"],
  [["https://slop.cash/?audience=invalid", "Contributor"], "https://slop.cash/"],
], ([href, journey]) => journeyAddress(at(href), journey).href);

export const thePromptAndEveryShortcutNameTheJourneysSkill = vectors<"Contributor" | "Maintainer", readonly [string, string | undefined, string | undefined, string | undefined]>([
  [
    "Contributor",
    [
      "Read https://slop.cash/contribute/SKILL.md and follow it.",
      `hermes://skill/install?identifier=${encodeURIComponent("https://slop.cash/contribute/SKILL.md")}`,
      `claude://code/new?q=${encodeURIComponent("Read https://slop.cash/contribute/SKILL.md and follow it.")}`,
      `codex://new?prompt=${encodeURIComponent("Read https://slop.cash/contribute/SKILL.md and follow it.")}`,
    ],
  ],
  [
    "Maintainer",
    [
      "Read https://slop.cash/maintain/SKILL.md and follow it.",
      `hermes://skill/install?identifier=${encodeURIComponent("https://slop.cash/maintain/SKILL.md")}`,
      `claude://code/new?q=${encodeURIComponent("Read https://slop.cash/maintain/SKILL.md and follow it.")}`,
      `codex://new?prompt=${encodeURIComponent("Read https://slop.cash/maintain/SKILL.md and follow it.")}`,
    ],
  ],
], (journey) => {
  const prompt = bootstrapPrompt("https://slop.cash/", skillPath(journey));
  const links = agentLinks(prompt, "https://slop.cash/", skillPath(journey));
  return [
    prompt,
    links.find((link) => link.agent === "Hermes Agent")?.href,
    links.find((link) => link.agent === "Claude Code")?.href,
    links.find((link) => link.agent === "Codex")?.href,
  ];
});
