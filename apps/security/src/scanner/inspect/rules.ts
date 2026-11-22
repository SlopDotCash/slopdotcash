// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"
import { sha256Of } from "@repo/platform/git/bytes";
import type { ScanFinding, ScanSurface, ScanThreat } from "./model.ts";
import { basename } from "./surfaces.ts";

interface Rule {
  readonly threat: ScanThreat;
  readonly severity: "medium" | "high";
  readonly pattern: RegExp;
  readonly summary: string;
  readonly surfaces?: ScanSurface[];
}

const INSTALL_HOOKS = ["preinstall", "install", "postinstall", "prepare", "prepublish"];
const COMPOSER_INSTALL_HOOKS = ["pre-install-cmd", "post-install-cmd", "pre-update-cmd", "post-update-cmd", "post-autoload-dump"];

/** @throws {never} */
function commandToken(name: string): string {
  const word = String.raw`(?:[^\s|;&<>()'"]*/)?${name}`;
  return String.raw`(?:"${word}"|'${word}'|${word})(?:\\\r?\n)*(?=$|[\s|;&<>()'"])`;
}
const SHELL_COMMAND = commandToken("(?:ba|da|k|a|z|fi|t?c)?sh");
const ENV_COMMAND = commandToken("env");
const SUDO_COMMAND = commandToken("sudo");
const INTERPRETER_COMMAND = commandToken(
  String.raw`(?:python(?:3(?:\.\d+)?)?|perl|ruby|node(?:js)?|php|lua)`,
);
const INTERPRETER_PIPE_TARGET = String.raw`(?:${INTERPRETER_COMMAND}(?:\s+-)?|${commandToken(String.raw`python(?:3(?:\.\d+)?)?`)}\s+-u(?:\s+-)?)`;

