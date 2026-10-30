import { assertProfiles, type ProfileIndex } from "../src/lib/profiles";
import { isHistoricalRepositoryId } from "../src/lib/projects.mjs";

/** Validate retained census bytes against their own recorded, registered inventory. */
export function assertRetainedProfiles(value: ProfileIndex) {
  const inventory = Array.isArray(value?.repositories)
    ? value.repositories.map((row) => row.repository)
    : [];
  if (!inventory.every((id) => isHistoricalRepositoryId(id)))
    throw Error("Retained census names an unregistered repository");
  const collected = Array.isArray(value?.issues?.repositories)
    ? value.issues.repositories.map((row) => row.repository)
    : inventory;
  assertProfiles(value, collected);
}

