// spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"
import type { AgentMarkProps } from "@repo/ui";
import { agentShortcuts, opensNewTab } from "../../../gen/frontend__presentation.ts";

export type AgentName = AgentMarkProps["agent"];

const launchers = {
  Cursor: (text: string) => `https://cursor.com/link/prompt?text=${encodeURIComponent(text)}`,
  Claude: (text: string) => `https://claude.ai/new?q=${encodeURIComponent(text)}`,
  ChatGPT: (text: string) => `https://chatgpt.com/?q=${encodeURIComponent(text)}`,
  Grok: (text: string) => `https://grok.com/?q=${encodeURIComponent(text)}`,
  "Meta AI (Muse Spark)": (text: string) => `https://www.meta.ai/?prompt=${encodeURIComponent(text)}`,
  OpenClaw: (text: string) => `openclaw://agent?message=${encodeURIComponent(text)}`,
  "Hermes Agent": (text: string) => `hermes://skill/install?identifier=${encodeURIComponent(text)}`,
} as const satisfies Record<AgentName, (text: string) => string>;

export interface AgentLink {
  readonly agent: AgentName;
  readonly href: string;
  readonly newTab: boolean;
}

const isAgentName = (name: string): name is AgentName => Object.hasOwn(launchers, name);

/** @throws {never} */
export function siteOrigin(origin: string): string {
  return origin.replace(/\/$/u, "");
}

/** @throws {never} */
export function bootstrapPrompt(origin: string): string {
  return `Read ${siteOrigin(origin)}/SKILL.md and follow it.`;
}

/** @throws {URIError} */
export function agentLinks(prompt: string, origin: string): AgentLink[] {
  const skill = `${siteOrigin(origin)}/SKILL.md`;
  return agentShortcuts.flatMap((shortcut) =>
    isAgentName(shortcut.agent) ? [{ agent: shortcut.agent, href: launchers[shortcut.agent](shortcut.carriesPrompt ? prompt : skill), newTab: opensNewTab(shortcut) }] : [],
  );
}
