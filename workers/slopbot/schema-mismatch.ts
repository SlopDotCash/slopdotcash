// Names the first place a model reply breaks its JSON Schema, so a rejected
// verdict can be fixed. The result never carries reply text: only schema
// field names, array positions, a field name from the reply when it is a
// plain identifier, and JSON type names. Operator decision, 17 November 2026.

type Schema = Record<string, unknown>;

const MAX_DETAIL = 200;
const SAFE_NAME = /^[A-Za-z0-9_]{1,40}$/u;

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(value: unknown, type: string): boolean {
  const actual = jsonType(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
}

function at(path: string): string {
  return path === "" ? "the reply" : `field ${path}`;
}

function child(path: string, key: string): string {
  const name = SAFE_NAME.test(key) ? key : "<unnamed>";
  return path === "" ? name : `${path}.${name}`;
}

function walk(value: unknown, schema: Schema, path: string): string | null {
  const type = schema.type;
  const types = Array.isArray(type)
    ? type.filter((t): t is string => typeof t === "string")
    : typeof type === "string"
      ? [type]
      : [];
  if (types.length > 0 && !types.some((t) => typeMatches(value, t)))
    return `${at(path)} is ${jsonType(value)}, expected ${types.join(" or ")}`;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never))
    return `${at(path)} is not one of the allowed values`;
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      return `${at(path)} is shorter than ${schema.minLength} characters`;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
      return `${at(path)} is longer than ${schema.maxLength} characters`;
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern, "u").test(value))
          return `${at(path)} does not match its pattern`;
      } catch {
        // An unusable pattern is the schema's problem, not the reply's.
      }
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum)
      return `${at(path)} is below ${schema.minimum}`;
    if (typeof schema.maximum === "number" && value > schema.maximum)
      return `${at(path)} is above ${schema.maximum}`;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      return `${at(path)} has fewer than ${schema.minItems} items`;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      return `${at(path)} has more than ${schema.maxItems} items`;
    const items = schema.items;
    if (typeof items === "object" && items !== null && !Array.isArray(items))
      for (const [index, item] of value.entries()) {
        const problem = walk(item, items as Schema, `${path}[${index}]`);
        if (problem) return problem;
      }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties =
      typeof schema.properties === "object" && schema.properties !== null
        ? (schema.properties as Record<string, Schema>)
        : {};
    if (Array.isArray(schema.required))
      for (const key of schema.required)
        if (typeof key === "string" && !Object.hasOwn(record, key))
          return `missing required ${at(child(path, key))}`;
    if (schema.additionalProperties === false)
      for (const key of Object.keys(record))
        if (!Object.hasOwn(properties, key))
          return `unexpected ${at(child(path, key))}`;
    for (const [key, sub] of Object.entries(properties))
      if (
        Object.hasOwn(record, key) &&
        typeof sub === "object" &&
        sub !== null
      ) {
        const problem = walk(record[key], sub, child(path, key));
        if (problem) return problem;
      }
  }
  return null;
}

/** The first schema problem in a parsed reply, or null when it matches. */
export function schemaMismatch(value: unknown, schema: Schema): string | null {
  const problem = walk(value, schema, "");
  return problem === null ? null : problem.slice(0, MAX_DETAIL);
}

/** Why a parsed reply was refused, given its schema and an optional explainer
 * for the checks a JSON Schema cannot express. */
export function rejectionDetail(
  value: unknown,
  schema: Schema,
  explain?: (value: unknown) => string | null,
): string {
  const detail =
    schemaMismatch(value, schema) ??
    explain?.(value) ??
    "matches the schema but fails a stricter check";
  return detail.slice(0, MAX_DETAIL);
}

/** Why a reply's text could not be read as JSON. */
export function unreadableDetail(text: string | undefined): string {
  if (text === undefined) return "reply had no text block";
  const trimmed = text.trim();
  if (trimmed === "") return "reply text was empty";
  if (trimmed.startsWith("```")) return "reply was wrapped in a Markdown fence";
  if (!trimmed.startsWith("{") && !trimmed.startsWith("["))
    return "reply had prose before the JSON";
  if (!trimmed.endsWith("}") && !trimmed.endsWith("]"))
    return "reply JSON was cut off or followed by prose";
  return "reply text was not valid JSON";
}
