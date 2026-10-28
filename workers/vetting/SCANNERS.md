# Independent model review transports

The bounded malicious-code scan uses `reviewScan`: one primary review with the
pinned `slop-scan-review-1` prompt, whose coverage areas are the scan's five
threat checks, and a second model or specialist review only for an ambiguous
or high-risk result ([worker](README.md)). An inventory larger than one call
is reviewed by `review-plan.ts` in token-budgeted batches with the same prompt,
then one `slop-scan-synthesis-1` call over the deterministic pre-pass and every
batch result; each is an ordinary `reviewScan` call. It shares the transports, limits,
identity checks and private records described below, and never retries, picks
a fallback provider, clears or bans.

`reviewScan` implements the OpenAI Responses and Anthropic Messages
transports. It makes one call for the configured reviewer profile. It does
not choose a model, replace a failed provider, retry an uncertain request, or
make a project clearance or ban decision. The historical secure-VM contract
(`slop-vetting-result-v1`) required two independent reviews; the intake
still parses stored v1 results.

The operator supplies both profiles: reviewer class, endpoint, model, API key,
output-token limit and rate card. Owner decision D16 approves exactly two
profiles (`PINNED_SCANNER_PROFILES`), both through Surplus Intelligence:

| Transport | Reviewer | Endpoint | Model |
| --- | --- | --- | --- |
| Anthropic Messages | `opus` | `https://api.surplusintelligence.ai/anthropic/v1/messages` | `claude-opus-5.5` |
| OpenAI Responses | `astra` | `https://api.surplusintelligence.ai/v1/responses` | `gpt-6.1-sol` |

Any other endpoint, including the providers' own APIs, any other model and any
other reviewer class fails readiness with "Unapproved scanner profile" before
a provider is contacted. Surplus takes the account key as a bearer token and
records the provider as `surplus`. The marketplace model identity is not
independently verified. Its returned identity must equal the pinned identity;
matching a provider's echoed alias alone does not establish version
immutability.
The two profiles must use different reviewer classes and transports. Both must
pass readiness checks before either provider is contacted.

The caller supplies the exact JSON evidence bytes and their SHA-256 digest.
The evidence contains `items` with `id`, `text` and `sha256`, plus
`visibilityGaps`. The worker checks every text digest and rejects duplicate ids.
Both initial reviews receive the same bytes, with no prior model output. The
pinned system prompt treats repository content as evidence, never authority.
No tools are enabled. The OpenAI request disables response storage and input
truncation. Each call's evidence is limited to 1 MiB; it is not silently
shortened, and a larger inventory is split into batches instead.
Approved provider retention and private-data handling are operational gates.

Each response must finish normally, return the pinned model and contain one
JSON review. The review must cover all seven required areas and link every
finding to supplied evidence ids. Missing or partial coverage stays in
`visibilityGaps`. Findings remain advisory, including a model's suspicion of
malice. The publisher must retain these gaps and reconcile both reviews with
source and runtime evidence; it cannot use a completed model response alone as
permission to clear a project.

Each private record binds the prompt revision and digest, evidence digest,
unique local run id, provider response id, returned model and response digest.
It records confidence, coverage and findings. Valid provider token counts are
retained even when the advisory content fails validation. An operator-supplied
rate card gives an integer nano-USD estimate, explicitly labelled as an
estimate. It is not a provider bill or payment record. A mismatched returned
model retains usage but receives no estimate from the wrong model's rate card.
Missing or invalid usage leaves the review failed. No provider error body,
credential, prompt or response text is returned in an exception.

Calls have a 120-second timeout plus 1 ms per estimated input token (at most
10 minutes) and a 1 MiB response limit. Model refusal,
truncation, unexpected tools, identity mismatch, invalid evidence references
and provider errors fail the review. The API key stays in its request header;
it does not enter the review prompt or evidence record. Keep all returned
records private. The worker has no signing key and no result-publication route.

## Validation and remaining gates

```sh
bun test scripts/vetting-scan-service.test.ts
```

The retained scan-service workflow uses real project and vetting handlers,
SQLite migrations, local workerd R2 and a local HTTP server with synthetic provider responses.
They check independent request bodies, input and model identity, disagreement,
partial coverage, unavailable providers, source-linked findings, usage retention
and readiness before outbound calls. They do not prove an actual Astra or Opus
review. No real provider call or credential is part of these tests.

The operational profile, actual provider access, reviewed model version,
complete source/artifact/runtime evidence, private retention, trusted
reconciliation and full VET-08 acceptance remain required. A valid evidence
bundle cannot prove by itself that an operator collected every required input.

Transport references: [OpenAI text generation](https://developers.openai.com/api/docs/guides/text)
and [Anthropic Messages](https://platform.claude.com/docs/en/api/typescript/messages/create).
