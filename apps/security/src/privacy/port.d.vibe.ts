import { Layer } from "effect";
import { Audit } from "@repo/ports/security";
export declare const AuditLive: Layer.Layer<Audit, never, import("vibelang-runtime/experimental/Crypto").Crypto>;
