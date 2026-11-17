// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"; spec/backend/closureConsent.md, "A saved edit records an explicit No only after an explicit Yes"; spec/frontend/projectDrafts.md, "Each saved setup draft has a strictly greater revision than the record it replaces"
import { vectors } from "../../../kernels/vectors.ts";
import { manifest } from "./fixtures.ts";
import type { PendingRepository } from "./manifest.schema.ts";
import { afterPublish, type Edit, managedOf, pendingRepositories, pendingText, restoredEdit, reviewOf, type UpdateField, untouched, withField } from "./revision.ts";

const now = new Date("2026-11-17T12:00:00.000Z");
const revision = 2;
const docs: PendingRepository = {
  entry: { id: "octo-org/engine-docs", displayName: "octo-org/engine-docs", githubUrl: "https://github.com/octo-org/engine-docs", description: "Documentation for the engine project.", integrationBranch: "main", githubId: "4242", nodeId: "R_kgDOdocs" },
  ownDescription: false,
};
const edited = (fields: Partial<Record<UpdateField, string>>, base: Record<string, unknown> = manifest): ReturnType<typeof reviewOf> | undefined => {
  const managed = managedOf(revision, base);
  return managed && reviewOf(managed, { fields, baseRevision: revision }, now);
};

export const closureConsentChangesOnlyByTheOwnersExplicitChoice = vectors<readonly [Partial<Record<UpdateField, string>>, boolean], unknown>(
  [
    [[{ automaticClosure: "false" }, true], { automaticClosure: false }],
    [[{ headline: "A faster engine for building open things." }, false], null],
    [[{ automaticClosure: "true" }, false], { automaticClosure: true }],
  ],
  ([fields, saved]) => {
    const { slopbot: _slopbot, ...withoutConsent } = manifest;
    return edited(fields, saved ? manifest : withoutConsent)?.next.slopbot ?? null;
  },
);

export const eachChangeIsClassedAndOnlyAFinancialOneSendsTheAmount = vectors<Partial<Record<UpdateField, string>>, readonly [ReadonlyArray<string>, ReadonlyArray<string>, ReadonlyArray<string>, string | null]>(
  [
    [{ headline: "A faster engine for building open things." }, [["headline"], [], [], null]],
    [{ repositories: pendingText([docs]) }, [[], ["repositories"], [], null]],
    [{ monthlyAmount: "2000" }, [[], [], ["reward"], "2000"]],
    [{}, [[], [], [], null]],
  ],
  (fields) => {
    const review = edited(fields);
    return review ? ([review.changes.presentation, review.changes.executable, review.changes.financial, review.monthlyAmount] as const) : ([[], [], [], null] as const);
  },
);

export const anAppendedRepositoryCountsFromTheNextUtcMonth = vectors<string, unknown>(
  [[pendingText([docs]), "2026-12-01T00:00:00.000Z"]],
  (repositories) => {
    const listed = edited({ repositories })?.next.repositories;
    return Array.isArray(listed) ? (listed.at(-1) as { countsFrom?: string } | undefined)?.countsFrom : undefined;
  },
);

export const aSavedDraftIsStaleUnlessItsBaseIsTheCurrentRevision = vectors<string | null, readonly [boolean, number | null]>(
  [
    [null, [false, null]],
    ['{"headline":"A faster engine.","baseRevision":2}', [false, 2]],
    ['{"headline":"A faster engine.","baseRevision":1}', [true, 1]],
    ['{"headline":"A faster engine."}', [true, -1]],
    ["{broken", [false, null]],
  ],
  (text) => {
    const edit = restoredEdit(text);
    const managed = managedOf(revision, manifest);
    return [managed ? reviewOf(managed, edit, now).stale : false, edit.baseRevision] as const;
  },
);

export const onlyExactlyAddedRepositoriesSurviveTheSavedDraft = vectors<string, number>(
  [
    [pendingText([docs]), 1],
    [JSON.stringify([{ ...docs, entry: { ...docs.entry, displayName: "other" } }]), 0],
    [JSON.stringify([{ ...docs, entry: { ...docs.entry, extra: true } }]), 0],
    [JSON.stringify([docs, { ...docs, entry: { ...docs.entry, githubId: "01" } }]), 0],
    ["", 0],
  ],
  (text) => pendingRepositories(text).length,
);

export const editsMadeDuringAPublishSurviveItWithoutWhatWasPublished = vectors<boolean, Edit>(
  [
    [false, untouched],
    [true, { fields: { repositories: "", headline: "Edited while publishing." }, baseRevision: 3 }],
  ],
  (editedMeanwhile) => {
    const submitted = withField(untouched, "repositories", pendingText([docs]), revision);
    const latest = editedMeanwhile ? withField(submitted, "headline", "Edited while publishing.", revision) : submitted;
    return afterPublish(latest, submitted, ["octo-org/engine", "octo-org/engine-docs"], 3);
  },
);
