// spec/slopbot/valueEvidence.md, "Line counts come from the exact patch or from hash-verified file text, and must sum to the commit's totals"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { exactJsonIdentity } from "./manifest.ts";

const manifests = Arbitrary.schema(
  Schema.Struct({
    name: Schema.String,
    version: Schema.String,
    private: Schema.Boolean,
    scripts: Schema.Record(Schema.String, Schema.String),
    workspaces: Schema.Array(Schema.String),
    size: Schema.Number,
  }),
);

const layouts = (manifest: unknown) => [exactJsonIdentity(JSON.stringify(manifest)), exactJsonIdentity(JSON.stringify(manifest, null, 2))];

export const identityIgnoresOnlyWhitespace = contract({
  input: manifests,
  run: layouts,
  deterministic: true,
  invariant: (_manifest, [compact, indented]) => compact !== null && compact === indented,
});
