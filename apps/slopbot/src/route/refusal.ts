// spec/slopbot/review.md, "Every call is free, attributed and accounted"; spec/slopbot/spendAlerts.md, "Each new call appends an immutable cost row with zero customer charge"

export type JsonSchema = Readonly<Record<string, unknown>>;

export type Explain = (value: unknown) => string | undefined;

export const detailLimit = 200;

const safeName = /^[A-Za-z0-9_]{1,40}$/u;

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(value: unknown, type: string): boolean {
  const actual = jsonType(value);
  return type === "number" ? actual === "number" || actual === "integer" : actual === type;
}

function at(path: string): string {
  return path === "" ? "the reply" : `field ${path}`;
}

function child(path: string, key: string): string {
  const name = safeName.test(key) ? key : "<unnamed>";
  return path === "" ? name : `${path}.${name}`;
}

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function patternRefuses(pattern: string, value: string): boolean {
  try {
    return !new RegExp(pattern, "u").test(value);
  } catch {
    return false;
  }
}

function walk(value: unknown, schema: JsonSchema, path: string): string | undefined {
  const type = schema.type;
  const types = Array.isArray(type) ? type.filter((entry): entry is string => typeof entry === "string") : typeof type === "string" ? [type] : [];
  if (types.length > 0 && !types.some((entry) => typeMatches(value, entry))) return `${at(path)} is ${jsonType(value)}, expected ${types.join(" or ")}`;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${at(path)} is not one of the allowed values`;
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return `${at(path)} is shorter than ${schema.minLength} characters`;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return `${at(path)} is longer than ${schema.maxLength} characters`;
    if (typeof schema.pattern === "string" && patternRefuses(schema.pattern, value)) return `${at(path)} does not match its pattern`;
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return `${at(path)} is below ${schema.minimum}`;
    if (typeof schema.maximum === "number" && value > schema.maximum) return `${at(path)} is above ${schema.maximum}`;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return `${at(path)} has fewer than ${schema.minItems} items`;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return `${at(path)} has more than ${schema.maxItems} items`;
    const items = schema.items;
    if (isSchema(items))
      for (const [index, item] of value.entries()) {
        const problem = walk(item, items, `${path}[${index}]`);
        if (problem !== undefined) return problem;
      }
  }
  if (isSchema(value)) {
    const properties = isSchema(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required))
      for (const key of schema.required) if (typeof key === "string" && !Object.hasOwn(value, key)) return `missing required ${at(child(path, key))}`;
    if (schema.additionalProperties === false)
      for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) return `unexpected ${at(child(path, key))}`;
    for (const [key, sub] of Object.entries(properties))
      if (Object.hasOwn(value, key) && isSchema(sub)) {
        const problem = walk(value[key], sub, child(path, key));
        if (problem !== undefined) return problem;
      }
  }
  return undefined;
}

/** @throws {never} */
export function schemaMismatch(value: unknown, schema: JsonSchema): string | undefined {
  return walk(value, schema, "")?.slice(0, detailLimit);
}

/** @throws {never} */
export function rejectionDetail(value: unknown, schema: JsonSchema, explain?: Explain): string {
  const detail = schemaMismatch(value, schema) ?? explain?.(value) ?? "matches the schema but fails a stricter check";
  return detail.slice(0, detailLimit);
}

/** @throws {never} */
export function unreadableDetail(text: string | undefined): string {
  if (text === undefined) return "reply had no text block";
  const trimmed = text.trim();
  if (trimmed === "") return "reply text was empty";
  if (trimmed.startsWith("```")) return "reply was wrapped in a Markdown fence";
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return "reply had prose before the JSON";
  if (!trimmed.endsWith("}") && !trimmed.endsWith("]")) return "reply JSON was cut off or followed by prose";
  return "reply text was not valid JSON";
}
