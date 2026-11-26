// spec/contributor/discoverySnapshot.md, "A changed inventory retries the whole snapshot once and a failed read never publishes"
import { copyFileSync, chmodSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { type GitHubFake, githubFake } from "@repo/platform/testing/github";

export interface ServedGitHub {
  readonly fake: GitHubFake;
  readonly origin: string;
  environment(bin: string, login: string): Readonly<Record<string, string>>;
  close(): Promise<void>;
}

const shim = join(import.meta.dirname, "gh");

async function bytesOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks);
}

/** @throws {Error} */
export async function serveGitHub(): Promise<ServedGitHub> {
  const server = createServer();
  const port = await new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve(typeof address === "object" && address !== null ? address.port : 0);
  }));
  const origin = `http://127.0.0.1:${port}`;
  const made = githubFake({ authority: origin });
  server.on("request", (request, response) => {
    const answered = async () => {
      const body = await bytesOf(request);
      const headers = Object.entries(request.headers).flatMap(([name, value]): Array<[string, string]> => (typeof value === "string" ? [[name, value]] : []));
      const reply = await made.fetch(`${made.authority}${request.url ?? "/"}`, { method: request.method ?? "GET", headers, ...(body.length === 0 ? {} : { body: new Uint8Array(body) }) });
      response.statusCode = reply.status;
      for (const name of ["content-type", "link"]) {
        const value = reply.headers.get(name);
        if (value !== null) response.setHeader(name, value);
      }
      response.end(Buffer.from(await reply.arrayBuffer()));
    };
    answered().catch((error: unknown) => {
      response.statusCode = 599;
      response.end(String(error));
    });
  });
  return {
    fake: made,
    origin,
    environment: (bin, login) => {
      copyFileSync(shim, join(bin, "gh"));
      chmodSync(join(bin, "gh"), 0o755);
      return { PATH: `${bin}:${process.env.PATH ?? ""}`, GH_TOKEN: made.tokens.user(login), SLOP_TEST_GH_API: origin };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
