export function copyFixtureHistory(target: string): void;
export function copyFixtureSkills(target: string): void;
type MutableFixture<T> = T extends object
  ? { -readonly [K in keyof T]: MutableFixture<T[K]> }
  : T;
export function fixtureProject(
  id: string,
): MutableFixture<import("../src/lib/projects.mjs").ProjectDefinition>;
