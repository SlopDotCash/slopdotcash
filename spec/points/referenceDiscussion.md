# Retained-copy reference discussion

Development `scripts/value-ingestion.ts` (`resolveRetainedAuthors`, lines
712-750) and `workers/slopbot/value-evidence.ts`
(`collectValueReferenceEvidence`) at `67fd54fd4`: what the Points ingestion
reads before [accepted-commit authorship](./authorship.md) takes a
retained-copy binding from a merged pull request's references.

## Story: Read a merged pull request's references from the census source

### A counted discussion read binds the census source and never replaces the retained-copy proof

Before retained-copy attribution reads a merged pull request's references,
the pull request read must still be the one the outcome census saw: the same
node ID, number, URL, head SHA, merge time and update time. Otherwise the
run fails with "Attribution source changed after the outcome census"; the
check runs before a counted discussion read and again on the discovered pull
request. A counted discussion answer, when the head is known, replaces only
the REST reads of issue comments and review comments; reviews are still
read, and the comment and review-comment counts must still equal GitHub's
reported totals, or the discovery carries a limitation and the source is
held. The retained-copy commit and file proof, the holds and the retained
authors are the same whichever route read the discussion.

```quint
type DiscussionRoute = RestComments | CountedDiscussion
type AttributionSource = { nodeId: str, number: int, url: str, headSha: str, mergedAt: int, updatedAt: int }
type ReferenceDiscussion = { route: DiscussionRoute, census: AttributionSource, pull: AttributionSource,
  comments: int, reportedComments: int, inline: int, reportedInline: int }
type DiscussionVerdict = AttributionSourceChanged | DiscussionLimited | DiscussionComplete
pure def attributionSourceUnchanged(census: AttributionSource, pull: AttributionSource): bool = pull == census
pure def discussionVerdict(discussion: ReferenceDiscussion): DiscussionVerdict =
  if (not(attributionSourceUnchanged(discussion.census, discussion.pull))) AttributionSourceChanged
  else if (discussion.comments != discussion.reportedComments or discussion.inline != discussion.reportedInline) DiscussionLimited
  else DiscussionComplete
pure def lawChangedSourceNeverCounts(discussion: ReferenceDiscussion): bool =
  discussion.pull != discussion.census implies discussionVerdict(discussion) == AttributionSourceChanged
pure def lawCountedRouteChangesNothingElse(discussion: ReferenceDiscussion): bool =
  discussionVerdict({ ...discussion, route: CountedDiscussion }) == discussionVerdict({ ...discussion, route: RestComments })
pure def lawMissingCommentsAreALimitation(discussion: ReferenceDiscussion): bool =
  (attributionSourceUnchanged(discussion.census, discussion.pull) and discussion.comments != discussion.reportedComments)
    implies discussionVerdict(discussion) == DiscussionLimited
pure val censusSource: AttributionSource = { nodeId: "PR_1", number: 7, url: "https://github.com/o/r/pull/7",
  headSha: "h1", mergedAt: 1793491300, updatedAt: 1793491400 }
pure val countedDiscussion: ReferenceDiscussion = { route: CountedDiscussion, census: censusSource, pull: censusSource,
  comments: 3, reportedComments: 3, inline: 1, reportedInline: 1 }
pure val discussionValues = Set(countedDiscussion, { ...countedDiscussion, route: RestComments },
  { ...countedDiscussion, pull: { ...censusSource, updatedAt: 1793491500 } },
  { ...countedDiscussion, pull: { ...censusSource, headSha: "h2" } },
  { ...countedDiscussion, comments: 2 })
```
