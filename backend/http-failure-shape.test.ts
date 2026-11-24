import { describe, expect, test } from "bun:test";
import { failureShape } from "./http";

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
