// spec/slopbot/valueEvidence.md, "A blob, tree or binary claim counts only when its git object hash matches the bytes read"
import { Arbitrary, Schema } from "effect";
import { sha256Of } from "@repo/platform/git/bytes";
import { contract } from "vibestack/testing";
import { jsonDigest } from "./jsonDigest.ts";

const evidence = Arbitrary.schema(
  Schema.Array(
    Schema.Struct({
      path: Schema.String,
      text: Schema.String,
      lines: Schema.Number,
      verified: Schema.Boolean,
      parents: Schema.Array(Schema.String),
      blob: Schema.NullOr(Schema.Struct({ sha: Schema.String, size: Schema.Number })),
    }),
  ),
);

export const digestIsTheNativeSerializationDigest = contract({
  input: evidence,
  run: jsonDigest,
  deterministic: true,
  invariant: (input, output) => output === sha256Of(JSON.stringify(input)),
});
