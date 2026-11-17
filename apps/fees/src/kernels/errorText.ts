//@ backend dafny
// spec/fees/runtime.md, "The preflight refuses an incomplete live configuration"; spec/fees/conversion.md, "Each evaluation records one outcome from the pinned order of checks"

//@ pure
export function isSpace(c: string): boolean {
  return (
    c === " " ||
    c === "\t" ||
    c === "\n" ||
    c === "\v" ||
    c === "\f" ||
    c === "\r" ||
    c === "\u00a0" ||
    c === "\u1680" ||
    (c >= "\u2000" && c <= "\u200a") ||
    (c > "\u2027" && c < "\u202a") ||
    c === "\u202f" ||
    c === "\u205f" ||
    c === "\u3000" ||
    c === "\ufeff"
  );
}

//@ pure
export function isLetter(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}

//@ pure
export function isSchemeChar(c: string): boolean {
  return isLetter(c) || (c >= "0" && c <= "9") || c === "+" || c === "." || c === "-";
}

export function errorText(text: string): string {
  //@ ensures 0 < \result.length && \result.length <= 400
  let end = 0;
  while (end < text.length && !(end + 13 <= text.length && text.slice(end, end + 13) === "Request body:")) {
    //@ invariant 0 <= end && end <= text.length
    //@ decreases text.length - end
    end += 1;
  }
  let out = "";
  let pending = false;
  let i = 0;
  while (i < end && out.length < 400) {
    //@ invariant 0 <= i && i <= end && end <= text.length
    //@ decreases end - i
    const c = text.slice(i, i + 1);
    if (isSpace(c)) {
      pending = true;
      i += 1;
    } else {
      let token = c;
      let next = i + 1;
      if (isLetter(c)) {
        let j = i + 1;
        while (j < end && isSchemeChar(text.slice(j, j + 1))) {
          //@ invariant i < j && j <= end
          //@ decreases end - j
          j += 1;
        }
        if (j + 3 < end && text.slice(j, j + 3) === "://" && !isSpace(text.slice(j + 3, j + 4))) {
          let k = j + 4;
          while (k < end && !isSpace(text.slice(k, k + 1))) {
            //@ invariant j + 4 <= k && k <= end
            //@ decreases end - k
            k += 1;
          }
          token = "<url>";
          next = k;
        } else {
          token = text.slice(i, j);
          next = j;
        }
      }
      out = pending && out.length > 0 ? out + " " + token : out + token;
      pending = false;
      i = next;
    }
  }
  const capped = out.length > 400 ? out.slice(0, 400) : out;
  return capped.length > 0 ? capped : "unknown error";
}
