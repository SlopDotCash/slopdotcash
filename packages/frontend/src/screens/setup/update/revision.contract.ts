// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/frontend/readyLabelForm.md, "The control starts off with the defaults when nothing is saved, saves only bounded settings while on, and keeps the owner's numbers when turned off"; spec/backend/readyLabelSettings.md, "Ready-label settings are bounded, off when absent or disabled, and only add protected paths"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"; spec/backend/closureConsent.md, "A saved edit records an explicit No only after an explicit Yes"; spec/frontend/projectDrafts.md, "Each saved setup draft has a strictly greater revision than the record it replaces"
import { vectors } from "../../../kernels/vectors.ts";
import { manifest } from "./fixtures.ts";
import type { PendingRepository } from "./manifest.schema.ts";
import { afterPublish, type Edit, initialDraft, managedOf, pendingRepositories, pendingText, restoredEdit, reviewOf, type UpdateField, untouched, withField } from "./revision.ts";

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

const ready = { enabled: true, approvals: 2, maxChangedLines: 300, maxChangedFiles: 12, protectedPaths: ["docs/legal/"] };
const withReady = { ...manifest, slopbot: { automaticClosure: true, readyLabel: ready } };
const rowOf = (fields: Partial<Record<UpdateField, string>>, label: string, base: Record<string, unknown> = manifest) => edited(fields, base)?.rows.find((row) => row.label === label);

export const theFormOpensOnTheSavedLinksAndReadyLabelElseItsDefaults = vectors<Record<string, unknown>, readonly [string, string, string, string, string, string, string]>(
  [
    [manifest, ["https://ntwrk.party", "", "false", "1", "400", "20", ""]],
    [{ ...manifest, links: { ...manifest.links, x: "https://x.com/elizaOS" } }, ["https://ntwrk.party", "@elizaOS", "false", "1", "400", "20", ""]],
    [withReady, ["https://ntwrk.party", "", "true", "2", "300", "12", "docs/legal/"]],
    [{ ...withReady, slopbot: { readyLabel: { ...ready, enabled: false } } }, ["https://ntwrk.party", "", "false", "2", "300", "12", "docs/legal/"]],
    [{ ...withReady, slopbot: { automaticClosure: true, readyLabel: { ...ready, approvals: 99 } } }, ["https://ntwrk.party", "", "false", "1", "400", "20", ""]],
  ],
  (base) => {
    const value = managedOf(revision, base);
    const draft = value && initialDraft(value.manifest);
    return draft ? ([draft.website, draft.x, draft.readyLabel, draft.readyApprovals, draft.readyMaxLines, draft.readyMaxFiles, draft.readyProtectedPaths] as const) : (["", "", "", "", "", "", ""] as const);
  },
);

export const anInvalidLinkShowsItsErrorAndKeepsThePublishedOne = vectors<Partial<Record<UpdateField, string>>, readonly [unknown, string | undefined, string | undefined]>(
  [
    [{ website: "example.org", x: "@elizaOS" }, [{ repository: "https://github.com/octo-org/engine", issues: "https://github.com/octo-org/engine/issues", website: "https://example.org", x: "https://x.com/elizaOS" }, undefined, undefined]],
    [{ website: "", x: "" }, [{ repository: "https://github.com/octo-org/engine", issues: "https://github.com/octo-org/engine/issues" }, undefined, undefined]],
    [
      { website: "http://example.org", x: "@not a handle" },
      [{ repository: "https://github.com/octo-org/engine", issues: "https://github.com/octo-org/engine/issues", website: "https://ntwrk.party" }, "Use an https:// address.", "Enter an X handle such as @slopcash, or its x.com link."],
    ],
  ],
  (fields) => {
    const review = edited(fields);
    return [review?.next.links, review?.errors.website, review?.errors.x] as const;
  },
);

export const theReviewNamesTheWebsiteXAccountAndReadyLabelChanges = vectors<readonly [Partial<Record<UpdateField, string>>, string, Record<string, unknown>], unknown>(
  [
    [[{ website: "" }, "Website", manifest], { field: "website", label: "Website", current: "https://ntwrk.party", proposed: "None" }],
    [[{ x: "@elizaOS" }, "X account", manifest], { field: "x", label: "X account", current: "None", proposed: "https://x.com/elizaOS" }],
    [[{ readyLabel: "true" }, "Slopbot ready label", manifest], { field: "readyLabel", label: "Slopbot ready label", current: "Off", proposed: "On: 1 approval, at most 400 lines in 20 files" }],
    [[{ readyLabel: "false" }, "Slopbot ready label", withReady], { field: "readyLabel", label: "Slopbot ready label", current: "On: 2 approvals, at most 300 lines in 12 files, 1 extra protected path", proposed: "Off" }],
    [[{ headline: "A faster engine for building open things." }, "Slopbot ready label", withReady], undefined],
  ],
  ([fields, label, base]) => rowOf(fields, label, base),
);

export const turningTheReadyLabelOffKeepsItsSavedNumbers = vectors<readonly [Partial<Record<UpdateField, string>>, Record<string, unknown>], unknown>(
  [
    [[{ readyLabel: "false" }, withReady], { automaticClosure: true, readyLabel: { ...ready, enabled: false } }],
    [[{ readyLabel: "true", readyApprovals: "3", readyProtectedPaths: " *.sql \n\n*.sql\ndocs/legal/" }, manifest], { automaticClosure: true, readyLabel: { enabled: true, approvals: 3, maxChangedLines: 400, maxChangedFiles: 20, protectedPaths: ["*.sql", "docs/legal/"] } }],
    [[{ readyLabel: "false" }, manifest], { automaticClosure: true }],
    [[{ readyLabel: "true" }, { ...manifest, slopbot: undefined }], { readyLabel: { enabled: true, approvals: 1, maxChangedLines: 400, maxChangedFiles: 20, protectedPaths: [] } }],
  ],
  ([fields, base]) => edited(fields, base)?.next.slopbot,
);

export const anOutOfRangeReadyLabelShowsItsBoundsAndKeepsTheSavedSetting = vectors<Partial<Record<UpdateField, string>>, readonly [unknown, ReadonlyArray<string>]>(
  [
    [{ readyApprovals: "0" }, [ready, ["Enter a whole number from 1 to 10."]]],
    [{ readyMaxLines: "5001", readyMaxFiles: "1.5" }, [ready, ["Enter a whole number from 1 to 5000.", "Enter a whole number from 1 to 300."]]],
    [{ readyProtectedPaths: "/etc" }, [ready, ["/etc: Write the path relative to the repository root."]]],
    [{ readyProtectedPaths: Array.from({ length: 51 }, (_, index) => `p${index}/`).join("\n") }, [ready, ["List at most 50 paths."]]],
    [{ readyLabel: "false", readyApprovals: "0" }, [{ ...ready, enabled: false }, []]],
  ],
  (fields) => {
    const review = edited(fields, withReady);
    const slopbot = review?.next.slopbot as { readyLabel?: unknown } | undefined;
    return [slopbot?.readyLabel, Object.entries(review?.errors ?? {}).filter(([field]) => field.startsWith("ready")).map(([, message]) => message)] as const;
  },
);
