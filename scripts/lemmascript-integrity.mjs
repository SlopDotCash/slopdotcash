import { createRequire } from "node:module";

const { ts } = createRequire(import.meta.resolve("lemmascript/package.json"))(
  "ts-morph",
);
function declarationText(text) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const start = index;
    if (text.startsWith("//", index)) {
      while (
        index < text.length &&
        text[index] !==
          `
`
      )
        index++;
    } else if (text.startsWith("/*", index)) {
      index += 2;
      let depth = 1;
      while (index < text.length && depth > 0) {
        if (text.startsWith("/*", index)) {
          depth++;
          index += 2;
        } else if (text.startsWith("*/", index)) {
          depth--;
          index += 2;
        } else index++;
      }
    } else if (text[index] === '"' || text[index] === "'") {
      const quote = text[index++];
      while (index < text.length) {
        if (text[index] === "\\") index += 2;
        else if (text[index++] === quote) break;
      }
    } else {
      result += text[index++];
      continue;
    }
    result += text.slice(start, index).replace(/[^\n]/g, " ");
  }
  return result;
}
export function requireProofObligations(source, generated) {
  const declarations = declarationText(generated);
  const file = ts.createSourceFile(
    "target.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const targets = [];
  const selected = (node) => {
    const leading = source.slice(node.getFullStart(), node.getStart(file));
    const body = ts.isVariableStatement(node)
      ? node.declarationList.declarations[0]?.initializer?.body
      : node.body;
    const bodyHeader =
      body && ts.isBlock(body)
        ? source.slice(
            body.getStart(file) + 1,
            body.statements[0]?.getStart(file) ?? body.end - 1,
          )
        : "";
    return /\/\/@\s+verify\b/.test(`${leading}\n${bodyHeader}`);
  };
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && selected(node)) {
      if (!node.name || !node.body)
        throw new Error("Verified function must have a name and body");
      targets.push(node.name.text);
    } else if (ts.isVariableStatement(node) && selected(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          !declaration.initializer ||
          !(
            ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer)
          )
        )
          throw new Error("Verified variable must name a function body");
        targets.push(declaration.name.text);
      }
    }
  }
  const directives = [...source.matchAll(/\/\/@\s+verify\b/g)].length;
  if (!targets.length || targets.length !== directives)
    throw new Error(
      "Unaccounted verification directive; this gate supports named top-level functions",
    );
  for (const target of targets) {
    const name = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declaration = declarations.match(
      new RegExp(
        `^\\s*(?:ghost\\s+)?(?:lemma\\s+${name}_ensures|method\\s+${name})\\(`,
        "m",
      ),
    );
    const suffix = declaration
      ? declarations.slice((declaration.index ?? 0) + declaration[0].length)
      : "";
    const boundary = suffix.search(
      /\{|\b(?:lemma|method|function|predicate|class|trait|datatype|codatatype|type|newtype|const|module|iterator)\b/,
    );
    const header = boundary < 0 ? suffix : suffix.slice(0, boundary);
    if (!declaration || !/\bensures\s/.test(header))
      throw new Error(`No generated postcondition obligation for ${target}`);
  }
  return targets;
}
function tokenizeProof(text) {
  const tokens = [];
  let at = 0;
  while (at < text.length) {
    if (/\s/.test(text[at])) {
      at++;
      continue;
    }
    if (text.startsWith("//", at)) {
      while (
        at < text.length &&
        text[at] !==
          `
`
      )
        at++;
      continue;
    }
    if (text.startsWith("/*", at)) {
      let depth = 1;
      at += 2;
      while (at < text.length && depth) {
        if (text.startsWith("/*", at)) {
          depth++;
          at += 2;
        } else if (text.startsWith("*/", at)) {
          depth--;
          at += 2;
        } else at++;
      }
      if (depth) throw Error("Unclosed proof comment");
      continue;
    }
    const start = at;
    if (text[at] === '"' || text[at] === "'") {
      const quote = text[at++];
      let closed = false;
      while (at < text.length) {
        if (text[at] === "\\") {
          at += 2;
          continue;
        }
        if (text[at++] === quote) {
          closed = true;
          break;
        }
      }
      if (!closed) throw Error("Unclosed proof literal");
      tokens.push({ text: text.slice(start, at), offset: start });
      continue;
    }
    if (/[A-Za-z_0-9$]/.test(text[at])) {
      while (at < text.length && /[A-Za-z_0-9$]/.test(text[at])) at++;
    } else at++;
    tokens.push({ text: text.slice(start, at), offset: start });
  }
  return tokens;
}
const declarationKinds = [
  "lemma",
  "method",
  "function",
  "predicate",
  "datatype",
  "codatatype",
  "type",
  "newtype",
  "class",
  "trait",
  "module",
  "iterator",
  "const",
];
function proofDeclarations(tokens) {
  const starts = [];
  let braces = 0,
    parens = 0,
    brackets = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].text;
    if (!braces && !parens && !brackets && declarationKinds.includes(t))
      starts.push(i);
    if (t === "{") braces++;
    if (t === "}") braces--;
    if (t === "(") parens++;
    if (t === ")") parens--;
    if (t === "[") brackets++;
    if (t === "]") brackets--;
    if (braces < 0 || parens < 0 || brackets < 0)
      throw Error("Unbalanced proof syntax");
  }
  if (braces || parens || brackets) throw Error("Unbalanced proof syntax");
  if (starts[0] !== 0)
    throw Error("Unsupported content before proof declarations");
  return starts.map((start, k) => {
    const end = starts[k + 1] ?? tokens.length;
    const all = tokens.slice(start, end).map((t) => t.text);
    let depth = 0,
      open = -1,
      lastOpen = -1,
      lastClose = -1;
    for (let i = 0; i < all.length; i++) {
      if (all[i] === "{") {
        if (!depth) open = i;
        depth++;
      } else if (all[i] === "}") {
        depth--;
        if (!depth) {
          lastOpen = open;
          lastClose = i;
        }
      }
    }
    const body =
      lastOpen >= 0 && lastClose === all.length - 1
        ? all.slice(lastOpen + 1, lastClose)
        : null;
    return {
      kind: all[0],
      name: all[1],
      header: body ? all.slice(0, lastOpen) : all,
      body,
    };
  });
}
function equalProofTokens(a, b) {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}
function proofBlockEnd(tokens, start) {
  if (tokens[start] !== "assert") return null;
  let parens = 0,
    brackets = 0;
  for (let i = start + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "(") parens++;
    if (t === ")") parens--;
    if (t === "[") brackets++;
    if (t === "]") brackets--;
    if (!parens && !brackets && t === "by" && tokens[i + 1] === "{") {
      let depth = 1;
      for (let j = i + 2; j < tokens.length; j++) {
        if (tokens[j] === "{") depth++;
        if (tokens[j] === "}" && !--depth)
          return tokens[j + 1] === ";" ? j + 2 : j + 1;
      }
      throw Error("Unclosed proof block");
    }
    if (!parens && !brackets && (t === ";" || t === "{")) return null;
  }
  return null;
}
function sameExecutableBody(generated, proof) {
  let g = 0,
    p = 0;
  while (p < proof.length) {
    const end = proofBlockEnd(proof, p);
    if (end !== null) {
      const block = proof.slice(p, end);
      if (!equalProofTokens(generated.slice(g, g + block.length), block)) {
        p = end;
        continue;
      }
    }
    if (proof[p] !== generated[g]) return false;
    p++;
    g++;
  }
  return g === generated.length;
}
export function requireProofIntegrity(generated, proof) {
  const originalTokens = tokenizeProof(generated),
    proofTokens = tokenizeProof(proof);
  for (const [label, tokens] of [
    ["generated", originalTokens],
    ["proof", proofTokens],
  ]) {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i].text;
      if (["include", "assume", "expect", "sorry"].includes(token))
        throw Error(`${label}: unsupported trust construct ${token}`);
      if (token === "{" && tokens[i + 1]?.text === ":")
        throw Error(`${label}: unsupported Dafny attribute`);
    }
  }
  const original = proofDeclarations(originalTokens),
    edited = proofDeclarations(proofTokens);
  const kindsWithoutBody = new Set([
    "datatype",
    "codatatype",
    "type",
    "newtype",
    "const",
  ]);
  const names = new Set();
  for (const decl of edited) {
    if (names.has(decl.name)) throw Error(`Duplicate declaration ${decl.name}`);
    names.add(decl.name);
    if (!decl.body && !kindsWithoutBody.has(decl.kind))
      throw Error(`Bodyless declaration ${decl.name}`);
  }
  for (const expected of original) {
    const actual = edited.find(
      (d) => d.kind === expected.kind && d.name === expected.name,
    );
    if (!actual || !equalProofTokens(expected.header, actual.header))
      throw Error(`Changed declaration header ${expected.name}`);
    if (expected.kind === "lemma") continue;
    if (expected.body === null || actual.body === null) {
      if (expected.body !== actual.body)
        throw Error(`Changed declaration body ${expected.name}`);
      continue;
    }
    if (
      expected.kind === "method"
        ? !sameExecutableBody(expected.body, actual.body)
        : !equalProofTokens(expected.body, actual.body)
    )
      throw Error(`Changed executable body ${expected.name}`);
  }
  for (const added of edited.filter(
    (d) => !original.some((o) => o.kind === d.kind && o.name === d.name),
  )) {
    if (!["lemma", "function", "predicate"].includes(added.kind) || !added.body)
      throw Error(`Unsupported added declaration ${added.name}`);
  }
}
