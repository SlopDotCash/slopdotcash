// The operative /slopbot command in a GitHub comment.
// Closed fenced samples are quotations, not commands. An unclosed fence stays
// visible so a missing closer cannot hide a command. Callers record appeals
// and decisions; this module only finds the command and its reason text.
import { APPEAL_COMMANDS, type AppealCommand } from "./contracts";

export type SlopbotCommandName = "dispute" | "appeal" | AppealCommand;

export type SlopbotCommentCommand = {
  name: SlopbotCommandName;
  /** Index of `/slopbot` in the original comment. */
  index: number;
  /** Index after the command word, a colon, and same-line whitespace. */
  end: number;
};

const OPENING_COMMAND = /^\s*\/slopbot\s+(dispute|appeal)(?::|\s|$)/u;
const DECISION_COMMAND = new RegExp(
  `^\\s*\\/slopbot\\s+(${APPEAL_COMMANDS.join("|")})(?=\\s|$)`,
  "u",
);
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;
const STATEMENT_LIMIT = 4000;

type LineSpan = { start: number; end: number; next: number };

function knownCommand(name: string): name is SlopbotCommandName {
  return (
    name === "dispute" ||
    name === "appeal" ||
    (APPEAL_COMMANDS as readonly string[]).includes(name)
  );
}

function lineSpans(text: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const carriage = text[index] === "\r";
    const newline = text[index] === "\n";
    if (!carriage && !newline) continue;
    let next = index + 1;
    if (carriage && text[next] === "\n") next += 1;
    spans.push({ start, end: index, next });
    start = next;
    index = next - 1;
  }
  spans.push({ start, end: text.length, next: text.length });
  return spans;
}

/** Ranges of closed CommonMark fences, in source order. An unclosed opener
 * is omitted, matching the discovery rule that a missing closer stays visible.
 */
function closedFenceRanges(
  text: string,
  spans: readonly LineSpan[],
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let open: { marker: string; length: number; start: number } | null = null;
  for (const span of spans) {
    const line = text.slice(span.start, span.end);
    if (open) {
      const closing = FENCE_CLOSE.exec(line);
      if (
        closing?.[1] &&
        closing[1][0] === open.marker &&
        closing[1].length >= open.length
      ) {
        ranges.push({ start: open.start, end: span.next });
        open = null;
      }
      continue;
    }
    const opening = FENCE_OPEN.exec(line);
    if (opening?.[1] && !(opening[1][0] === "`" && opening[2]?.includes("`")))
      open = {
        marker: opening[1][0] ?? "`",
        length: opening[1].length,
        start: span.start,
      };
  }
  return ranges;
}

function commandOnLine(
  line: string,
): { name: SlopbotCommandName; start: number; end: number } | null {
  const match = OPENING_COMMAND.exec(line) ?? DECISION_COMMAND.exec(line);
  const name = match?.[1];
  if (!match || !name || !knownCommand(name)) return null;
  const slash = match[0].indexOf("/slopbot");
  if (slash < 0) return null;
  let end = match[0].length;
  while (end < line.length && /\s/u.test(line.charAt(end))) end += 1;
  return { name, start: slash, end };
}

/** The first operative command. A later line does not replace it, and a
 * command inside a closed fence does not count.
 */
export function slopbotCommentCommand(
  text: string,
): SlopbotCommentCommand | null {
  const spans = lineSpans(text);
  const hidden = closedFenceRanges(text, spans);
  let hiddenIndex = 0;
  for (const span of spans) {
    while (
      hiddenIndex < hidden.length &&
      hidden[hiddenIndex] !== undefined &&
      hidden[hiddenIndex].end <= span.start
    )
      hiddenIndex += 1;
    const range = hidden[hiddenIndex];
    if (range && span.start >= range.start && span.start < range.end) continue;
    const command = commandOnLine(text.slice(span.start, span.end));
    if (command === null) continue;
    return {
      name: command.name,
      index: span.start + command.start,
      end: span.start + command.end,
    };
  }
  return null;
}

/** Appeal or dispute text with the operative command removed. A decision
 * command and a fenced-only sample return null.
 */
export function appealCommandStatement(body: string): string | null {
  const command = slopbotCommentCommand(body);
  if (
    command === null ||
    (command.name !== "appeal" && command.name !== "dispute")
  )
    return null;
  const statement = `${body.slice(0, command.index)}${body.slice(command.end)}`
    .trim()
    .slice(0, STATEMENT_LIMIT);
  return statement.length > 0 ? statement : "(no reason given)";
}
