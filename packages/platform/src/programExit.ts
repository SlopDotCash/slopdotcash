// spec/operations/paymentRun.md, "Each step of a payments run fails alone and the run reports every failure at its end"
import { Cause, Exit, Runtime } from "effect";

const messageLimit = 400;

const printableFields: Readonly<Record<string, ReadonlyArray<string>>> = { ConfigInvalid: ["name", "issue"] };

function tagOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string") return error._tag;
  return error instanceof Error ? error.name : "Defect";
}

function messageOf(tag: string, error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const fields = Object.hasOwn(printableFields, tag) ? printableFields[tag] : undefined;
  if (fields !== undefined) {
    return fields
      .flatMap((field) => {
        const value: unknown = Reflect.get(error, field);
        return typeof value === "string" ? [`${field}=${value}`] : [];
      })
      .join(", ");
  }
  return "message" in error && typeof error.message === "string" ? error.message : "";
}

/** @throws {never} */
export function failureLine(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  const tag = tagOf(error);
  const message = messageOf(tag, error).slice(0, messageLimit);
  return message === "" ? tag : `${tag}: ${message}`;
}

/** @throws {never} */
export function exitWithCode<A, E>(exit: Exit.Exit<A, E>, onExit: (code: number) => void): void {
  if (Exit.isSuccess(exit) && typeof exit.value === "number") onExit(exit.value);
  else Runtime.defaultTeardown(exit, onExit);
}
