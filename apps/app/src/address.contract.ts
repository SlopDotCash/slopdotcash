// spec/app/index.md, "The shell shows one route, opened from the address"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { pathTo, segmentsOf } from "./address.ts";

const segment = Arbitrary.schema(Schema.String).pipe(Arbitrary.map((s) => s.toWellFormed()), Arbitrary.filter((s) => s !== ""));

export const aPathCarriesItsSegments = contract({ input: Arbitrary.array(segment), run: pathTo, inverse: (path: string) => segmentsOf(path) ?? [], deterministic: true });
