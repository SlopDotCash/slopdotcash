// spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent's skill address together"
import { audienceOf, audienceQuery, type HomeAudience } from "../../../gen/frontend__presentation.ts";

export const audienceParameter = "audience";

export const journeys: ReadonlyArray<HomeAudience> = ["Contributor", "Maintainer"];

/** The journey an address names by its `audience` query parameter. @throws {never} */
export function journeyOf(address: URL): HomeAudience {
  return audienceOf(address.searchParams.get(audienceParameter) ?? "");
}

/** The same address with only `audience` set for the journey, or removed for the Contributor journey; other parameters and the fragment stay. @throws {never} */
export function journeyAddress(address: URL, journey: HomeAudience): URL {
  const next = new URL(address);
  const query = audienceQuery(journey);
  if (query === "") next.searchParams.delete(audienceParameter);
  else next.searchParams.set(audienceParameter, query);
  return next;
}
