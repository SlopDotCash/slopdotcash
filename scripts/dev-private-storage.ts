import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import type { R2Bucket } from "../backend/trace/cloudflare-persistence";
import { childEnvironment } from "./child-environment.mjs";

/** Persistent, capability-protected local R2; never a remote bucket or mock. */
export async function devPrivateStorage(directory: string): Promise<{
  bucket: R2Bucket;
  close(): Promise<void>;
}> {
  const token = randomBytes(32).toString("hex");
  const child = spawn(
    "node",
    [fileURLToPath(new URL("./dev-r2-server.mjs", import.meta.url))],
    {
      env: childEnvironment(),
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const origin = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Local private storage did not start"));
    }, 20_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Local private storage stopped"));
    });
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (!output.includes("\n") && output.length < 1024) return;
      clearTimeout(timer);
      const value = output.trim();
      if (!/^http:\/\/127\.0\.0\.1:\d{1,5}$/u.test(value)) {
        child.kill("SIGTERM");
        reject(new Error("Local private storage returned an invalid address"));
      } else resolve(value);
    });
    child.stdin.write(`${JSON.stringify({ directory, token })}\n`);
  });
  const call = (key: string, init: RequestInit) =>
    fetch(`${origin}/${encodeURIComponent(key)}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  function metadata(response: Response) {
    if (!response.ok) throw new Error("Local private storage is unavailable");
    return {
      size: Number(response.headers.get("x-r2-size")),
      customMetadata: JSON.parse(
        Buffer.from(
          response.headers.get("x-r2-metadata") ?? "",
          "base64",
        ).toString("utf8"),
      ) as Record<string, string>,
    };
  }
  return {
    bucket: {
      async put(key, value, options) {
        const response = await call(key, {
          method: "PUT",
          headers: { "x-r2-options": JSON.stringify(options) },
          body: value as BodyInit,
        });
        if (!response.ok)
          throw new Error("Local private storage is unavailable");
        return response.json();
      },
      async head(key) {
        const response = await call(key, { method: "HEAD" });
        return response.status === 404 ? null : metadata(response);
      },
      async get(key) {
        const response = await call(key, { method: "GET" });
        if (response.status === 404) return null;
        if (!response.body)
          throw new Error("Local private storage returned no body");
        return { ...metadata(response), body: response.body };
      },
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.stdin.end();
      await exited;
    },
  };
}
