// spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"; spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent's skill address together"
import type { AgentMarkProps } from "@repo/ui";
import { type AgentPayload, agentShortcuts, opensNewTab, siteSkillPath } from "../../../gen/frontend__presentation.ts";

export type AgentName = AgentMarkProps["agent"];

const CURSOR_URL_LIMIT = 10_000;
const OPENCLAW_PROMPT_LIMIT = 240;
const GROK_BOT_PROMPT_LIMIT = 1_000;
const GROK_BOT_URL_LIMIT = 2_048;
const graphemeSegmenter = new Intl.Segmenter();

function encodeLinkValue(value: string): string {
  return encodeURIComponent(value.replace(/[\ud800-\udfff]/gu, "\ufffd"));
}

function graphemeLength(value: string): number {
  let count = 0;
  for (const _segment of graphemeSegmenter.segment(value)) count += 1;
  return count;
}

const launchers = {
  "Claude Code": (text: string) => `claude://code/new?q=${encodeLinkValue(text)}`,
  Codex: (text: string) => `codex://new?prompt=${encodeLinkValue(text)}`,
  Cursor: (text: string) => {
    const url = `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(encodeLinkValue(text))}`;
    return url.length <= CURSOR_URL_LIMIT ? url : "cursor://anysphere.cursor-deeplink/prompt";
  },
  Antigravity: (text: string) => `antigravity://open?prompt=${encodeLinkValue(text)}`,
  OpenClaw: (text: string) => (graphemeLength(text) <= OPENCLAW_PROMPT_LIMIT ? `openclaw://agent?message=${encodeLinkValue(text)}` : "openclaw://dashboard"),
  "Hermes Agent": (skillUrl: string) => `hermes://skill/install?identifier=${encodeLinkValue(skillUrl)}`,
  "GitHub Copilot": (text: string) => `ghapp://session/new?prompt=${encodeLinkValue(text)}`,
  "Grok Bot": (text: string) => {
    const sanitized = text.replace(/\p{Cc}/gu, " ");
    const url = `grokbot://app/v1/prompt?text=${encodeLinkValue(sanitized)}`;
    return sanitized.length <= GROK_BOT_PROMPT_LIMIT && url.length <= GROK_BOT_URL_LIMIT ? url : "grokbot://app/v1/prompt";
  },
  "Meta Muse": () => "https://agent.meta.ai/chat",
  OpenCode: () => "opencode://",
} as const satisfies Record<AgentName, (value: string) => string>;

export interface AgentLink {
  readonly agent: AgentName;
  readonly href: string;
  readonly newTab: boolean;
}

const isAgentName = (name: string): name is AgentName => Object.hasOwn(launchers, name);

function payloadValue(payload: AgentPayload, prompt: string, skill: string): string {
  switch (payload) {
    case "PromptPayload":
      return prompt;
    case "SkillPayload":
      return skill;
    case "LaunchOnly":
      return "";
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}

/** @throws {never} */
export function siteOrigin(origin: string): string {
  return origin.replace(/\/$/u, "");
}

/** @throws {never} */
export function bootstrapPrompt(origin: string, skillPath: string = siteSkillPath): string {
  return `Read ${siteOrigin(origin)}${skillPath} and follow it.`;
}

/** @throws {never} */
export function projectSkillPath(slug: string): string {
  return `/projects/${encodeLinkValue(slug)}/SKILL.md`;
}

/** @throws {never} */
export function agentLinks(prompt: string, origin: string, skillPath: string = siteSkillPath): AgentLink[] {
  const skill = `${siteOrigin(origin)}${skillPath}`;
  return agentShortcuts.flatMap((shortcut) =>
    isAgentName(shortcut.agent) ? [{ agent: shortcut.agent, href: launchers[shortcut.agent](payloadValue(shortcut.payload, prompt, skill)), newTab: opensNewTab(shortcut) }] : [],
  );
}
