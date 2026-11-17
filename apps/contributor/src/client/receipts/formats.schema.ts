// spec/contributor/evidence.md, "A signed receipt binds the exact disclosure and either no trace or the stored trace"; spec/contributor/evidence.md, "A receipt verifies only under its exact published schema version, signing payload and Ed25519 device key"
import { Schema } from "effect";

const LEAP_YEAR = "(?:\\d{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)";
const CALENDAR_DAY = `(?:\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|02-(?:0[1-9]|1\\d|2[0-8]))|${LEAP_YEAR}-02-29)`;

const matching = (pattern: RegExp) => Schema.String.check(Schema.isPattern(pattern));

export const ExactUtc = matching(new RegExp(`^${CALENDAR_DAY}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d\\.\\d{3}Z$`));

export const Sha256 = matching(/^[0-9a-f]{64}$/);

export const Sha1 = matching(/^[0-9a-f]{40}$/);

export const CanonicalUint = matching(/^(?:0|[1-9]\d*)$/);

export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const base64url = (minimumLength: number) =>
  Schema.String.check(Schema.isBetweenLength(minimumLength, 4096), Schema.isPattern(/^[A-Za-z0-9_-]+$/));

export const concreteIdentifier = (maximumLength: number) =>
  Schema.String.check(
    Schema.isBetweenLength(1, maximumLength),
    Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]*$/),
    Schema.makeFilter((value: string) => value.toLowerCase() !== "n/a", { expected: "a concrete identifier, not n/a" }),
  );
