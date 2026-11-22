// spec/slopbot/review.md, "Every call is free, attributed and accounted"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { detailLimit, rejectionDetail, unreadableDetail } from "./refusal.ts";

const marker = "~reply~";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["category", "summary", "digests"],
  properties: {
    category: { type: "string", enum: ["none", "spam"] },
    summary: { type: "string", minLength: 1 },
    digests: { type: "array", items: { type: "string", pattern: "^[a-f0-9]{64}$" } },
  },
};

const replies = Arbitrary.schema(
  Schema.Struct({ extra: Schema.Array(Schema.String), category: Schema.String, summary: Schema.String, digests: Schema.Array(Schema.String), whole: Schema.Boolean }),
).pipe(
  Arbitrary.map(({ extra, category, summary, digests, whole }) =>
    whole
      ? `${marker}${summary}`
      : {
          category: `${marker}${category}`,
          summary: `${marker}${summary}`,
          digests: digests.map((digest) => `${marker}${digest}`),
          ...Object.fromEntries(extra.map((key) => [`${marker}${key}`, `${marker}${key}`])),
        },
  ),
);

const texts = Arbitrary.schema(Schema.String).pipe(Arbitrary.map((text) => `${text}${marker}`));

const bounded = (detail: string) => detail.length > 0 && detail.length <= detailLimit && !detail.includes(marker);

export const aRefusedReplyIsDescribedWithoutItsText = contract({
  input: replies,
  run: (reply: unknown) => rejectionDetail(reply, schema),
  invariant: (_, detail) => bounded(detail),
});

export const anUnreadableReplyIsDescribedWithoutItsText = contract({
  input: texts,
  run: (text: string) => unreadableDetail(text),
  invariant: (_, detail) => bounded(detail),
});
