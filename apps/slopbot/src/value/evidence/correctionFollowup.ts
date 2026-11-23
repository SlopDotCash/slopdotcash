// spec/points/corrections.md, "October replacement PRs credit the verified original contributors by their accepted lines"
import ts from "typescript";
import { posix } from "node:path";

function syntaxOf(node: ts.Node, source: ts.SourceFile): unknown {
  const children: unknown[] = [];
  node.forEachChild((child) => { children.push(syntaxOf(child, source)); });
  return children.length === 0 ? [node.kind, node.getText(source)] : [node.kind, children];
}

function sourceOf(text: string, path: string) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, false);
}

function commentsOf(text: string) {
  return text.match(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\//gu) ?? [];
}

function equivalentSyntax(path: string, before: string, after: string) {
  if (JSON.stringify(commentsOf(before)) !== JSON.stringify(commentsOf(after))) return false;
  const original = sourceOf(before, path);
  const changed = sourceOf(after, path);
  if (JSON.stringify(syntaxOf(original, original)) !== JSON.stringify(syntaxOf(changed, changed))) return false;
  return sameEmit(path, before, after);
}

function sameEmit(path: string, before: string, after: string) {
  const options = { fileName: path, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true }, reportDiagnostics: true };
  const left = ts.transpileModule(before, options);
  const right = ts.transpileModule(after, options);
  return !left.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error) &&
    !right.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error) &&
    left.outputText === right.outputText;
}

function namedImport(line: string | undefined) {
  return /^import (?:type )?\{ [\w$, ]+ \} from ["']([^"']+)["'];$/u.exec(line ?? "")?.[1];
}

function originalImportPlacement(before: string, after: string, originalBase: string, originalHead: string) {
  const prior = before.split("\n");
  const next = after.split("\n");
  if (prior.length !== next.length) return false;
  const first = prior.findIndex((line, index) => line !== next[index]);
  if (first < 0 || prior[first] !== next[first + 1] || prior[first + 1] !== next[first] ||
    prior.some((line, index) => index !== first && index !== first + 1 && next[index] !== line)) return false;
  const [addedImport, movedImport] = [prior[first + 1] ?? "", prior[first] ?? ""];
  const [movedFrom, addedFrom] = [namedImport(movedImport), namedImport(addedImport)];
  if (movedFrom === undefined || addedFrom === undefined || !(addedFrom < movedFrom)) return false;
  const base = originalBase.split("\n");
  const head = originalHead.split("\n");
  return !base.includes(addedImport) && head.filter((line) => line === addedImport).length === 1 && base.includes(movedImport)
    ? { addedImport, movedImport } : false;
}

function supportsSource(path: string, before: string, after: string, originalBase: string, originalHead: string) {
  return /\.[cm]?tsx?$/u.test(path) && before !== after && [before, after, originalBase, originalHead].every((source) => source.length <= 256 * 1024);
}

export function verifiedCorrectionFollowup(path: string, before: string, after: string, originalBase: string, originalHead: string) {
  if (!supportsSource(path, before, after, originalBase, originalHead)) return undefined;
  if (equivalentSyntax(path, before, after)) return "equivalent-typescript-syntax";
  const placement = originalImportPlacement(before, after, originalBase, originalHead);
  if (placement && [placement.addedImport, placement.movedImport].some((line) => line.startsWith("import type ")) && sameEmit(path, before, after)) {
    return "sort-native-original-import";
  }
  return undefined;
}

export function solePlacementOfOriginalImport(path: string, before: string, after: string, originalBase: string, originalHead: string) {
  if (!supportsSource(path, before, after, originalBase, originalHead) || before !== originalHead) return false;
  const placement = originalImportPlacement(before, after, originalBase, originalHead);
  if (!placement) return false;
  const imports = (text: string) => {
    const source = sourceOf(text, path);
    return source.statements.filter(ts.isImportDeclaration).map((statement) => statement.getText(source));
  };
  const original = imports(before), ordered = imports(after);
  const once = (lines: ReadonlyArray<string>, line: string) => lines.filter((entry) => entry === line).length === 1;
  return once(imports(originalBase), placement.movedImport) &&
    [placement.addedImport, placement.movedImport].every((line) => once(original, line) && once(ordered, line));
}

export function organizerSelects(config: string, path: string, source: string) {
  try {
    if (config.length > 256 * 1024) return false;
    const policy = JSON.parse(config) as {
      $schema?: unknown;
      root?: unknown;
      extends?: unknown;
      plugins?: unknown;
      assist?: { enabled?: unknown; actions?: { source?: { organizeImports?: unknown } } };
      overrides?: ReadonlyArray<Record<string, unknown>>;
      files?: { includes?: ReadonlyArray<string>; maxSize?: number };
    };
    if (policy.$schema !== "https://biomejs.dev/schemas/2.5.15/schema.json" || policy.root !== true ||
      policy.extends !== undefined || policy.plugins !== undefined || policy.assist?.enabled === false ||
      Object.keys(policy.assist ?? {}).some((key) => key !== "enabled" && key !== "actions") ||
      policy.assist?.actions?.source?.organizeImports !== "on" ||
      policy.overrides?.some((override) => Object.keys(override).some((key) => key !== "includes" && key !== "formatter" && key !== "linter")) ||
      (policy.files?.maxSize !== undefined && (!(policy.files.maxSize > 0) || new TextEncoder().encode(source).length > policy.files.maxSize))) return false;
    const includes = policy.files?.includes;
    if (includes === undefined) return true;
    if (includes[0] !== "**" || includes.slice(1).some((pattern) => !/^![^!]/u.test(pattern))) return false;
    const ancestors = path.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"));
    return !includes.slice(1).some((pattern) => ancestors.some((entry) => posix.matchesGlob(entry, pattern.slice(1))));
  } catch {
    return false;
  }
}
