// spec/contributor/traceServer.md, "The run, its intents, reservation, objects and events are separate records"; spec/contributor/runEvidence.md, "The same local run resumes its own server record and bounded exact upload"
import { isExactClientIdentifier, isExactClientVersion, isExactModelIdentifier, isExactProviderIdentifier } from "../client/identity/model.schema.ts";

export type TraceContentType = "text/plain" | "application/x-ndjson";

const sha256Pattern = /^[a-f0-9]{64}$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const gitShaPattern = /^[a-f0-9]{40}$/u;
const idempotencyPattern = /^[A-Za-z0-9_-]{16,128}$/u;
const capabilityPattern = /^[A-Za-z0-9_-]{40,128}$/u;
const assertionPattern = /^[A-Za-z0-9._~-]{32,2048}$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const digestPattern = /^sha-256=([a-f0-9]{64})$/u;
const contentTypes: ReadonlyArray<TraceContentType> = ["text/plain", "application/x-ndjson"];

/** @throws {never} */
export function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

/** @throws {never} */
export function validRepository(value: unknown): value is string {
  return typeof value === "string" && repositoryPattern.test(value);
}

/** @throws {never} */
export function validGitSha(value: unknown): value is string {
  return typeof value === "string" && gitShaPattern.test(value);
}

/** @throws {never} */
export function validSha256(value: unknown): value is string {
  return typeof value === "string" && sha256Pattern.test(value);
}

/** @throws {never} */
export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && idempotencyPattern.test(value);
}

/** @throws {never} */
export function validCapability(value: string): boolean {
  return capabilityPattern.test(value);
}

/** @throws {never} */
export function validAssertion(value: string): boolean {
  return assertionPattern.test(value);
}

/** @throws {never} */
export function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !isoPattern.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const canonical = value.includes(".") ? value : `${value.slice(0, -1)}.000Z`;
  return new Date(milliseconds).toISOString() === canonical;
}

/** @throws {never} */
export function validGithubUrl(value: unknown): value is string {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "github.com";
}

/** @throws {never} */
export function traceContentType(value: string): TraceContentType | undefined {
  const base = (value.split(";", 1)[0] ?? "").trim().toLowerCase();
  return contentTypes.find((type) => type === base);
}

/** @throws {never} */
export function declaredDigest(value: string | undefined): string | undefined {
  return digestPattern.exec(value ?? "")?.[1];
}

/** @throws {never} */
export function exactProvider(value: unknown): value is string {
  return isExactProviderIdentifier(value);
}

/** @throws {never} */
export function exactModel(value: unknown): value is string {
  return isExactModelIdentifier(value);
}

/** @throws {never} */
export function exactClient(value: unknown): value is string {
  return isExactClientIdentifier(value);
}

/** @throws {never} */
export function exactClientVersion(value: unknown): value is string {
  return isExactClientVersion(value);
}
