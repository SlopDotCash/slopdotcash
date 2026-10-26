/** Producer provenance is separate from journal publication authority. A
 * subscription declaration is not an API receipt or provider billing proof.
 */
import { type CallRecord, TRIAGE_ROUTE } from "./models";

/** Each subscription channel names exactly one provider. */
const SUBSCRIPTION_CHANNELS = {
  "chatgpt-subscription": "openai",
  "claude-subscription": "anthropic",
} as const;
type SubscriptionChannel = keyof typeof SUBSCRIPTION_CHANNELS;

export interface SubscriptionProvenance {
  channel: SubscriptionChannel;
  provider: (typeof SUBSCRIPTION_CHANNELS)[SubscriptionChannel];
  model: string;
  client: string;
  exactVariant: null;
  identityEvidence: "self-reported";
  apiReceipt: null;
}

export type SubscriptionResult<T> = Omit<
  T,
  "calls" | "servedBy" | "budgetResetAt"
> & { provenance: SubscriptionProvenance };

export type ValueProducer =
  | { provider: string; requested: string; reported: string }
  | SubscriptionProvenance;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identityLabel = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,95}$/u.test(value);

export function isSubscriptionProvenance(
  value: unknown,
): value is SubscriptionProvenance {
  return (
    object(value) &&
    Object.keys(value).sort().join() ===
      "apiReceipt,channel,client,exactVariant,identityEvidence,model,provider" &&
    typeof value.channel === "string" &&
    Object.hasOwn(SUBSCRIPTION_CHANNELS, value.channel) &&
    value.provider ===
      SUBSCRIPTION_CHANNELS[value.channel as SubscriptionChannel] &&
    identityLabel(value.model) &&
    identityLabel(value.client) &&
    value.exactVariant === null &&
    value.identityEvidence === "self-reported" &&
    value.apiReceipt === null
  );
}

export function isValueProducer(value: unknown): value is ValueProducer {
  if (isSubscriptionProvenance(value)) return true;
  return (
    object(value) &&
    Object.keys(value).sort().join() === "provider,reported,requested" &&
    typeof value.requested === "string" &&
    value.requested === value.reported &&
    TRIAGE_ROUTE.some(
      (step) =>
        step.provider === value.provider && step.model === value.requested,
    )
  );
}

export function valueProducerIdentity(
  call: CallRecord | null,
  assessedAt: string,
) {
  if (
    call?.outcome !== "ok" ||
    call.servedModel !== call.requestedModel ||
    !TRIAGE_ROUTE.some(
      (step) =>
        step.provider === call.provider && step.model === call.requestedModel,
    ) ||
    !Number.isFinite(Date.parse(assessedAt))
  )
    throw new Error("Value result lacks a validated model identity");
  return {
    provider: call.provider,
    requested: call.requestedModel,
    reported: call.servedModel,
  };
}

/** Internal callers supply provenance; public requests cannot invoke this as
 * an authorization path. The publisher still verifies installation and source.
 */
export function valueResultProducerIdentity(result: {
  assessedAt: string;
  provenance?: SubscriptionProvenance;
  servedBy?: CallRecord | null;
  calls?: CallRecord[];
  budgetResetAt?: string;
}): ValueProducer {
  if ("provenance" in result) {
    if (
      !isSubscriptionProvenance(result.provenance) ||
      !Number.isFinite(Date.parse(result.assessedAt)) ||
      "servedBy" in result ||
      "calls" in result ||
      "budgetResetAt" in result
    )
      throw new Error(
        "Subscription value result must not claim API call evidence",
      );
    return { ...result.provenance };
  }
  return valueProducerIdentity(result.servedBy ?? null, result.assessedAt);
}
