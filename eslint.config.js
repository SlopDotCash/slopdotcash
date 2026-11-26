import { existsSync, readdirSync, readFileSync } from "node:fs"
import { relative, sep } from "node:path"
import js from "@eslint/js"
import react from "@eslint-react/eslint-plugin"
import tailwind from "eslint-plugin-better-tailwindcss"
import boundaries from "eslint-plugin-boundaries"
import reactHooks from "eslint-plugin-react-hooks"
import { defineConfig, globalIgnores } from "eslint/config"
import tseslint from "typescript-eslint"
import vibelang from "vibelang/eslint"
import { designSystem } from "./vibestack/design/eslint.ts"
import { parseTokens } from "./vibestack/design/tokens.ts"

const stack = 'AGENTS.md, "The stack"'
const monorepo = 'CONTRIBUTING.md, "The monorepo"'
const banned = ["redux", "react-redux", "zustand", "mobx", "jotai", "recoil", "valtio", "xstate", "vue", "svelte", "jest"]
const scopes = ["reduxjs", "angular", "xstate", "vue", "sveltejs", "jest"]
// Each workspace package's `exports` beyond its root: "@repo/design-system/theme.css", "@repo/backend/live". A directory
// without a package.json is no workspace package (pnpm-workspace.yaml). Node export wildcards also match nested subpaths.
const exported = ["apps", "packages"].flatMap((parent) => readdirSync(parent).filter((dir) => existsSync(`${parent}/${dir}/package.json`)).flatMap((dir) => {
  const { name, exports = {} } = JSON.parse(readFileSync(`${parent}/${dir}/package.json`, "utf8"))
  return Object.keys(exports).filter((key) => key !== ".").map((key) => `${name}/${key.slice(2)}`.split("*").map((part) => RegExp.escape(part)).join("[^/]+(?:/[^/]+)*"))
}))
// Files copied byte for byte from development and pinned by SHA-256 in frozen.json: records, never linted or rewritten.
const frozen = JSON.parse(readFileSync(`${import.meta.dirname}/frozen.json`, "utf8")).ignore
// ARCHITECTURE D14: a signing key is reached only from its own src/signer/ and that key's Worker or program entry.
const custody = "A signing key stays in its app's src/signer/ and its own entry (ARCHITECTURE D14)"
const signing = {
  patterns: [
    { regex: "^viem/accounts(?:/|$)", message: custody },
    { regex: "(?:^|/)signer(?:/|$)", message: custody },
  ],
}
const curves = ["ed25519", "ed25519ph", "ed25519ctx", "secp256k1", "schnorr", "p256"]
const signs = curves.flatMap((object) => ["sign", "keygen", "getPublicKey"].map((property) => ({ object, property, message: custody })))
// The attester, keeper and fee-wallet keys, and the referral root poster, each with its own entry.
const keys = ["apps/settlement/src/signer/**", "apps/fees/src/signer/**", "apps/settlement/src/workers/{attester,keeper}.*", "apps/settlement/src/keeper/{signer,solana}.*", "apps/fees/src/workers/feeConverter.*", "apps/fees/src/workers/submissionFee.*"]
const poster = ["apps/settlement/src/signer/rootPoster*", "apps/settlement/src/programs/referralRoots.*", "apps/settlement/src/workers/referralAccrual.*"]
const imports = {
  patterns: [
    // A package, its subpaths and its family: zustand/middleware, redux-saga, @angular/core.
    { regex: `^(?:@(?:${scopes.join("|")})/|(?:${banned.join("|")})(?:[/-]|$))`, message: `Not part of the stack: ${stack}.` },
    { regex: `^(?!(?:${exported.join("|")})$)@repo/[^/]+/`, message: `Import a workspace package by a path its "exports" names: ${monorepo}.` },
  ],
}
const noReact = { patterns: [...imports.patterns, { regex: "^react(?:-dom)?(?:/|$)", message: `Tool and domain code does not import React: ${monorepo}.` }] }
// What no tsconfig.json includes, so the type-aware rules cannot see it.
const untyped = ["*.{js,ts}", "**/.storybook/**", "packages/design-system/**", "vibestack/design/test/**", "vibestack/stories/test/**"]
// Every React interface: Studio's page is built on the same theme (vibestack/studio/vite.config.ts).
const tsx = ["packages/ui/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}", "vibestack/studio/src/page/**/*.{ts,tsx}"]
const design = "packages/design-system"
const writing = 'AGENTS.md, "Writing code"'
const citation = String.raw`spec\/\S+\.md, "[^"]+"`
const suppressible = String.raw`(?!code\/|no-console\b)[\w@/-]+`
const cited = new RegExp(String.raw`^\s*${citation}(?:; ${citation})*\s*$`)
const suppression = new RegExp(String.raw`^ eslint-disable(?:-next-line|-line)? ${suppressible}(?:, ${suppressible})* -- \S`)
const configs = [suppression, /^ eslint-enable\b/]
const throwsType = String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*`
const throwsDirective = new RegExp(String.raw`^\*(?:[\s*]*@throws \{[ \t]*${throwsType}(?:[ \t]*\|[ \t]*${throwsType})*[ \t]*\})+[\s*]*$`)
const directives = {
  Line: [cited, suppression, /^@ (?:backend|requires|ensures|invariant|decreases|assert|pure|type|ghost)(?: |$)/, /^\/ <reference /, /^ @vitest-environment [\w-]+$/],
  Block: [cited, ...configs, /^\*(?:[\s*]*@(?:model|design) \S+)+[\s*]*$/, throwsDirective],
  Shebang: [/^/],
}
const inline = /^\s*(?:eslint(?:-[a-z]+)*|exported|globals?)(?:\s|$)/
function removeSyntheticLoopBindings(node, visitorKeys) {
  if (node.type === "SwitchStatement" && node.discriminant.synthesized === true) {
    const block = node.cases[0]?.consequent[0]
    if (block?.type === "BlockStatement") {
      const [head, loop, exit, ...bindings] = block.body
      if (loop?.type === "ForOfStatement" && loop.right.synthesized === true && exit?.type === "BreakStatement") {
        block.body = [head, loop, exit, ...bindings.filter((statement) => statement.type !== "VariableDeclaration" ||
          !statement.declarations.every(({ id, init }) => id.synthesized === true && init === null))]
      }
    }
  }
  for (const key of visitorKeys[node.type] ?? []) {
    const child = node[key]
    if (Array.isArray(child)) {
      for (const item of child) if (item) removeSyntheticLoopBindings(item, visitorKeys)
    } else if (child) removeSyntheticLoopBindings(child, visitorKeys)
  }
}

const vibeParser = {
  ...vibelang,
  parseForESLint(text, options) {
    const parsed = vibelang.parseForESLint(text, options)
    // The parser has already analyzed the synthetic for-try bindings past the break.
    removeSyntheticLoopBindings(parsed.ast, parsed.visitorKeys)
    return parsed
  },
}

const guarded = (parser) => ({
  meta: { name: `${parser.meta.name} with code/inline`, version: parser.meta.version },
  parseForESLint: (text, options) => {
    const parsed = parser.parseForESLint(text, options)
    const loose = parsed.ast.comments.find((comment) => inline.test(comment.value) && !configs.some((form) => form.test(comment.value)))
    if (loose) throw Object.assign(new SyntaxError(`Inline config here is only "eslint-disable[-next-line|-line] <rule>, … -- <reason>", never for code/* or no-console, and "eslint-enable" (${writing}).`), { lineNumber: loose.loc.start.line, column: loose.loc.start.column + 1 })
    return parsed
  },
})
const within = (node) => Boolean(node) && (/Function/.test(node.type) || within(node.parent))
const documented = (context, comment) => context.options[0]?.jsdoc && comment.type === "Block" && comment.value.startsWith("*") && !within(context.sourceCode.getNodeByRangeIndex(comment.range[0]))
const left = { type: "object", additionalProperties: { type: "integer", minimum: 1 } }
const excess = (context, node, found, kind) => {
  const rel = relative(context.cwd, context.filename).split(sep).join("/")
  const limits = context.options[0]?.left
  const allowed = limits && Object.hasOwn(limits, rel) ? limits[rel] : 0
  if (found.length > allowed) found.forEach((problem) => context.report(problem))
  else if (allowed > 0 && found.length < allowed) context.report({ node, message: found.length ? `Stale ${kind} ratchet (${allowed}) for "${rel}": ${found.length} remain; lower it to ${found.length}.` : `Stale ${kind} ratchet (${allowed}) for "${rel}": 0 remain; remove it.` })
}
const comments = {
  meta: { type: "problem", schema: [{ type: "object", properties: { jsdoc: { type: "boolean" }, left }, additionalProperties: false }] },
  create: (context) => ({
    Program: (node) => excess(context, node, context.sourceCode.getAllComments()
      .filter((comment) => !directives[comment.type].some((directive) => directive.test(comment.value)) && !documented(context, comment))
      .map((comment) => ({ loc: comment.loc, message: `No code comments: only spec citations and tool directives (${writing}).` })), "commented"),
  }),
}
const uses = (names) => `:matches(Identifier[name=${names}]:not(ImportSpecifier[imported.name=${names}] > Identifier.local):not(ObjectExpression > Property[computed=false][shorthand=false] > Identifier.key), MemberExpression[computed=true] > Literal.property[value=${names}])`
const scheduling = {
  [uses(/^use(?:Layout|Insertion)?Effect$/)]: `No effect hooks: shared state lives in the spec-backed Machine (${writing}).`,
  [uses(/^(?:setTimeout|setInterval|setImmediate|queueMicrotask|requestAnimationFrame|requestIdleCallback)$/)]: `No timers: wait with Effect in VibeLang, or let the Machine say when (${writing}).`,
}
const effects = {
  meta: { type: "problem", schema: [{ type: "object", properties: { left }, additionalProperties: false }] },
  create: (context) => {
    const found = []
    return { ...Object.fromEntries(Object.entries(scheduling).map(([selector, message]) => [selector, (node) => found.push({ node, message })])), "Program:exit": (node) => excess(context, node, found, "scheduled") }
  },
}
const redeclarations = {
  meta: { schema: [] },
  create(context) {
    return {
      "Program:exit"() {
        for (const scope of context.sourceCode.scopeManager.scopes) {
          for (const variable of scope.variables) {
            let type = false
            let value = variable.eslintImplicitGlobalSetting === "readonly" || variable.eslintImplicitGlobalSetting === "writable"
            for (const definition of variable.defs) {
              if ((definition.isTypeDefinition && type) || (definition.isVariableDefinition && value)) {
                context.report({ node: definition.name, message: "'{{name}}' is already defined in this namespace.", data: { name: variable.name } })
              }
              type ||= definition.isTypeDefinition
              value ||= definition.isVariableDefinition
            }
          }
        }
      },
    }
  },
}
const warningComments = {
  meta: { schema: [] },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const marker = /\b(?:todo|fixme|legacy|deprecated)\b/iu.exec(comment.value)?.[0]
          if (marker !== undefined && !cited.test(comment.value)) {
            context.report({ loc: comment.loc, message: "Unexpected '{{marker}}' comment.", data: { marker } })
          }
        }
      },
    }
  },
}
const code = { rules: { comments, effects, redeclarations, warningComments } }
const own = ["apps/**", "packages/**"]
const commented = {
  "apps/app/src/App.tsx": 4,
  "apps/app/src/address.ts": 4,
  "apps/app/src/head.ts": 2,
  "apps/app/src/routes.vibe": 3,
  "apps/app/test/drivers/app.ts": 3,
  "apps/app/vitest.config.ts": 1,
  "apps/backend/test/backend-binding.test.vibe": 3,
  "apps/backend/test/backend-referrals.test.vibe": 4,
  "apps/backend/test/backend-registry.test.vibe": 8,
  "apps/backend/test/backend-session.test.vibe": 3,
  "apps/backend/test/backend-setup.test.vibe": 6,
  "apps/backend/test/backend-wallets.test.vibe": 3,
  "apps/points/test/points-U12.test.vibe": 2,
  "apps/points/test/points.test.vibe": 2,
  "apps/points/test/support/catchup3-e1/world.ts": 1,
  "apps/points/test/support/u16/github.ts": 3,
  "apps/points/test/support/u5/github.ts": 2,
  "apps/settlement/test/drivers/settlement__vaultSnapshots.ts": 1,
  "packages/contracts/test/drivers/contracts__evmEscrow.ts": 7,
  "packages/contracts/test/drivers/contracts__solanaEscrow.ts": 22,
  "packages/contracts/test/support/anvil.ts": 1,
  "packages/contracts/test/support/solanaAccounts.ts": 14,
  "packages/contracts/test/support/solanaChain.ts": 27,
  "packages/contracts/test/support/solanaState.ts": 3,
  "packages/frontend/src/app/publicPages.tsx": 1,
  "packages/frontend/src/kernels/payingNetworks.ts": 1,
  "packages/frontend/src/kernels/poolPromise.ts": 2,
  "packages/frontend/src/kernels/projectLinks.ts": 7,
  "packages/frontend/src/projections/maintainerShare.ts": 2,
  "packages/frontend/src/projections/projectView.ts": 1,
  "packages/frontend/src/reads/registryTerms.ts": 2,
  "packages/frontend/src/referrals/ReferralSettings.tsx": 7,
  "packages/frontend/src/screens/account/EmailPreferences.tsx": 8,
  "packages/frontend/src/screens/account/JoinPoints.tsx": 5,
  "packages/frontend/src/screens/account/LoginPage.tsx": 2,
  "packages/frontend/src/screens/account/SettingsPage.tsx": 1,
  "packages/frontend/src/screens/account/WalletManagement.tsx": 9,
  "packages/frontend/src/screens/account/useView.ts": 1,
  "packages/frontend/src/screens/admin/ActivationClearance.tsx": 2,
  "packages/frontend/src/screens/admin/AdminPage.tsx": 1,
  "packages/frontend/src/screens/admin/AdmissionExemptions.tsx": 1,
  "packages/frontend/src/screens/admin/AssessmentDetails.tsx": 2,
  "packages/frontend/src/screens/admin/DelistButton.tsx": 1,
  "packages/frontend/src/screens/admin/EnforcementPanel.tsx": 1,
  "packages/frontend/src/screens/admin/EnforcementSummary.tsx": 2,
  "packages/frontend/src/screens/admin/EvidenceItem.tsx": 1,
  "packages/frontend/src/screens/admin/EvidenceRunCard.tsx": 1,
  "packages/frontend/src/screens/admin/ExemptionHistory.tsx": 2,
  "packages/frontend/src/screens/admin/FeeConversionList.tsx": 2,
  "packages/frontend/src/screens/admin/FeeConversions.tsx": 1,
  "packages/frontend/src/screens/admin/ProjectEditor.tsx": 1,
  "packages/frontend/src/screens/admin/ProjectList.tsx": 4,
  "packages/frontend/src/screens/admin/ProjectsSection.tsx": 1,
  "packages/frontend/src/screens/admin/VettingEvidencePage.tsx": 1,
  "packages/frontend/src/screens/admin/VettingSection.tsx": 1,
  "packages/frontend/src/screens/admin/editor.ts": 8,
  "packages/frontend/src/screens/admin/enforcement.ts": 3,
  "packages/frontend/src/screens/admin/feeReport.ts": 4,
  "packages/frontend/src/screens/admin/parts.tsx": 2,
  "packages/frontend/src/screens/admin/projects.ts": 3,
  "packages/frontend/src/screens/admin/vetting.ts": 11,
  "packages/frontend/src/screens/cycles/CycleAllocation.tsx": 9,
  "packages/frontend/src/screens/cycles/CycleAmountHistory.tsx": 3,
  "packages/frontend/src/screens/cycles/CyclePage.tsx": 3,
  "packages/frontend/src/screens/cycles/OwnerCuts.tsx": 3,
  "packages/frontend/src/screens/cycles/boundary.ts": 3,
  "packages/frontend/src/screens/cycles/filters.ts": 4,
  "packages/frontend/src/screens/cycles/labels.ts": 7,
  "packages/frontend/src/screens/cycles/stages.ts": 6,
  "packages/frontend/src/screens/funding/awards/AwardAmounts.tsx": 4,
  "packages/frontend/src/screens/funding/awards/BountyFunding.tsx": 5,
  "packages/frontend/src/screens/funding/awards/BountyIntroduction.tsx": 5,
  "packages/frontend/src/screens/funding/awards/MonthPanel.tsx": 13,
  "packages/frontend/src/screens/funding/awards/OwnerAwards.tsx": 5,
  "packages/frontend/src/screens/funding/awards/OwnerCommitment.tsx": 10,
  "packages/frontend/src/screens/funding/awards/ReserveRelease.tsx": 16,
  "packages/frontend/src/screens/funding/awards/hooks.ts": 4,
  "packages/frontend/src/screens/funding/awards/month.ts": 8,
  "packages/frontend/src/screens/funding/vault/AutomaticMonthlyPayment.tsx": 8,
  "packages/frontend/src/screens/funding/vault/EscrowFunding.tsx": 16,
  "packages/frontend/src/screens/funding/vault/PendingCheck.tsx": 12,
  "packages/frontend/src/screens/funding/vault/PublicVaultFunding.tsx": 7,
  "packages/frontend/src/screens/funding/vault/VaultFunders.tsx": 4,
  "packages/frontend/src/screens/funding/vault/VaultMonthLock.tsx": 9,
  "packages/frontend/src/screens/funding/vault/VaultTotals.tsx": 2,
  "packages/frontend/src/screens/funding/vault/pageVisibility.ts": 1,
  "packages/frontend/src/screens/funding/vault/project.schema.ts": 1,
  "packages/frontend/src/screens/funding/vault/savedPlans.ts": 2,
  "packages/frontend/src/screens/home/AgentPrompt.tsx": 6,
  "packages/frontend/src/screens/home/CampaignHeading.tsx": 2,
  "packages/frontend/src/screens/home/CommunityRows.tsx": 2,
  "packages/frontend/src/screens/home/HomePage.tsx": 4,
  "packages/frontend/src/screens/home/InstallPanel.tsx": 2,
  "packages/frontend/src/screens/home/SecurityOffers.tsx": 2,
  "packages/frontend/src/screens/home/audience.ts": 2,
  "packages/frontend/src/screens/home/listing.ts": 20,
  "packages/frontend/src/screens/home/promise.ts": 3,
  "packages/frontend/src/screens/inbox/EmailLinkAction.tsx": 4,
  "packages/frontend/src/screens/inbox/InboxItem.tsx": 3,
  "packages/frontend/src/screens/inbox/InboxPage.tsx": 1,
  "packages/frontend/src/screens/inbox/IncompleteAssessments.tsx": 8,
  "packages/frontend/src/screens/inbox/PointsDisputes.tsx": 3,
  "packages/frontend/src/screens/inbox/linkSignal.ts": 2,
  "packages/frontend/src/screens/payouts/ConsentReview.tsx": 9,
  "packages/frontend/src/screens/payouts/ContributorAllocationRow.tsx": 3,
  "packages/frontend/src/screens/payouts/PayoutAmount.tsx": 8,
  "packages/frontend/src/screens/payouts/PayoutConsent.tsx": 5,
  "packages/frontend/src/screens/payouts/PayoutRow.tsx": 12,
  "packages/frontend/src/screens/payouts/PayoutsPage.tsx": 9,
  "packages/frontend/src/screens/payouts/feed.ts": 1,
  "packages/frontend/src/screens/points/ContributorStandings.tsx": 10,
  "packages/frontend/src/screens/points/People.tsx": 6,
  "packages/frontend/src/screens/points/PointsPage.tsx": 1,
  "packages/frontend/src/screens/points/hooks.ts": 1,
  "packages/frontend/src/screens/points/pages.ts": 2,
  "packages/frontend/src/screens/points/peopleRows.ts": 2,
  "packages/frontend/src/screens/points/query.ts": 2,
  "packages/frontend/src/screens/points/standings.ts": 4,
  "packages/frontend/src/screens/profiles/ContributorIdentity.tsx": 3,
  "packages/frontend/src/screens/profiles/ProfileActivity.tsx": 8,
  "packages/frontend/src/screens/profiles/ProfilePage.tsx": 3,
  "packages/frontend/src/screens/profiles/ProfilePayments.tsx": 8,
  "packages/frontend/src/screens/profiles/ProfilePoints.tsx": 13,
  "packages/frontend/src/screens/profiles/profile.ts": 7,
  "packages/frontend/src/screens/projects/FundsAndAwards.tsx": 5,
  "packages/frontend/src/screens/projects/InstallPanel.tsx": 6,
  "packages/frontend/src/screens/projects/MergeActivity.tsx": 4,
  "packages/frontend/src/screens/projects/Participation.tsx": 4,
  "packages/frontend/src/screens/projects/PaymentHistory.tsx": 5,
  "packages/frontend/src/screens/projects/PaymentRecord.tsx": 11,
  "packages/frontend/src/screens/projects/ProjectHeader.tsx": 3,
  "packages/frontend/src/screens/projects/ProjectLinks.tsx": 2,
  "packages/frontend/src/screens/projects/ProjectPage.tsx": 3,
  "packages/frontend/src/screens/projects/ProjectWork.tsx": 4,
  "packages/frontend/src/screens/projects/RewardSummary.tsx": 6,
  "packages/frontend/src/screens/projects/hooks.ts": 1,
  "packages/frontend/src/screens/projects/project.schema.ts": 1,
  "packages/frontend/src/screens/projects/summary.ts": 16,
  "packages/frontend/src/screens/public/FundingStatus.tsx": 2,
  "packages/frontend/src/screens/public/HowItWorksPage.tsx": 1,
  "packages/frontend/src/screens/public/PaymentLifecycle.tsx": 4,
  "packages/frontend/src/screens/public/PointsRules.tsx": 2,
  "packages/frontend/src/screens/public/SponsorsPage.tsx": 2,
  "packages/frontend/src/screens/public/WhoBuilds.tsx": 4,
  "packages/frontend/src/screens/security/cases/ActionForm.tsx": 2,
  "packages/frontend/src/screens/security/cases/AnalysisPanel.tsx": 1,
  "packages/frontend/src/screens/security/cases/AppealTriage.tsx": 1,
  "packages/frontend/src/screens/security/cases/CaseActions.tsx": 2,
  "packages/frontend/src/screens/security/cases/CaseDetail.tsx": 9,
  "packages/frontend/src/screens/security/cases/LinkReports.tsx": 17,
  "packages/frontend/src/screens/security/cases/SecurityCasesPage.tsx": 1,
  "packages/frontend/src/screens/security/cases/SecurityInbox.tsx": 6,
  "packages/frontend/src/screens/security/cases/actionSpec.ts": 3,
  "packages/frontend/src/screens/security/cases/amount.ts": 1,
  "packages/frontend/src/screens/security/cases/case.schema.ts": 2,
  "packages/frontend/src/screens/security/cases/labels.ts": 13,
  "packages/frontend/src/screens/security/cases/parts.tsx": 3,
  "packages/frontend/src/screens/security/payments/CasePayment.tsx": 3,
  "packages/frontend/src/screens/security/payments/DirectBountyPayment.tsx": 8,
  "packages/frontend/src/screens/security/payments/SecurityCasesWithPayments.tsx": 1,
  "packages/frontend/src/screens/security/payments/SolanaBountyPayment.tsx": 5,
  "packages/frontend/src/screens/security/payments/SolanaBountyRecovery.tsx": 3,
  "packages/frontend/src/screens/security/payments/SubmittedPayments.tsx": 3,
  "packages/frontend/src/screens/security/payments/UnsignedRequest.tsx": 3,
  "packages/frontend/src/screens/security/payments/hooks.ts": 2,
  "packages/frontend/src/screens/security/payments/parts.tsx": 2,
  "packages/frontend/src/screens/security/payments/request.ts": 6,
  "packages/frontend/src/screens/security/program/ClaimForm.tsx": 4,
  "packages/frontend/src/screens/security/program/DepositLine.tsx": 3,
  "packages/frontend/src/screens/security/program/DepositNotice.tsx": 1,
  "packages/frontend/src/screens/security/program/IntakePanel.tsx": 3,
  "packages/frontend/src/screens/security/program/ProgramExclusions.tsx": 1,
  "packages/frontend/src/screens/security/program/ProgramTerms.tsx": 4,
  "packages/frontend/src/screens/security/program/ReportComposer.tsx": 3,
  "packages/frontend/src/screens/security/program/ReportDetail.tsx": 2,
  "packages/frontend/src/screens/security/program/ReportForm.tsx": 1,
  "packages/frontend/src/screens/security/program/ReportProofFields.tsx": 2,
  "packages/frontend/src/screens/security/program/SecurityOffer.tsx": 4,
  "packages/frontend/src/screens/security/program/SecurityProgramPage.tsx": 9,
  "packages/frontend/src/screens/security/program/SubmissionCard.tsx": 13,
  "packages/frontend/src/screens/security/program/SubmissionsPanel.tsx": 6,
  "packages/frontend/src/screens/security/program/amounts.ts": 1,
  "packages/frontend/src/screens/security/program/summary.ts": 8,
  "packages/frontend/src/screens/security/program/terms.schema.ts": 1,
  "packages/frontend/src/screens/security/settings/ProgramEditor.tsx": 2,
  "packages/frontend/src/screens/security/settings/SecuritySettings.tsx": 2,
  "packages/frontend/src/screens/security/settings/editor.ts": 7,
  "packages/frontend/src/screens/setup/fields/ProjectFields.tsx": 4,
  "packages/frontend/src/screens/setup/fields/ProjectImageField.tsx": 1,
  "packages/frontend/src/screens/setup/fields/RewardAssetFields.tsx": 1,
  "packages/frontend/src/screens/setup/fields/SkillPreview.tsx": 1,
  "packages/frontend/src/screens/setup/proposal/ClosureConsent.tsx": 2,
  "packages/frontend/src/screens/setup/proposal/ContributionSettings.tsx": 3,
  "packages/frontend/src/screens/setup/proposal/FundingFields.tsx": 5,
  "packages/frontend/src/screens/setup/proposal/ProjectStep.tsx": 3,
  "packages/frontend/src/screens/setup/proposal/ProposalPage.tsx": 3,
  "packages/frontend/src/screens/setup/proposal/RepositoryChoice.tsx": 1,
  "packages/frontend/src/screens/setup/proposal/RepositoryPicker.tsx": 1,
  "packages/frontend/src/screens/setup/proposal/ReviewStep.tsx": 3,
  "packages/frontend/src/screens/setup/proposal/SetupSteps.tsx": 1,
  "packages/frontend/src/screens/setup/proposal/form.ts": 2,
  "packages/frontend/src/screens/setup/proposal/run.ts": 1,
  "packages/frontend/src/screens/setup/proposal/wizard.ts": 1,
  "packages/frontend/src/screens/setup/status/NewProjectPage.tsx": 1,
  "packages/frontend/src/screens/setup/status/PendingApplications.tsx": 2,
  "packages/frontend/src/screens/setup/status/ScanClearance.tsx": 2,
  "packages/frontend/src/screens/setup/status/SetupStatusPanel.tsx": 4,
  "packages/frontend/src/screens/setup/status/SetupSummary.tsx": 2,
  "packages/frontend/src/screens/setup/status/checks.ts": 4,
  "packages/frontend/src/screens/setup/status/funding.schema.ts": 1,
  "packages/frontend/src/screens/setup/update/ChangeReview.tsx": 4,
  "packages/frontend/src/screens/setup/update/IntegrationBranch.tsx": 4,
  "packages/frontend/src/screens/setup/update/ReadyLabelFields.tsx": 2,
  "packages/frontend/src/screens/setup/update/RemoveProject.tsx": 4,
  "packages/frontend/src/screens/setup/update/UpdateForm.tsx": 2,
  "packages/frontend/src/screens/setup/update/UpdatePage.tsx": 2,
  "packages/frontend/src/screens/setup/update/editStore.ts": 2,
  "packages/frontend/src/screens/setup/update/readyLabel.ts": 8,
  "packages/frontend/src/screens/setup/update/revision.ts": 9,
  "packages/platform/src/testing/paths.ts": 1,
  "packages/platform/test/spike/worker/routesCheck.vibe": 1,
  "packages/ui/.storybook/preview.ts": 1,
  "packages/ui/src/components/AccountMenu.meta.tsx": 2,
  "packages/ui/src/components/AccountMenu.tsx": 1,
  "packages/ui/src/components/Address.meta.tsx": 4,
  "packages/ui/src/components/Address.tsx": 1,
  "packages/ui/src/components/AgentMark.meta.tsx": 1,
  "packages/ui/src/components/Alert.meta.tsx": 1,
  "packages/ui/src/components/Avatar.meta.tsx": 1,
  "packages/ui/src/components/BarChart.meta.tsx": 1,
  "packages/ui/src/components/Button.meta.tsx": 5,
  "packages/ui/src/components/Card.meta.tsx": 3,
  "packages/ui/src/components/CommandBlock.meta.tsx": 1,
  "packages/ui/src/components/CompareChange.meta.tsx": 2,
  "packages/ui/src/components/ConfirmDialog.meta.tsx": 1,
  "packages/ui/src/components/CopyButton.meta.tsx": 2,
  "packages/ui/src/components/DataState.meta.tsx": 6,
  "packages/ui/src/components/Dialog.meta.tsx": 1,
  "packages/ui/src/components/Dialog.tsx": 1,
  "packages/ui/src/components/ExternalLink.meta.tsx": 3,
  "packages/ui/src/components/FileField.meta.tsx": 1,
  "packages/ui/src/components/Identity.meta.tsx": 3,
  "packages/ui/src/components/Label.meta.tsx": 1,
  "packages/ui/src/components/Leaderboard.meta.tsx": 1,
  "packages/ui/src/components/Leaderboard.tsx": 1,
  "packages/ui/src/components/ListItem.meta.tsx": 1,
  "packages/ui/src/components/Metric.meta.tsx": 1,
  "packages/ui/src/components/NetworkMark.meta.tsx": 1,
  "packages/ui/src/components/NotFound.meta.tsx": 2,
  "packages/ui/src/components/Pagination.meta.tsx": 3,
  "packages/ui/src/components/ProjectCard.meta.tsx": 3,
  "packages/ui/src/components/RadioGroup.meta.tsx": 2,
  "packages/ui/src/components/SegmentedControl.meta.tsx": 1,
  "packages/ui/src/components/SiteHeader.meta.tsx": 2,
  "packages/ui/src/components/Status.meta.tsx": 1,
  "packages/ui/src/components/Table.meta.tsx": 1,
  "packages/ui/src/lib/cn.ts": 7,
  "packages/ui/src/lib/control.ts": 1,
  "packages/ui/src/lib/exact.ts": 2,
  "packages/ui/src/lib/live.ts": 2,
  "packages/ui/src/lib/overlay.ts": 5,
  "packages/ui/src/lib/tone.ts": 1,
  "packages/ui/test/controls.browser.test.tsx": 12,
  "packages/ui/test/drivers/ui__confirmation.ts": 1,
  "packages/ui/test/drivers/ui__copy.ts": 1,
  "packages/ui/test/drivers/ui__pagination.ts": 1,
  "packages/ui/test/inventory.test.ts": 3,
  "packages/ui/test/ui.test.ts": 1,
  "packages/ui/vite.config.ts": 1,
  "packages/ui/vitest.config.ts": 1
}
const scheduled = {
  "apps/contributor/test/support/scripts/fixture.ts": 1,
  "apps/settlement/test/support/solana/program.ts": 1,
  "packages/contracts/test/drivers/contracts__solanaEscrow.ts": 1,
  "packages/contracts/test/support/solanaChain.ts": 1,
  "packages/frontend/test/support/ui/textSize.ts": 2,
  "packages/platform/src/testing/chains/anvil.ts": 1,
  "packages/platform/src/testing/chains/validator.ts": 1,
  "packages/ui/test/drivers/ui__confirmation.ts": 1,
}


// The tool reads Quint's JSON and the TypeScript compiler API as `any` at its boundaries; packages and apps stay strict.
const loose = Object.fromEntries(["no-explicit-any", "no-unsafe-argument", "no-unsafe-assignment", "no-unsafe-call", "no-unsafe-member-access", "no-unsafe-return"].map((rule) => [`@typescript-eslint/${rule}`, "off"]))

export default defineConfig(
  // Generated or disposable, and .claude/worktrees holds other checkouts of this repository.
  globalIgnores(["**/gen/", "!vibestack/gen/", "**/.vibe/", "**/dist/", "**/.cache/", "**/.spec-cache/", "**/generated/", "**/storybook-static/", "**/test/fixtures/", "apps/security/sandbox/.build/", "vibestack/examples/", "vibestack/fixtures/", ".claude/", ".lemmascript/", ".studio/", ".turbo/", "_apalache-out/", ...frozen]),
  { linterOptions: { reportUnusedDisableDirectives: "error", reportUnusedInlineConfigs: "error" } },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "package", pattern: ["packages/*", "apps/*"], capture: ["name"] },
        { type: "studio", pattern: "vibestack/studio" },
        { type: "tool", pattern: "vibestack" },
      ],
    },
    rules: {
      "no-restricted-imports": ["error", imports],
      // Signer custody is its own rule, so the stack rule's per-file variants above and below leave it in place.
      "@typescript-eslint/no-restricted-imports": ["error", signing],
      "no-restricted-properties": ["error", ...signs],
      // A relative path stays inside its package; the tool and Studio, which ships inside it, import each other.
      "boundaries/dependencies": ["error", {
        default: "disallow",
        policies: [
          { from: { element: { type: "package" } }, allow: { to: { element: { type: "package", captured: { name: "{{ from.element.captured.name }}" } } } } },
          { from: { element: { types: ["tool", "studio"] } }, allow: { to: { element: { types: ["tool", "studio"] } } } },
        ],
      }],
      // Nor does it reach a file outside every package and the tool.
      "boundaries/no-unknown-dependencies": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      // node:test runs what `test` and `describe` return; an async event listener is awaited by nobody by design.
      "@typescript-eslint/no-floating-promises": ["error", { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "describe", "it"] }] }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],
      // Regular expressions here match the tools' column-aligned output, where literal spaces read as the output does.
      "no-regex-spaces": "off",
      // AGENTS.md, "Writing code": one path, so nothing is left for later or kept beside its replacement.
      "no-warning-comments": ["error", { terms: ["todo", "fixme", "legacy", "deprecated"], location: "anywhere" }],
    },
  },
  { files: untyped, extends: [tseslint.configs.disableTypeChecked] },
  // A ratchet at today's longest (Studio's server); a test's describe block holds its cases.
  { ignores: ["**/test/**", "vibestack/selftest.ts"], rules: { "max-lines-per-function": ["error", { max: 250, skipBlankLines: true, skipComments: true }] } },
  {
    files: ["vibestack/**"],
    ignores: ["**/*.tsx"],
    rules: {
      ...loose,
      // `value!` after a check the compiler cannot follow is this code's style, also where a later TypeScript made it redundant.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      // `unknown | Promise<unknown>` and `Json | undefined` document intent although `unknown` and `any` absorb the rest.
      "@typescript-eslint/no-redundant-type-constituents": "off",
      // The TypeScript API compares masked flags: `(flags & NodeFlags.BlockScoped) === NodeFlags.Const`.
      "@typescript-eslint/no-unsafe-enum-comparison": "off",
      // Node types execFile's error as an intersection of Omit<>s, which the rule does not see is an Error.
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      // The compiler host's methods and a driver's functions are passed around as plain functions that use no `this`.
      "@typescript-eslint/unbound-method": "off",
      // Studio's DOM helpers stringify attribute values and children typed `unknown`.
      "@typescript-eslint/no-base-to-string": "off",
    },
  },
  // VibeLang's parser gives .vibe files typescript-eslint's tree without a program, so the rules that need types stay off: `vibelang --noEmit` checks them.
  { files: ["**/*.{vibe,vibex}"], extends: [tseslint.configs.disableTypeChecked], languageOptions: { parser: vibeParser, parserOptions: { projectService: false } }, rules: { "no-undef": "off" } },
  // React belongs to interfaces: the tools apart from Studio's page, and schemas, contracts, drivers and the shell everywhere, do without it.
  // @repo/ui's drivers are the exception: they mount its React components to check them against their specs.
  {
    files: ["vibestack/**", "**/*.{schema,contract}.ts", "**/test/drivers/**", "**/*.vibe"],
    ignores: ["vibestack/studio/src/page/**", "packages/ui/test/drivers/**"],
    rules: { "no-restricted-imports": ["error", noReact] },
  },
  // A key's own files may sign, but never reach the root poster's module; the poster's files are its own; tests and the
  // local-chain fakes sign as the wallets they play and never ship in a Worker bundle.
  { files: keys, ignores: poster, rules: { "@typescript-eslint/no-restricted-imports": ["error", { patterns: [{ regex: "(?:^|/)rootPoster", message: custody }] }], "no-restricted-properties": "off" } },
  { files: [...poster, "**/test/**", "packages/platform/src/testing/**"], rules: { "@typescript-eslint/no-restricted-imports": "off", "no-restricted-properties": "off" } },
  // eslint-plugin-react-hooks owns the rules both plugins ship; @eslint-react adds the rest.
  {
    files: ["**/*.tsx"],
    extends: [react.configs["recommended-type-checked"], reactHooks.configs.flat.recommended],
    rules: Object.fromEntries(Object.keys(reactHooks.rules).filter((rule) => `@eslint-react/${rule}` in react.configs["recommended-type-checked"].rules).map((rule) => [`@eslint-react/${rule}`, "off"])),
  },
  // vibestack/design/eslint.ts: token classes only, read from the theme `pnpm --filter @repo/design-system build` writes.
  {
    files: tsx,
    extends: [designSystem({ tailwind, tokens: parseTokens(JSON.parse(readFileSync(`${design}/tokens.json`, "utf8"))), entryPoint: `${import.meta.dirname}/${design}/generated/theme.css` })],
    settings: { "better-tailwindcss": { cwd: design } },
  },
  // @repo/ui holds the form controls and dialogs every interface uses.
  {
    files: tsx,
    ignores: ["packages/ui/**"],
    rules: {
      "no-restricted-globals": ["error", ...["alert", "confirm", "prompt"].map((name) => ({ name, message: "Use Dialog or Alert from @repo/ui." }))],
      "no-restricted-syntax": ["error", { selector: "JSXOpeningElement[name.name=/^(input|textarea)$/]", message: "Use Input, Textarea or Checkbox from @repo/ui." }],
    },
  },
  { files: own, ignores: ["**/*.{vibe,vibex}"], languageOptions: { parser: guarded(tseslint.parser) } },
  {
    files: ["{apps,packages}/**/*.{vibe,vibex}"],
    languageOptions: { parser: guarded(vibeParser) },
    rules: { "no-redeclare": "off", "code/redeclarations": "error" },
  },
  { files: own, plugins: { code }, rules: { "no-console": "error", "no-warning-comments": "off", "code/comments": ["error", { left: commented }], "code/effects": ["error", { left: scheduled }], "code/warningComments": "error" } },
  { files: ["packages/ui/src/components/**"], ignores: ["**/*.meta.tsx"], rules: { "code/comments": ["error", { jsdoc: true, left: commented }] } },
)

