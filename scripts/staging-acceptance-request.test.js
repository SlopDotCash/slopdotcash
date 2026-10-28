import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { stagingAcceptanceRequest } from "./staging-acceptance-request.mjs";

async function server(handler, run) {
  const http = createServer(handler);
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${http.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      http.close((error) => (error ? reject(error) : resolve()));
      http.closeAllConnections();
    });
  }
}
const fast = { retryDelayMs: 0 };

test("a reset and transient HTTP failure recover without following redirects or changing a synthetic probe", async () => {
  const bodies = [];
  let calls = 0;
  await server(
    async (request, response) => {
      let body = "";
      for await (const part of request) body += part;
      bodies.push({
        method: request.method,
        origin: request.headers.origin,
        body,
      });
      calls++;
      if (calls === 1) return request.socket.destroy();
      response.writeHead(calls === 2 ? 503 : 302, {
        Location: "/must-not-follow",
      });
      response.end();
    },
    async (origin) => {
      const code = `
        import { stagingAcceptanceRequest } from ${JSON.stringify(new URL("./staging-acceptance-request.mjs", import.meta.url).href)};
        const result = await stagingAcceptanceRequest(${JSON.stringify(`${origin}/oauth-start`)}, {
          method: "POST", headers: { Origin: "https://staging.slop.cash" },
          body: '{"audience":"slop-points-web"}'
        }, { retryDelayMs: 0 });
        if (result.status !== 302) process.exit(2);
      `;
      const child = spawn("node", ["--input-type=module", "-e", code]);
      let diagnostics = "";
      child.stderr.on("data", (chunk) => {
        diagnostics += chunk;
      });
      const exit = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      expect(exit, diagnostics).toBe(0);
      expect(bodies).toHaveLength(3);
      expect(
        bodies.every(
          (body) => JSON.stringify(body) === JSON.stringify(bodies[0]),
        ),
      ).toBe(true);
    },
  );
});

for (const status of [200, 401, 403, 404]) {
  test(`HTTP ${status} reaches the semantic assertion without retry`, async () => {
    let calls = 0;
    await server(
      (_request, response) => {
        calls++;
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end('{"status":"unexpected"}');
      },
      async (origin) => {
        const result = await stagingAcceptanceRequest(origin, {}, fast);
        expect(result.status).toBe(status);
        expect(await result.json()).toEqual({ status: "unexpected" });
        expect(calls).toBe(1);
      },
    );
  });
}

test("persistent service failures exhaust three attempts rather than pass", async () => {
  let calls = 0;
  await server(
    (_request, response) => {
      calls++;
      response.writeHead(503);
      response.end();
    },
    async (origin) => {
      await expect(stagingAcceptanceRequest(origin, {}, fast)).rejects.toThrow(
        "retry bound",
      );
      expect(calls).toBe(3);
    },
  );
});

test("a stalled service is bounded across all attempts", async () => {
  await server(
    () => {},
    async (origin) => {
      const started = Date.now();
      await expect(
        stagingAcceptanceRequest(
          origin,
          {},
          {
            timeoutMs: 150,
            attemptTimeoutMs: 60,
            retryDelayMs: 0,
          },
        ),
      ).rejects.toThrow("retry bound");
      expect(Date.now() - started).toBeLessThan(1500);
    },
  );
});

// Run both the origin and fetch in Node, as in the deployed release probe.
async function nativeBodyProbe(failure) {
  const code = `
    import { createServer } from "node:http";
    import { stagingAcceptanceRequest } from ${JSON.stringify(new URL("./staging-acceptance-request.mjs", import.meta.url).href)};
    const failure = ${JSON.stringify(failure)};
    const payload = failure === "invalid-json" ? "{invalid}" : JSON.stringify({ status: "pending" });
    let calls = 0;
    const server = createServer((_request, response) => {
      calls++;
      response.writeHead(202, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "X-Probe": "retained",
      });
      if (failure === "persistent-disconnect" || (calls === 1 && failure !== "invalid-json")) {
        response.write(payload.slice(0, 5));
        if (failure !== "stall") setTimeout(() => response.destroy(), 20);
      } else response.end(payload);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = "http://127.0.0.1:" + server.address().port;
    const started = Date.now();
    try {
      const result = await stagingAcceptanceRequest(origin, {}, {
        retryDelayMs: 0, timeoutMs: 1000, attemptTimeoutMs: 200,
      });
      const body = await result.json();
      console.log(JSON.stringify({
        status: result.status, body, calls,
        header: result.headers.get("x-probe"),
        url: result.url, origin,
      }));
    } catch (error) {
      console.log(JSON.stringify({
        error: error.message, name: error.name, calls, elapsed: Date.now() - started,
      }));
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  `;
  const child = spawn("node", ["--input-type=module", "-e", code]);
  let diagnostics = "";
  let output = "";
  child.stderr.on("data", (chunk) => {
    diagnostics += chunk;
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const exit = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  expect(exit, diagnostics).toBe(0);
  return JSON.parse(output);
}

for (const failure of ["disconnect", "stall"]) {
  test(`Node recovers when a successful response body has a ${failure}`, async () => {
    const result = await nativeBodyProbe(failure);
    expect(result).toEqual({
      status: 202,
      body: { status: "pending" },
      calls: 2,
      header: "retained",
      url: `${result.origin}/`,
      origin: result.origin,
    });
  });
}

test("Node refuses persistent response-body disconnects after three attempts", async () => {
  const result = await nativeBodyProbe("persistent-disconnect");
  expect(result.error).toContain("retry bound");
  expect(result.calls).toBe(3);
  expect(result.elapsed).toBeLessThan(2500);
});

test("Node does not retry a complete invalid JSON response", async () => {
  const result = await nativeBodyProbe("invalid-json");
  expect(result.name).toBe("SyntaxError");
  expect(result.calls).toBe(1);
});
