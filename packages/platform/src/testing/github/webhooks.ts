// spec/slopbot/webhookDelivery.md, "Bounded bytes and strict object decoding are required"
import { createHmac, randomUUID } from "node:crypto";
import type { App } from "./world.ts";

export interface Delivery {
  readonly installationId?: number;
  readonly url?: string;
  readonly deliveryId?: string;
}

/** @throws {never} */
export function signature256(secret: string, bytes: Uint8Array): string {
  return `sha256=${createHmac("sha256", secret).update(bytes).digest("hex")}`;
}

/** @throws {never} */
export function signedDelivery(app: App, event: string, payload: object, delivery: Delivery): Request {
  const body = delivery.installationId === undefined ? payload : { ...payload, installation: { id: delivery.installationId, node_id: `MDIzOkludGVncmF0aW9uSW5zdGFsbGF0aW9u${delivery.installationId}` } };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return new Request(delivery.url ?? "https://slopbot.test/github/webhook", {
    method: "POST",
    body: bytes,
    headers: {
      "content-type": "application/json",
      "user-agent": "GitHub-Hookshot/fake",
      "x-github-event": event,
      "x-github-delivery": delivery.deliveryId ?? randomUUID(),
      "x-github-hook-id": "1",
      "x-github-hook-installation-target-type": "integration",
      "x-github-hook-installation-target-id": app.id,
      "x-hub-signature": `sha1=${createHmac("sha1", app.webhookSecret).update(bytes).digest("hex")}`,
      "x-hub-signature-256": signature256(app.webhookSecret, bytes),
    },
  });
}
