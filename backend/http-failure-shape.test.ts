import { describe, expect, test } from "bun:test";
import { apiErrorResponse, failureShape } from "./http";

describe("failureShape", () => {
  test("keeps the class, a known code and frame names, never the message", () => {
    const error = new Error("D1_ERROR: no such column: secret_value_123");
    const shape = failureShape(error);
    expect(shape.startsWith("Error D1_ERROR")).toBe(true);
    expect(shape).not.toContain("secret_value_123");
  });

  test("names platform failures without their text", () => {
    expect(failureShape(new Error("Network connection lost."))).toContain(
      "network-connection-lost",
    );
    expect(
      failureShape(new TypeError("x is undefined for case sc_abc")),
    ).not.toContain("sc_abc");
    expect(failureShape("plain")).toBe("thrown:string");
  });
});

describe("apiErrorResponse", () => {
  const answer = async (caught: unknown) => {
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...parts: unknown[]) => {
      logged.push(parts);
    };
    try {
      const response = apiErrorResponse(caught, { label: "test API failure" });
      return { status: response.status, body: await response.json(), logged };
    } finally {
      console.error = original;
    }
  };

  test("a busy or unreachable database is temporarily unavailable, not an internal error", async () => {
    for (const message of [
      "D1_ERROR: D1 DB is overloaded. Requests queued for too long.",
      "D1_ERROR: Network connection lost.",
      "D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.",
      "D1_ERROR: Internal error in D1 DB storage caused object to be reset.",
      "D1_ERROR: D1 DB reset because its code was updated.",
      "D1_ERROR: Cannot resolve D1 DB due to transient issue on remote node.",
      "D1_RESET_DO: the database is being reset",
      "D1_ERROR: Currently processing a long-running import.",
      // The error D1 throws when SQLite is busy. The same text is what local
      // D1 retries already treat as contention, not a bad statement.
      "D1_ERROR: database is locked: SQLITE_BUSY",
    ]) {
      const { status, body, logged } = await answer(new Error(message));
      expect(status).toBe(503);
      expect(body).toEqual({
        error: "temporarily_unavailable",
        message: "Temporarily unavailable. Try again.",
      });
      // The failure is still logged under its fixed label, never its text.
      expect(logged).toEqual([["test API failure"]]);
    }
  });

  test("any other failure stays an internal error", async () => {
    for (const caught of [
      new Error(
        "D1_ERROR: UNIQUE constraint failed: projects.id: SQLITE_CONSTRAINT",
      ),
      new Error("D1_ERROR: no such column: secret_value_123"),
      new TypeError("x is undefined"),
      // The same words without a D1 code are not this database failure.
      new Error("database is locked: SQLITE_BUSY"),
      "plain",
    ]) {
      const { status, body, logged } = await answer(caught);
      expect(status).toBe(500);
      expect(body).toEqual({
        error: "internal_error",
        message: "Internal error",
      });
      expect(JSON.stringify(logged)).not.toContain("secret_value_123");
    }
  });

  test("a refusal with its own status is unchanged", async () => {
    const refusal = Object.assign(new Error("Report not found"), {
      status: 404,
      code: "not_found",
    });
    expect(await answer(refusal)).toEqual({
      status: 404,
      body: { error: "not_found", message: "Report not found" },
      logged: [],
    });
    const unavailable = Object.assign(new Error("GitHub is unavailable"), {
      status: 503,
      code: "authority_unavailable",
    });
    expect((await answer(unavailable)).body.error).toBe(
      "authority_unavailable",
    );
  });
});