if (import.meta.main) {
  const { spawnSync } = await import("node:child_process")
  const { constants } = await import("node:os")
  const { default: process } = await import("node:process")
  const vibeFiles = "**/*.{vibe,vibex}"
  const groups = [
    ["packages/frontend"],
    ["packages/cli", "packages/contracts", "packages/design-system", "packages/platform", "packages/ports", "packages/ui"],
    ["apps/app", "apps/backend", "apps/contributor", "apps/fees", "apps/operations"],
    ["apps/points", "apps/security", "apps/settlement", "apps/slopbot"],
  ]
  const ignoreVibe = ["--ignore-pattern", vibeFiles]
  const ignoreGroups = groups.flat().flatMap((dir) => ["--ignore-pattern", `${dir}/`])
  const extra = process.argv.slice(2)
  const hasTarget = extra.some((arg) => !arg.startsWith("-"))
  const passes = extra.length
    ? [[...(hasTarget ? [] : ["."]), "--max-warnings", "0", ...extra]]
    : [
      [vibeFiles, "--no-error-on-unmatched-pattern", "--max-warnings", "0"],
      ...groups.map((group) => [...group, ...ignoreVibe, "--no-error-on-unmatched-pattern", "--max-warnings", "0"]),
      [".", ...ignoreVibe, ...ignoreGroups, "--max-warnings", "0"],
    ]
  let status = 0
  for (const args of passes) {
    const result = spawnSync("eslint", args, { stdio: "inherit" })
    if (result.error) throw result.error
    if (result.signal) {
      status = 128 + constants.signals[result.signal]
      break
    }
    status = Math.max(status, result.status ?? 2)
  }
  process.exitCode = status
}
