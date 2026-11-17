// spec/security/admission.md, "Acquisition binds one shallow fetch of the exact commit"
import { spawn } from "node:child_process";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface GitHttp {
  readonly origin: string;
  /** @throws {never} */
  close(): Promise<void>;
}

/** @throws {never} */
function body(request: IncomingMessage): Promise<Buffer> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => done(Buffer.concat(chunks)));
    request.on("error", fail);
  });
}

/** @throws {never} */
function backend(root: string, url: URL, request: IncomingMessage, input: Buffer): Promise<Buffer> {
  return new Promise((done, fail) => {
    const child = spawn("git", ["http-backend"], {
      env: {
        PATH: process.env.PATH ?? "",
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: request.method ?? "GET",
        CONTENT_TYPE: request.headers["content-type"] ?? "",
        GIT_PROTOCOL: String(request.headers["git-protocol"] ?? ""),
        REMOTE_ADDR: "127.0.0.1",
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", fail);
    child.on("close", () => done(Buffer.concat(chunks)));
    child.stdin.end(input);
  });
}

/** @throws {never} */
function answer(raw: Buffer, response: ServerResponse) {
  const split = raw.indexOf("\r\n\r\n");
  let status = 200;
  for (const line of raw.subarray(0, split).toString().split("\r\n")) {
    const [name = "", ...value] = line.split(": ");
    if (name.toLowerCase() === "status") status = Number.parseInt(value[0] ?? "200", 10);
    else if (name !== "") response.setHeader(name, value.join(": "));
  }
  response.statusCode = status;
  response.end(raw.subarray(split + 4));
}

/** @throws {never} */
export function serveGit(root: string): Promise<GitHttp> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (url.pathname.startsWith("/moved/")) {
      response.statusCode = 301;
      response.setHeader("location", `${origin}${url.pathname.slice("/moved".length)}${url.search}`);
      response.end();
      return;
    }
    body(request)
      .then((input) => backend(root, url, request, input))
      .then((raw) => answer(raw, response))
      .catch(() => {
        response.statusCode = 500;
        response.end();
      });
  });
  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      done({
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () =>
          new Promise<void>((closed) => {
            server.closeAllConnections();
            server.close(() => closed());
          }),
      });
    });
  });
}
