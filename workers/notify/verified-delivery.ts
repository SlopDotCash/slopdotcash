/**
 * Actual destination, notice and consent fields after the caller's reads.
 * Missing records and unpinned versions stay distinct. The policy does not
 * establish identity, verify a destination, or claim provider acceptance.
 */
export type DeliveryVersion =
  | { kind: "unpinned" }
  | { kind: "pinned"; value: string };

export type ActivityDeliveryDestination =
  | { kind: "unavailable"; pilotConfigured: boolean }
  | { kind: "pilot"; destinationVersion: string }
  | { kind: "registered"; destinationVersion: string };

export type ActivityDeliveryNotice = {
  essential: boolean;
  version: DeliveryVersion;
};

export type ActivityDeliveryPreference =
  | { kind: "missing" }
  | {
      kind: "stored";
      activity: "enabled" | "disabled";
      security: "enabled" | "disabled" | "unset";
      version: DeliveryVersion;
    };

//@ verify
//@ pure
//@ ensures value == null ==> \result.kind == "unpinned"
//@ ensures value != null ==> \result.kind == "pinned" && \result.value == value
export function deliveryVersion(value: string | null): DeliveryVersion {
  return value === null ? { kind: "unpinned" } : { kind: "pinned", value };
}

//@ verify
//@ pure
//@ ensures \result <==> version.kind == "pinned" && version.value == expected
export function deliveryVersionMatches(
  version: DeliveryVersion,
  expected: string,
): boolean {
  return version.kind === "pinned" && version.value === expected;
}

//@ verify
//@ pure
//@ ensures \result == "retry" <==> destination.kind == "unavailable" && notice.essential && destination.pilotConfigured
//@ ensures \result == "send" ==> destination.kind != "unavailable"
//@ ensures \result == "send" && !notice.essential ==> preference.kind == "stored" && preference.activity == "enabled" && deliveryVersionMatches(preference.version, destination.destinationVersion) && deliveryVersionMatches(notice.version, destination.destinationVersion)
//@ ensures \result == "send" && destination.kind == "registered" ==> deliveryVersionMatches(notice.version, destination.destinationVersion)
//@ ensures \result == "send" && destination.kind == "registered" && notice.essential ==> preference.kind == "stored" && preference.security == "enabled"
//@ ensures \result == "send" && notice.essential ==> preference.kind == "missing" || preference.security != "disabled"
//@ ensures \result == "send" <==> destination.kind != "unavailable" && (notice.essential ? ((destination.kind == "pilot" && (preference.kind == "missing" || preference.security != "disabled")) || (destination.kind == "registered" && preference.kind == "stored" && preference.security == "enabled" && deliveryVersionMatches(notice.version, destination.destinationVersion))) : (preference.kind == "stored" && preference.activity == "enabled" && deliveryVersionMatches(preference.version, destination.destinationVersion) && deliveryVersionMatches(notice.version, destination.destinationVersion)))
export function activityDeliveryDecision(
  notice: ActivityDeliveryNotice,
  destination: ActivityDeliveryDestination,
  preference: ActivityDeliveryPreference,
): "retry" | "suppress" | "send" {
  if (destination.kind === "unavailable")
    return notice.essential && destination.pilotConfigured
      ? "retry"
      : "suppress";
  if (preference.kind === "missing")
    return notice.essential && destination.kind === "pilot"
      ? "send"
      : "suppress";
  if (notice.essential) {
    if (preference.security === "disabled") return "suppress";
    if (destination.kind === "registered")
      return preference.security === "enabled" &&
        deliveryVersionMatches(notice.version, destination.destinationVersion)
        ? "send"
        : "suppress";
    return "send";
  }
  return preference.activity === "enabled" &&
    deliveryVersionMatches(
      preference.version,
      destination.destinationVersion,
    ) &&
    deliveryVersionMatches(notice.version, destination.destinationVersion)
    ? "send"
    : "suppress";
}
