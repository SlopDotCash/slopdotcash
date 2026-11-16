/**
 * Move an Apalache fold's LET-bound operator outside its argument position.
 * This is the Cmd.TLA normalization required by TLC, with lexical boundaries:
 * quoted strings and nested comments are data, even when they contain LET/IN.
 */
export function normalizeTlaFolds(source) {
  for (;;) {
    const tokens = codeTokens(source);
    let changed = false;
    for (let index = 0; index < tokens.length - 3; index += 1) {
      const fold = tokens[index];
      if (
        !/^ApaFold\w*$/u.test(fold.text) ||
        tokens[index + 1].text !== "(" ||
        tokens[index + 2].text !== "LET"
      )
        continue;

      let lets = 1;
      let parentheses = 1;
      for (let end = index + 3; end < tokens.length; end += 1) {
        const token = tokens[end];
        if (token.text === "(") parentheses += 1;
        if (token.text === ")" && --parentheses === 0) break;
        if (token.text === "LET") lets += 1;
        if (token.text !== "IN" || --lets !== 0) continue;
        const lambda = tokens[end + 1];
        if (lambda && /^__QUINT_LAMBDA\w*$/u.test(lambda.text)) {
          const letStart = tokens[index + 2].start;
          source =
            source.slice(0, fold.start) +
            source.slice(letStart, lambda.start) +
            " " +
            source.slice(fold.start, letStart) +
            source.slice(lambda.start);
          changed = true;
        }
        break;
      }
      if (changed) break;
    }
    if (!changed) return source;
  }
}

/** Tokens outside strings and comments, retaining their source offsets. */
function codeTokens(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/u.test(source[index])) {
      index += 1;
    } else if (source.startsWith("\\*", index)) {
      const newline = source.indexOf("\n", index + 2);
      index = newline < 0 ? source.length : newline + 1;
    } else if (source.startsWith("(*", index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("(*", index)) {
          depth += 1;
          index += 2;
        } else if (source.startsWith("*)", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
    } else {
      const start = index;
      if (source[index] === '"') {
        index += 1;
        while (index < source.length) {
          if (source[index] === "\\") index += 2;
          else if (source[index++] === '"') break;
        }
      } else if (/[A-Za-z_]/u.test(source[index])) {
        index += 1;
        while (index < source.length && /\w/u.test(source[index])) index += 1;
      } else {
        index += 1;
      }
      tokens.push({ text: source.slice(start, index), start });
    }
  }
  return tokens;
}
