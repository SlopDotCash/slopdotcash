import { Layer } from "effect";
import { D1 } from "@repo/platform/d1";
import { Caller } from "@repo/platform/http";
export declare const CallerLive: Layer.Layer<Caller, never, import("vibelang-runtime/experimental/Crypto").Crypto | D1>;