const RULES: Rule[] = [
  {
    threat: "wallet-drainer",
    severity: "high",
    pattern:
      /\.config\/solana\/id\.json|wallet\.dat|nkbihfbeogaeaoehlefnkodbefgpgknn|bfnaelmomeimhlpmgjnjophhpkkoljpa|(?<=["'`/\\}])Local Extension Settings\b|\.ethereum\/keystore/iu,
    summary: "Reads a wallet key file or browser wallet extension store",
  },
  {
    threat: "wallet-drainer",
    severity: "medium",
    pattern:
      /\b(?:mnemonic|seed[ _-]?phrase|private[ _-]?key)\b[^\n]{0,120}\b(?:fetch|axios|https?:\/\/|XMLHttpRequest|sendTransaction|sendSignedTransaction|signTransaction|sendRawTransaction|eth_sendRawTransaction|eth_sendTransaction|transfer)\b/iu,
    summary: "Handles a seed phrase or private key next to a network send",
  },
  {
    threat: "credential-theft",
    severity: "high",
    pattern:
      /~\/\.ssh\/|\bid_(?:rsa|ed25519|ecdsa)\b|\.aws\/credentials|\.git-credentials|\.netrc\b|\.config\/gh\/hosts\.yml|(?<=["'`/\\}])Login Data\b|security find-(?:generic|internet)-password|\bgh auth token\b/iu,
    summary: "Reads a stored credential, key or password store",
  },
  {
    threat: "credential-theft",
    severity: "medium",
    pattern: /~\/\.npmrc|\.pypirc|\.docker\/config\.json|\.kube\/config/iu,
    summary: "Reads a package-registry or cluster credential file",
  },
  {
    threat: "secret-exfiltration",
    severity: "high",
    pattern:
      /discord(?:app)?\.com\/api\/webhooks|api\.telegram\.org\/bot|webhook\.site|requestbin|pipedream\.net|pastebin\.com\/api|transfer\.sh|ngrok(?:-free)?\.(?:io|app)|interact\.sh|oast\.(?:fun|live|site)/iu,
    summary:
      "Sends data to a webhook or paste endpoint commonly used for exfiltration",
  },
  {
    threat: "secret-exfiltration",
    severity: "high",
    pattern:
      /JSON\.stringify\(\s*process\.env\s*\)|json\.dumps\(\s*(?:dict\()?\s*os\.environ|\b(?:env|printenv)\s*\|\s*(?:(?:[^\s|;&<>()'"]*\/)?(?:sudo|doas|busybox|env)(?:\s+-\S+)*\s+)*(?:[^\s|;&<>()'"]*\/)?(?:curl|wget|ncat|netcat|nc)\b/iu,
    summary: "Serializes the whole environment, which holds secrets",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    pattern: new RegExp(
      String.raw`\b(?:curl|wget)\b[^\n|]*(?:\\[ \t]*\r?\n[^\n|]*)*\|\s*(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?${SHELL_COMMAND}|(?:^|[\s;|&()'"])(?:${ENV_COMMAND}\s+)?${SHELL_COMMAND}\s+-c\s+["']?\$\(\s*(?:curl|wget)\b|(?:^|[\s;|&()'"])eval\s+["']?(?:\$\(|\x60)\s*(?:curl|wget)\b|\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*(?:iex|Invoke-Expression)\b|\.DownloadString\s*\([^\n]*\)\s*\|\s*(?:iex|Invoke-Expression)\b|(?:iex|Invoke-Expression)\s*\(+\s*(?:New-Object\s+(?:System\.)?Net\.WebClient|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)|\b(?:powershell|pwsh)[^\n]*-(?:e|enc|encodedcommand)\s`,
      "iu",
    ),
    summary: "Runs a remote download in a shell",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    pattern: new RegExp(
      String.raw`(?:^|[\s;|&()'"])(?:(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?${SHELL_COMMAND}\s+|source\s+|\.\s+)<\(\s*(?:curl|wget)\b`,
      "iu",
    ),
    summary: "Runs a remote download in a shell via process substitution",
  },

  {
    threat: "unsafe-execution",
    severity: "high",
    pattern:
      /\beval\s*\(\s*(?:atob|Buffer\.from|unescape|decodeURIComponent)\s*\(|\bexec\s*\(\s*(?:base64\.b64decode|zlib\.decompress|marshal\.loads)|new\s+Function\s*\(\s*(?:atob|Buffer\.from)\s*\(/iu,
    summary: "Executes decoded or obfuscated code",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    pattern:
      /(?<![\w.])(?:eval|exec)\s*\(\s*(?:(?:urllib(?:\.request)?\.)?urlopen\s*\([^()\n]*\)\s*\.read\s*\(\s*\)|requests\.[a-z]+\s*\([^()\n]*\)\s*\.text\b)|(?<![\w.])(?:eval|new\s+Function)\s*\(\s*await\s+\(\s*await\s+fetch\s*\([^()\n]*\)\s*\)\s*\.text\s*\(\s*\)/iu,
    summary: "Executes code fetched from the network",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    pattern: new RegExp(
      String.raw`\b(?:curl|wget)\b[^\n|]*\|\s*(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?${INTERPRETER_PIPE_TARGET}(?=\s*(?:$|[|;&<>()]))`,
      "iu",
    ),
    summary: "Runs a remote download in an interpreter",
  },
  {
    threat: "unsafe-execution",
    severity: "medium",
    pattern: /\b(?:child_process|subprocess|os\.system|spawnSync|execSync)\b/u,
    summary: "An install-time script starts processes",
    surfaces: ["installScripts"],
  },
  {
    threat: "prompt-injection",
    severity: "medium",
    pattern:
      /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions|prompts|rules)|\byou\s+are\s+now\s+(?:in\s+)?(?:developer|admin|god|jailbreak)|\b(?:do\s+not|don['\u2019]?t)\s+(?:tell|inform|show|alert|notify)\s+the\s+(?:user|operator|human)\s+(?:about|that|what|this|these|it\b|anything)|\b(?:hide|conceal|keep)\s+(?:this|it|these|them)\s+(?:secret\s+)?from\s+the\s+(?:user|operator|human)\b|\b(?:do\s+not|don['\u2019]?t)\s+let\s+the\s+(?:user|operator|human)\s+(?:know|see|find\s+out)\b/iu,
    summary: "Text matches wording used to override agent instructions",
  },
  {
    threat: "prompt-injection",
    severity: "medium",
    pattern:
      /(?<![^\n])(?![^\n]*\b(?:never|not|don['\u2019]?t|avoid|without|refuse)\b)[^\n]*\b(?:send|post|upload|exfiltrate|paste|forward|transmit|share|email)\b[^\n]{0,60}(?:\b(?:api[ _-]?keys?|tokens?|secrets?|credentials?|passwords?|private[ _-]keys?|seed[ _-]phrases?|mnemonics?)\b|\.env\b)[^\n]{0,60}\b(?:to|into|via|at|with)\s+(?:https?:\/\/|(?:a|an|the|this|that|my|our|your)\s+(?:[\w-]+\s+)?(?:webhook|url|endpoint|server|channel|gist|pastebin|address|inbox|form|dm|discord|telegram|slack|bot))/iu,
    summary: "Text matches wording about sending secrets",
    surfaces: ["agentInstructions"],
  },
  {
    threat: "prompt-injection",
    severity: "medium",
    pattern: /[\u200b\u2060\u202a-\u202e\u2066-\u2069\u{E0000}-\u{E007F}]/u,
    summary: "Hidden or reordered text in instructions",
    surfaces: ["agentInstructions"],
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    pattern: new RegExp(
      String.raw`\b(?:curl|wget)\b[^\n|]*(?:\\[ \t]*\r?\n[^\n|]*)*\|\s*(?:${commandToken("base64")}\s+(?:-d|-D|--decode|-di|-id)|${commandToken("xxd")}\s+(?:-r(?:\s+-p)?|-p\s+-r)|${commandToken("uudecode")}\s+-o\s+/dev/stdout|${commandToken("openssl")}\s+(?:base64\s+-d|enc\s+(?:-d\s+-(?:a|base64)|-(?:a|base64)\s+-d)))\s*\|\s*(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?(?:${SHELL_COMMAND}(?:\s+-)?|${INTERPRETER_PIPE_TARGET})(?=\s*(?:$|[|;&<>()]))`,
      "iu",
    ),
    summary: "Runs a decoded remote download in a shell or interpreter",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    pattern:
      /(?:^[ \t]*|:[ \t]*")(?:deno[ \t]+run[ \t]+(?:(?:-A|--allow-all)[ \t]+)*|mshta(?:\.exe)?[ \t]+)["']?https?:\/\//imu,
    summary: "Runs a remote script URL directly",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    pattern:
      /(?<![\w.$])(?:eval|exec)\s*\(\s*(?:Net::HTTP\.get\s*\(\s*URI\s*\(\s*["']https?:\/\/[^"'()\r\n]+["']\s*\)\s*\)|Net::HTTP\.get_response\s*\(\s*URI\s*\(\s*["']https?:\/\/[^"'()\r\n]+["']\s*\)\s*\)\s*\.body\b|URI\.open\s*\(\s*["']https?:\/\/[^"'()\r\n]+["']\s*\)\s*\.read\b(?:\s*\(\s*\))?|(?:file_get_contents|get)\s*\(\s*["']https?:\/\/[^"'()\r\n]+["']\s*\))\s*\)|(?<![\w.$])(?:include|require)(?:_once)?\s*\(?\s*["']https?:\/\//u,
    summary: "Executes code fetched from the network",
  },
  {
    threat: "unsafe-execution",
    severity: "high",
    pattern: new RegExp(
      String.raw`(?:^|[\n;|&])[ \t]*curl\b(?=[^\n;|&]*https?://)[^\n;|&]*?(?<![\w-])(?:-o|--output)(?:=|\s+)["']?([A-Za-z0-9._~/%+=@][A-Za-z0-9._~/%+=@-]*)["']?(?=$|[\s;|&])[\s\S]{0,8192}?(?:^|[\n;|&])[ \t]*(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?(?:(?:${SHELL_COMMAND}|${INTERPRETER_COMMAND}|source|\.)\s+["']?(?:\./)?|["']?(?:\./|(?=/)))\1["']?(?=$|[\s|;&<>()'"])|(?:^|[\n;|&])[ \t]*wget\b(?=[^\n;|&]*https?://)[^\n;|&]*?(?<![\w-])(?:-O|--output-document)(?:=|\s+)["']?([A-Za-z0-9._~/%+=@][A-Za-z0-9._~/%+=@-]*)["']?(?=$|[\s;|&])[\s\S]{0,8192}?(?:^|[\n;|&])[ \t]*(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?(?:(?:${SHELL_COMMAND}|${INTERPRETER_COMMAND}|source|\.)\s+["']?(?:\./)?|["']?(?:\./|(?=/)))\2["']?(?=$|[\s|;&<>()'"])|(?:^|[\n;|&])[ \t]*(?:curl|wget)\b(?=[^\n;|&]*https?://)[^\n;|&]*?(?<![\d&])>\s*["']?([A-Za-z0-9._~/%+=@][A-Za-z0-9._~/%+=@-]*)["']?(?=$|[\s;|&])[\s\S]{0,8192}?(?:^|[\n;|&])[ \t]*(?:${SUDO_COMMAND}\s+)?(?:${ENV_COMMAND}\s+)?(?:(?:${SHELL_COMMAND}|${INTERPRETER_COMMAND}|source|\.)\s+["']?(?:\./)?|["']?(?:\./|(?=/)))\3["']?(?=$|[\s|;&<>()'"])`,
      "mu",
    ),
    summary: "Executes a file staged by an earlier download in the same file",
  },
];

export const RULE_POLICY_SHA256 = sha256Of(
  JSON.stringify({
    schemaVersion: "slop-deterministic-rules-v1",
    xmlAttributeWhitespace: "msbuild-and-ant-build-xml-literal-cr-lf-to-space",
    xmlAttributeCharacterReferences: "decimal-hex-and-predefined-entities",
    xmlElementCharacterReferences:
      "msbuild-element-text-except-exec-comments-and-cdata",
    compressedInputs:
      "complete-gzip-stream-crc-and-members-derived-payload-and-header-v2",
    localInstallHelpers: "literal-shell-exec-wrapper-closure-v2",
    sourceClassification: "all-acquired-text-unknown-bytes-incomplete-v1",
    imageFormats: "png-jpeg-gif-webp-whole-structure-v1",
    templateReview: "queued-canonical-template-deterministic-only-v1",
    rules: RULES.map(({ pattern, ...rule }) => ({
      ...rule,
      pattern: { source: pattern.source, flags: pattern.flags },
    })),
  }),
);

export const DOWNLOAD =
  /(?:\b(?:curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm|aria2c|axel)\b|\bStart-BitsTransfer\b(?![^\n]*-TransferType\s+["']?Upload\b)|\bcertutil(?:\.exe)?\b[^\n]*?-urlcache\b|\bbitsadmin\b(?![^\n]*\/upload\b)[^\n]*?\/transfer\b)[^\n]*?(https?:\/\/[^\s"'`)|]+)|\b(?:fetch|urlopen|requests\.get|https?\.get)\s*\(\s*["'`](https?:\/\/[^"'`]+)["'`]/giu;

/** @throws {never} */
function lineOf(text: string, index: number): number {
  let line = 1;
  for (let position = 0; position < index; position += 1)
    if (text.charCodeAt(position) === 10) line += 1;
  return line;
}

const NAMED_XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** @throws {never} */
function xmlScalar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/** @throws {never} */
function xmlCharacterReference(
  text: string,
  index: number,
  quote: string,
): { value: string; length: number } | null {
  if (text[index] !== "&") return null;
  let cursor = index + 1;
  let semi = -1;
  while (cursor < text.length) {
    const char = text[cursor] ?? "";
    if (char === ";") {
      semi = cursor;
      break;
    }
    if (char === quote || char === "&" || char === "<") return null;
    cursor += 1;
  }
  if (semi < 0) return null;
  const body = text.slice(index + 1, semi);
  if (body.startsWith("#")) {
    const hex = body[1] === "x" || body[1] === "X";
    const digits = body.slice(hex ? 2 : 1);
    if (
      digits.length === 0 ||
      (hex ? !/^[0-9A-Fa-f]+$/u.test(digits) : !/^\d+$/u.test(digits))
    )
      return null;
    const trimmed = digits.replace(/^0+/u, "") || "0";
    if (trimmed.length > (hex ? 6 : 7)) return null;
    const code = Number.parseInt(trimmed, hex ? 16 : 10);
    if (!xmlScalar(code)) return null;
    return { value: String.fromCodePoint(code), length: semi - index + 1 };
  }
  const named = NAMED_XML_ENTITIES[body];
  if (named === undefined) return null;
  return { value: named, length: semi - index + 1 };
}

/** @throws {never} */
export function xmlAttributeRuleText(
  text: string,
  elementText = false,
): {
  text: string;
  origin: (index: number) => number;
} {
  let result = "";
  let index = 0;
  let mode: "text" | "tag" | "comment" | "cdata" | "value" = "text";
  let quote = "";
  let delta = 0;
  const breaks = [0];
  const deltas = [0];
  const stack: string[] = [];
  let tagKind: "start" | "end" | "other" = "start";
  let tagName = "";
  let readingName = false;
  let selfClosing = false;
  const emit = (value: string, sourceLength = value.length) => {
    result += value;
    const growth = sourceLength - value.length;
    if (growth === 0) return;
    delta += growth;
    breaks.push(result.length);
    deltas.push(delta);
  };
  while (index < text.length) {
    const char = text[index] ?? "";
    if (mode === "text") {
      if (text.startsWith("<!--", index)) {
        mode = "comment";
        emit("<!--");
        index += 4;
        continue;
      }
      if (text.startsWith("<![CDATA[", index)) {
        mode = "cdata";
        emit("<![CDATA[");
        index += 9;
        continue;
      }
      if (char === "<") {
        mode = "tag";
        if (!elementText) {
          emit(char);
          index += 1;
          continue;
        }
        tagName = "";
        selfClosing = false;
        readingName = false;
        if (text.startsWith("</", index)) {
          tagKind = "end";
          readingName = true;
          emit("</");
          index += 2;
          continue;
        }
        if (text.startsWith("<?", index) || text.startsWith("<!", index))
          tagKind = "other";
        else {
          tagKind = "start";
          readingName = true;
        }
        emit(char);
        index += 1;
        continue;
      }
      const open = stack[stack.length - 1];
      if (elementText && open !== undefined && open !== "Exec") {
        const reference = xmlCharacterReference(text, index, "");
        if (reference !== null) {
          emit(reference.value, reference.length);
          index += reference.length;
          continue;
        }
      }
      emit(char);
      index += 1;
      continue;
    }
    if (mode === "comment") {
      if (text.startsWith("-->", index)) {
        mode = "text";
        emit("-->");
        index += 3;
        continue;
      }
      emit(char);
      index += 1;
      continue;
    }
    if (mode === "cdata") {
      if (text.startsWith("]]>", index)) {
        mode = "text";
        emit("]]>");
        index += 3;
        continue;
      }
      emit(char);
      index += 1;
      continue;
    }
    if (mode === "value") {
      if (char === quote) {
        mode = "tag";
        emit(char);
        index += 1;
        continue;
      }
      const reference = xmlCharacterReference(text, index, quote);
      if (reference !== null) {
        emit(reference.value, reference.length);
        index += reference.length;
        continue;
      }
      emit(char === "\r" || char === "\n" ? " " : char);
      index += 1;
      continue;
    }
    if (char === ">") {
      if (elementText) {
        const colon = tagName.lastIndexOf(":");
        const local = colon < 0 ? tagName : tagName.slice(colon + 1);
        if (tagKind === "start" && !selfClosing && local !== "")
          stack.push(local);
        else if (tagKind === "end" && local !== "") {
          const at = stack.lastIndexOf(local);
          if (at >= 0) stack.length = at;
        }
      }
      mode = "text";
      readingName = false;
      emit(char);
      index += 1;
      continue;
    }
    if (readingName && !/[\s/>]/u.test(char)) {
      tagName += char;
      emit(char);
      index += 1;
      continue;
    }
    readingName = false;
    if (elementText && char === "/") selfClosing = true;
    if (char === '"' || char === "'") {
      let previous = index - 1;
      while (previous >= 0 && /[ \t\r\n]/u.test(text[previous] ?? ""))
        previous -= 1;
      if (text[previous] === "=") {
        mode = "value";
        quote = char;
      }
    }
    emit(char);
    index += 1;
  }
  const origin =
    breaks.length === 1
      ? (decodedIndex: number) => decodedIndex
      : (decodedIndex: number) => {
          let lo = 0;
          let hi = breaks.length - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if ((breaks[mid] ?? 0) <= decodedIndex) lo = mid;
            else hi = mid - 1;
          }
          return decodedIndex + (deltas[lo] ?? 0);
        };
  return { text: result, origin };
}

/** @throws {never} */
export function checkText(
  path: string,
  text: string,
  surfaces: ReadonlyArray<ScanSurface>,
  evidenceText = text,
  origin?: (index: number) => number,
  nonMatches?: Set<RegExp>,
): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const rule of RULES) {
    if (rule.surfaces && !rule.surfaces.some((s) => surfaces.includes(s)))
      continue;
    const match = rule.pattern.exec(text);
    if (match === null) {
      nonMatches?.add(rule.pattern);
      continue;
    }
    const at = origin?.(match.index) ?? match.index;
    findings.push({
      severity: rule.severity,
      category: rule.threat,
      summary: rule.summary,
      evidence: `${path}:${lineOf(evidenceText, at)}`.slice(0, 300),
      path,
    });
  }
  return findings;
}

/** @throws {never} */
export function installHookCommands(path: string, text: string): string[] {
  const name = basename(path);
  const hooks =
    name === "package.json"
      ? INSTALL_HOOKS
      : name === "composer.json"
        ? COMPOSER_INSTALL_HOOKS
        : null;
  if (hooks === null) return [];
  try {
    const scripts = (JSON.parse(text) as { scripts?: Record<string, unknown> })
      .scripts;
    return hooks.flatMap((hook) => {
      const value = scripts?.[hook];
      if (typeof value === "string") return [value];
      return Array.isArray(value)
        ? value.filter(
            (command): command is string => typeof command === "string",
          )
        : [];
    });
  } catch {
    return [];
  }
}

export const OBFUSCATION =
  /\beval\s*\(|new\s+Function\s*\(|\batob\s*\(|String\.fromCharCode\s*\((?:\s*\d+\s*,){16}|(?:\\x[0-9a-f]{2}){32}|[A-Za-z0-9+/]{2000,}={0,2}|child_process|\bexecSync\b|\bspawn\s*\(/iu;

const SIGNAL_CONTEXT = 1536;
/** @throws {never} */
export function signalExcerpt(
  path: string,
  text: string,
  nonMatches?: ReadonlySet<RegExp>,
): string | null {
  const matches: [number, number][] = [];
  for (const pattern of [
    OBFUSCATION,
    DOWNLOAD,
    ...RULES.map((rule) => rule.pattern),
  ]) {
    if (nonMatches?.has(pattern)) continue;
    for (const match of text.matchAll(
      new RegExp(pattern.source, `g${pattern.flags.replace("g", "")}`),
    ))
      matches.push([match.index, Math.min(match[0].length, 4096)]);
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => a[0] - b[0]);
  const windows: [number, number][] = [];
  for (const [index, length] of matches) {
    const start = Math.max(0, index - SIGNAL_CONTEXT);
    const end = Math.min(text.length, index + length + SIGNAL_CONTEXT);
    const last = windows[windows.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else windows.push([start, end]);
  }
  return [
    `Signal excerpts of ${path} (${text.length} characters). Deterministic checks read the whole file; this item holds every deterministic-rule match and obfuscation signal with ${SIGNAL_CONTEXT} characters of context.`,
    ...windows.map(
      ([start, end]) =>
        `--- characters ${start}-${end} ---\n${text.slice(start, end)}`,
    ),
  ].join("\n");
}
