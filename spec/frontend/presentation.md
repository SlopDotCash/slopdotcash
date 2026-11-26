# Required product presentation

PRD sections 3, 4 and 7 preserve the existing product layout and controls.
These pure view contracts specify observable behavior for the future React
shell. They do not certify rendered accessibility or introduce a redesign.
The read lifecycle owns freshness and failures; this contract keeps the
contribution and reporting entry points usable independently of discovery.

## Story: Start contribution or private reporting when discovery is unavailable

### Home keeps distinct contribution and report entry points and generic agent setup

Current security offers appear before the project lists. Loading,
empty, stale or failed discovery never removes the generic agent setup.
Offer data comes from its own authorized public read; failure never invents an
offer. The section-order list specifies relative placement, not extra headings,
cards or controls. Home reads no Points summary and has no rankings section
(development `src/App.tsx` `HomePage` at `8660a6121`).

```quint
import requests as R from "./requests"
type HomeSection = ContributionEntry | PrivateReportEntry | SecurityOffers | ProjectList
pure val homeOrder = List(ContributionEntry, PrivateReportEntry, SecurityOffers, ProjectList)
pure def genericAgentSetupAvailable(discovery: R::ReadStatus, clearedProjects: int): bool = true
pure def contributionEntryAvailable(discovery: R::ReadStatus): bool = true
pure def privateReportEntryAvailable(discovery: R::ReadStatus): bool = true
pure def lawDiscoveryFailureKeepsEntryPoints(discovery: R::ReadStatus, clearedProjects: int): bool =
  genericAgentSetupAvailable(discovery, clearedProjects) and contributionEntryAvailable(discovery) and privateReportEntryAvailable(discovery)
pure def lawOffersPrecedeDiscovery(order: List[HomeSection]): bool =
  order == homeOrder implies order.nthOr(2, ProjectList) == SecurityOffers and order.nthOr(3, SecurityOffers) == ProjectList
    and order.length() == 4
```

### The campaign keeps one stable accessible heading and respects reduced motion

The visible campaign may type and delete in normal motion mode. Its accessible
heading remains stable through that animation. Reduced motion displays the
complete heading and disables typing and deletion. The persistent header stays
at viewport top while scrolling. The existing main landmark and keyboard
navigation remain, without restoring the removed Skip to content link.

The heading follows the Home journey (`campaignOf`, from `audienceOf`
below), as development decides it (`src/App.tsx` `HOME_AUDIENCES` and
`HeroHeading` at `67fd54fd4`, settling owner decision frontend-ui:OD1). The
Contributor journey shows the lead "MAKE MONEY" and types and deletes four
rotating actions ("SHIPPING OPEN SOURCE.", "SECURING THE WEB.", "HACKING THE
PLANET.", "BUILDING AGI."), with the accessible heading "MAKE MONEY SHIPPING
OPEN SOURCE."; the Maintainer journey shows the lead "SHIP FASTER." with the
one action "WITH CONTRIBUTORS.", accessible heading "SHIP FASTER. WITH
CONTRIBUTORS.". Each holds 2 400 ms, types 55 ms and deletes 30 ms per
character, with 220 ms between actions, and a change of journey restarts the
campaign from its first action. Either keeps its stable accessible name and
the static heading under reduced motion.

```quint
type Motion = NormalMotion | ReducedMotion
pure def campaignAnimationEnabled(motion: Motion): bool = motion == NormalMotion
pure def campaignVisibleText(motion: Motion, completeHeading: str, animatedText: str): str =
  if (motion == ReducedMotion) completeHeading else animatedText
pure def campaignAccessibleHeading(completeHeading: str, animatedText: str): str = completeHeading
pure def headerViewportTop(scrollOffset: int): int = 0
type Campaign = { lead: str, accessibleHeading: str, actions: List[str] }
pure val heroHoldMs = 2400
pure val heroTypeMs = 55
pure val heroDeleteMs = 30
pure val heroGapMs = 220
pure def campaignOf(journey: HomeAudience): Campaign =
  if (journey == Maintainer) { lead: "SHIP FASTER.", accessibleHeading: "SHIP FASTER. WITH CONTRIBUTORS.",
    actions: List("WITH CONTRIBUTORS.") }
  else { lead: "MAKE MONEY", accessibleHeading: "MAKE MONEY SHIPPING OPEN SOURCE.",
    actions: List("SHIPPING OPEN SOURCE.", "SECURING THE WEB.", "HACKING THE PLANET.", "BUILDING AGI.") }
pure val mainLandmarkAvailable = true
pure val skipToContentLinkAvailable = false
pure def lawReducedMotionShowsCompleteHeading(heading: str, animatedText: str): bool =
  not(campaignAnimationEnabled(ReducedMotion)) and campaignVisibleText(ReducedMotion, heading, animatedText) == heading
pure def lawAccessibleHeadingIsStable(heading: str, firstFrame: str, secondFrame: str): bool =
  campaignAccessibleHeading(heading, firstFrame) == campaignAccessibleHeading(heading, secondFrame)
pure def lawHeaderStaysAtTop(scrollOffset: int): bool = headerViewportTop(scrollOffset) == 0
```

## Story: Find account controls on their existing separate pages

### Settings keeps wallet and email controls expanded without account navigation tabs

Settings, Payouts and Inbox are separate account-menu destinations. Wallet
management and email preferences stay expanded in Settings. Payouts links to
wallet management when needed and existing wallet deep links still resolve.
Recovery, closure and account appeal stay outside Settings. Contributor
profiles have no payout-wallet shortcut. Do not restore the session list,
Connections card or Security card. The Activity email switch has no outer
button border. Layout observations must be checked in the real browser.

```quint
type AccountLayout = { separatePages: bool, sharedAccountTabs: bool,
  walletExpanded: bool, emailExpanded: bool, payoutsWalletLink: bool,
  walletDeepLinks: bool, recoveryInSettings: bool, closureInSettings: bool,
  appealInSettings: bool, profileWalletShortcut: bool, sessionList: bool,
  connectionsCard: bool, securityCard: bool, activityOuterBorder: bool }
pure def acceptedAccountLayout(layout: AccountLayout): bool =
  layout.separatePages and not(layout.sharedAccountTabs) and layout.walletExpanded and
  layout.emailExpanded and layout.payoutsWalletLink and layout.walletDeepLinks and
  not(layout.recoveryInSettings) and not(layout.closureInSettings) and not(layout.appealInSettings) and
  not(layout.profileWalletShortcut) and not(layout.sessionList) and not(layout.connectionsCard) and
  not(layout.securityCard) and not(layout.activityOuterBorder)
pure def lawSettingsControlsStayVisible(layout: AccountLayout): bool =
  acceptedAccountLayout(layout) implies layout.walletExpanded and layout.emailExpanded
pure def lawNoUnapprovedAccountControls(layout: AccountLayout): bool =
  acceptedAccountLayout(layout) implies not(layout.sharedAccountTabs) and not(layout.recoveryInSettings) and
    not(layout.closureInSettings) and not(layout.appealInSettings) and not(layout.profileWalletShortcut) and
    not(layout.sessionList) and not(layout.connectionsCard) and not(layout.securityCard)
pure val layoutValues = Set(
  { separatePages: true, sharedAccountTabs: false, walletExpanded: true, emailExpanded: true,
    payoutsWalletLink: true, walletDeepLinks: true, recoveryInSettings: false, closureInSettings: false,
    appealInSettings: false, profileWalletShortcut: false, sessionList: false, connectionsCard: false,
    securityCard: false, activityOuterBorder: false },
  { separatePages: true, sharedAccountTabs: true, walletExpanded: false, emailExpanded: false,
    payoutsWalletLink: false, walletDeepLinks: false, recoveryInSettings: true, closureInSettings: true,
    appealInSettings: true, profileWalletShortcut: true, sessionList: true, connectionsCard: true,
    securityCard: true, activityOuterBorder: true }
)
pure val headingValues = Set("MAKE MONEY SHIPPING OPEN SOURCE.", "SHIP FASTER. WITH CONTRIBUTORS.")
pure val completeHeadingValues = headingValues
pure val animatedTextValues = Set("", "MAKE MONEY SHIP", "MAKE MONEY SHIPPING OPEN SOURCE.")
pure val firstFrameValues = Set("", "MAKE MONEY SHIP")
pure val secondFrameValues = Set("MAKE MONEY SHIP", "MAKE MONEY SHIPPING OPEN SOURCE.")
pure val orderValues = Set(homeOrder, List(ProjectList, SecurityOffers))
pure val clearedProjectsValues = Set(0, 1, 2)
pure val scrollOffsetValues = Set(0, 1, 1000)
```

## Story: Complete project setup with explicit independent readiness

### Setup presents Project, Rewards and Review with both skill previews

The repository step offers the user's public-repository picker and URL entry
for another public repository, then loads the selected repository facts.
Project setup previews the public page and both generated skills. Rewards
presents the approved monthly pool or private-bounty choice and its terms;
it never adds a second review pool for a new project. A monthly pool also
offers "Promise this amount on the honor system" ([projections](./projections.md),
`promiseWarning`): setup and settings start it unchecked, and a project
saved without it reads unchecked; it can be checked only with a positive
amount, and a checked promise can always be unchecked; leaving the monthly
pool clears it. The review shows "Honor system (not vaulted or guaranteed)"
in place of "Pledge", and settings list an "Honor-system promise" On/Off
change (development `src/ProjectProposalPage.tsx` at `67fd54fd4`). Existing historical
review commitments retain their terms. A custom image falls back to the
GitHub owner avatar and never uses a social-preview image.

Review also offers the submission fee, wanted issues and the private report
deposit, each starting checked for a new project, while Slopbot's automatic
closure consent starts unchecked and a project saved without it reads
unchecked ([closure consent](../backend/closureConsent.md),
`defaultNewDraft`; the owner's decision of 13 November 2026 overrides
development's checked default). A listing that is only a security program
takes no contributions, so it publishes no closure consent, submission fee
or wanted issues, and keeps the report deposit. Settings add the intake cap,
empty (off) or a whole number from 1 to 500 ([intake cap](../backend/intakeCap.md)),
and, for a monthly pool, the maintainer share, empty or a whole percent from
0 to 30, where 0 is none ([maintainer share](../settlement/maintainerShare.md)).
An invalid entry shows its error, blocks Publish and keeps the published
value until it is corrected. Each changed row says what publishing it does:
the vault, the monthly amount and the maintainer share take effect next
month; the Slopbot settings, the report deposit, the image, headline,
description and integration branch are live at once; any other change is
live for a cleared project and otherwise needs a rescan. An integration
branch change is refused beside any other change except the contribution
section, its guide, scope and skill rules ("Save the other settings before changing the integration branch.")
(development `src/ProjectProposalPage.tsx:187–220,1657–1676,2463–2510,2990–3020,3182–3198,3600–3615`
at `8660a6121`).

```quint
import closureConsent as CC from "../backend/closureConsent"
import intakeCap as IC from "../backend/intakeCap"
import maintainerShare as MS from "../settlement/maintainerShare"
type SetupPresentation = { projectStep: bool, rewardsStep: bool, reviewStep: bool,
  publicRepositoryPicker: bool, repositoryUrlEntry: bool, selectedFactsLoaded: bool,
  publicPreview: bool, contributorSkillPreview: bool, reviewerSkillPreview: bool,
  monthlyPoolChoice: bool, privateBountyChoice: bool, secondReviewPool: bool,
  grossAwardVisible: bool, researcherShareVisible: bool, slopShareVisible: bool,
  privateReportTermsVisible: bool, honorSystemOption: bool }
pure val honorSystemDefault = false
pure def honorSystemEditable(amountPositive: bool, checked: bool): bool = amountPositive or checked
pure def honorSystemKept(monthlyPool: bool, checked: bool): bool = monthlyPool and checked
pure def lawHonorSystemStartsOff(monthlyPool: bool): bool = not(honorSystemKept(monthlyPool, honorSystemDefault))
pure def lawCheckedPromiseCanAlwaysBeWithdrawn(amountPositive: bool): bool = honorSystemEditable(amountPositive, true)
pure def lawLeavingTheMonthlyPoolClearsThePromise(checked: bool): bool = not(honorSystemKept(false, checked))
pure def acceptedSetupPresentation(view: SetupPresentation): bool =
  view.projectStep and view.rewardsStep and view.reviewStep and view.publicRepositoryPicker and
  view.repositoryUrlEntry and view.selectedFactsLoaded and view.publicPreview and
  view.contributorSkillPreview and view.reviewerSkillPreview and view.monthlyPoolChoice and
  view.privateBountyChoice and not(view.secondReviewPool) and view.grossAwardVisible and
  view.researcherShareVisible and view.slopShareVisible and view.privateReportTermsVisible and view.honorSystemOption
pure def projectImage(customImage: str, ownerAvatar: str): str =
  if (customImage != "") customImage else ownerAvatar
pure def lawImageFallback(ownerAvatar: str): bool = projectImage("", ownerAvatar) == ownerAvatar
pure def lawNoSecondReviewPool(view: SetupPresentation): bool = acceptedSetupPresentation(view) implies not(view.secondReviewPool)
type ListingChoices = { closureConsent: bool, submissionFee: bool, wantedIssues: bool, reportDeposit: bool }
type SettingEntry = EntryEmpty | EntryWhole({ whole: int }) | EntryInvalid
type SettingField = VaultField | MonthlyField | MaintainerShareField | SlopbotField | ReportDepositField | ImageField
  | HeadlineField | DescriptionField | IntegrationBranchField | ContributionGuideField | OtherField
type SettingEffect = LiveNow | NextMonth | NeedsRescan
pure val submissionFeeDefault = true
pure val wantedIssuesDefault = true
pure val reportDepositDefault = true
pure val newChoices: ListingChoices = { closureConsent: CC::defaultNewDraft, submissionFee: submissionFeeDefault,
  wantedIssues: wantedIssuesDefault, reportDeposit: reportDepositDefault }
pure val branchConflictText = "Save the other settings before changing the integration branch."
pure def publishedChoices(bountyOnly: bool, choices: ListingChoices): ListingChoices =
  val consent = CC::consents(CC::newProjectConsent(if (bountyOnly) CC::BountyOnly else CC::OrdinarySetup, choices.closureConsent))
  if (bountyOnly) { closureConsent: consent, submissionFee: false, wantedIssues: false, reportDeposit: choices.reportDeposit }
  else { ...choices, closureConsent: consent }
pure def intakeCapEntryValid(entry: SettingEntry): bool =
  match entry { | EntryEmpty => true | EntryWhole(e) => e.whole >= IC::minCap and e.whole <= IC::maxCap | _ => false }
pure def shareEntryValid(entry: SettingEntry): bool =
  match entry { | EntryEmpty => true | EntryWhole(e) => e.whole >= 0 and e.whole * 100 <= MS::maxShareBasisPoints | _ => false }
pure def entryNumber(entry: SettingEntry): int = match entry { | EntryWhole(e) => e.whole | _ => 0 }
pure def entryOrPublished(valid: bool, entered: int, published: int): int = if (valid) entered else published
pure def lawShareEntryAtMostThirtyPercent(entry: SettingEntry): bool =
  shareEntryValid(entry) implies entryNumber(entry) * 100 <= MS::maxShareBasisPoints
pure def lawIntakeCapEntryWithinLimits(entry: SettingEntry): bool =
  (intakeCapEntryValid(entry) and entry != EntryEmpty) implies (entryNumber(entry) >= IC::minCap and entryNumber(entry) <= IC::maxCap)
pure def changeEffect(settingField: SettingField, cleared: bool): SettingEffect =
  if (settingField == VaultField or settingField == MonthlyField or settingField == MaintainerShareField) NextMonth
  else if (settingField == SlopbotField or settingField == ReportDepositField or settingField == ImageField or settingField == HeadlineField
    or settingField == DescriptionField or settingField == IntegrationBranchField or cleared) LiveNow
  else NeedsRescan
pure def branchChangeAllowed(branchChanged: bool, others: List[SettingField]): bool =
  not(branchChanged) or others.every(f => f == ContributionGuideField)
pure def lawNewSettingsStartOn(bountyOnly: bool): bool =
  newChoices.submissionFee and newChoices.wantedIssues and newChoices.reportDeposit and not(newChoices.closureConsent)
    and publishedChoices(bountyOnly, newChoices).reportDeposit
pure def lawBountyOnlyTakesNoFee(choices: ListingChoices): bool =
  val listed = publishedChoices(true, choices)
  not(listed.closureConsent) and not(listed.submissionFee) and not(listed.wantedIssues)
    and listed.reportDeposit == choices.reportDeposit
pure def lawInvalidEntryKeepsPublished(entered: int, published: int): bool = entryOrPublished(false, entered, published) == published
pure def lawBranchChangeStandsAlone(others: List[SettingField]): bool =
  branchChangeAllowed(true, others) iff others.every(f => f == ContributionGuideField)
pure def lawShareChangesNextMonth(cleared: bool): bool = changeEffect(MaintainerShareField, cleared) == NextMonth
pure val choicesValues = Set(newChoices, { closureConsent: true, submissionFee: false, wantedIssues: true, reportDeposit: false })
pure val entryValues = Set(EntryEmpty, EntryInvalid, EntryWhole({ whole: 0 }), EntryWhole({ whole: 30 }), EntryWhole({ whole: 31 }),
  EntryWhole({ whole: 500 }), EntryWhole({ whole: 501 }))
pure val othersValues = Set(List(), List(ContributionGuideField), List(ContributionGuideField, HeadlineField))
pure val enteredValues = Set(0, 20)
pure val publishedValues = Set(10)
```

### Setup readiness shows authority, Slopbot, security and funding separately

A single summary shows each result and its next action. Funding is optional
for project activation. Unavailable or incomplete authority, installation or
security evidence cannot be presented as ready. Required project fields and
license evidence are checked by the backend's setup rules before publication.

```quint
type SetupStatus = SetupMissing | SetupChecking | SetupReady | SetupRefused | SetupUnavailable
type SetupAction = ResolveAuthority | InstallSlopbot | ResolveSecurity | ReviewAndPublish
type SetupSummary = { authority: SetupStatus, slopbot: SetupStatus, security: SetupStatus, funding: SetupStatus }
pure def setupNextAction(summary: SetupSummary): SetupAction =
  if (summary.authority != SetupReady) ResolveAuthority
  else if (summary.slopbot != SetupReady) InstallSlopbot
  else if (summary.security != SetupReady) ResolveSecurity
  else ReviewAndPublish
pure def lawFundingDoesNotBlockSetup(summary: SetupSummary): bool =
  summary.authority == SetupReady and summary.slopbot == SetupReady and summary.security == SetupReady
    implies setupNextAction(summary) == ReviewAndPublish
pure def lawMissingAuthorityRefusesReady(summary: SetupSummary): bool =
  summary.authority != SetupReady implies setupNextAction(summary) == ResolveAuthority
pure val summaryValues = Set(
  { authority: SetupReady, slopbot: SetupReady, security: SetupReady, funding: SetupMissing },
  { authority: SetupReady, slopbot: SetupReady, security: SetupReady, funding: SetupReady },
  { authority: SetupUnavailable, slopbot: SetupReady, security: SetupReady, funding: SetupReady },
  { authority: SetupReady, slopbot: SetupMissing, security: SetupReady, funding: SetupReady },
  { authority: SetupReady, slopbot: SetupReady, security: SetupRefused, funding: SetupReady }
)
pure val viewValues = Set(
  { projectStep: true, rewardsStep: true, reviewStep: true, publicRepositoryPicker: true,
    repositoryUrlEntry: true, selectedFactsLoaded: true, publicPreview: true,
    contributorSkillPreview: true, reviewerSkillPreview: true, monthlyPoolChoice: true,
    privateBountyChoice: true, secondReviewPool: false, grossAwardVisible: true,
    researcherShareVisible: true, slopShareVisible: true, privateReportTermsVisible: true, honorSystemOption: true }
)
pure val customImageValues = Set("", "custom-image")
pure val ownerAvatarValues = Set("owner-avatar")
```

## Story: Use the approved page-view beacon without exposing private navigation

### Only production slop.cash loads the approved first-party Cloudflare beacon

PRD section 9 approves Cloudflare Web Analytics solely for path and referring-site
page views. The production Pages Function adds that same beacon where automatic
injection is unavailable. Staging, local development and tests never load it.
It uses neither cookies nor local storage and sends no query strings. Transport
stays on the site's own origin. Private Inbox, case and administration query
parameters cannot enter the payload. No other third-party script or analytics
provider is authorized by this contract.

```quint
type SiteEnvironment = Production | Staging | Local | Test
type BeaconEvidence = { cloudflareWebAnalytics: bool, sameOrigin: bool,
  cookies: bool, localStorage: bool, queryStrings: bool, pathAndReferringSiteOnly: bool }
pure def analyticsMayLoad(environment: SiteEnvironment, host: str, evidence: BeaconEvidence): bool =
  environment == Production and host == "slop.cash" and evidence.cloudflareWebAnalytics and
  evidence.sameOrigin and not(evidence.cookies) and not(evidence.localStorage) and
  not(evidence.queryStrings) and evidence.pathAndReferringSiteOnly
pure def lawNonproductionHasNoBeacon(environment: SiteEnvironment, host: str, evidence: BeaconEvidence): bool =
  environment != Production implies not(analyticsMayLoad(environment, host, evidence))
pure def lawBeaconRequiresPrivateNavigationOmitted(environment: SiteEnvironment, host: str, evidence: BeaconEvidence): bool =
  analyticsMayLoad(environment, host, evidence) implies host == "slop.cash" and
    not(evidence.cookies) and not(evidence.localStorage) and not(evidence.queryStrings) and
    evidence.sameOrigin and evidence.pathAndReferringSiteOnly
```

### A blocked or failed beacon cannot block the page or its actions

Analytics is an optional independent side effect. No data load, private action,
contribution, report, consent or payment state depends on its completion.

```quint
type BeaconStatus = BeaconNotRequested | BeaconLoading | BeaconBlocked | BeaconFailed | BeaconComplete
pure def pageMayProceed(beacon: BeaconStatus): bool = true
pure def lawBeaconNeverBlocksPage(beacon: BeaconStatus): bool = pageMayProceed(beacon)
pure val hostValues = Set("slop.cash", "slop.tech", "localhost", "staging.slop.cash")
pure val evidenceValues = Set(
  { cloudflareWebAnalytics: true, sameOrigin: true, cookies: false, localStorage: false,
    queryStrings: false, pathAndReferringSiteOnly: true },
  { cloudflareWebAnalytics: false, sameOrigin: false, cookies: true, localStorage: true,
    queryStrings: true, pathAndReferringSiteOnly: false }
)
```

## Story: Read token tickers without mistaking them for a dollar valuation

### Project tokens have one dollar prefix while native and approved stablecoin tickers have none

PRD section 6 changes displayed ticker notation only. Asset classification
comes from the verified registry and token identity, never from a symbol's
spelling. The adapter decodes the canonical stored symbol into its count of
leading dollar signs and its remaining Unicode characters. It verifies that
this is an exact decomposition, each list entry is one character, and the body
is nonempty and no longer starts with a dollar sign. The model uses this decoded
representation because the supported Quint subset does not split strings.
Rendering joins the returned prefix and body characters; it never writes them
back to the canonical symbol. Invalid decoding produces no ticker.

```quint
type TickerKind = NativeCoin | ApprovedStablecoin | ProjectToken
type DecodedTicker = { canonicalSymbol: str, leadingDollars: int, body: List[str] }
type TickerView = { available: bool, canonicalSymbol: str, prefixDollars: int, body: List[str], usdValuation: bool }
pure def validTicker(symbol: DecodedTicker): bool = symbol.canonicalSymbol != "" and
  symbol.leadingDollars >= 0 and symbol.body.length() > 0 and
  symbol.body.nthOr(0, "") != "$" and symbol.body.every(character => character != "")
pure def displayTicker(kind: TickerKind, symbol: DecodedTicker): TickerView = {
  available: validTicker(symbol), canonicalSymbol: symbol.canonicalSymbol,
  prefixDollars: if (validTicker(symbol) and kind == ProjectToken) 1 else 0,
  body: if (validTicker(symbol)) symbol.body else List(), usdValuation: false
}
pure def lawProjectTokenHasOnePrefix(symbol: DecodedTicker): bool =
  validTicker(symbol) implies displayTicker(ProjectToken, symbol).available and
    displayTicker(ProjectToken, symbol).prefixDollars == 1 and
    displayTicker(ProjectToken, symbol).body.nthOr(0, "") != "$"
pure def lawNativeAndStablecoinHaveNoPrefix(kind: TickerKind, symbol: DecodedTicker): bool =
  (kind == NativeCoin or kind == ApprovedStablecoin) implies displayTicker(kind, symbol).prefixDollars == 0
pure def lawCanonicalTickerIsUnchanged(kind: TickerKind, symbol: DecodedTicker): bool =
  displayTicker(kind, symbol).canonicalSymbol == symbol.canonicalSymbol and
    (validTicker(symbol) implies displayTicker(kind, symbol).body == symbol.body)
pure def lawTickerIsNotUsdValuation(kind: TickerKind, symbol: DecodedTicker): bool =
  not(displayTicker(kind, symbol).usdValuation)
pure def lawInvalidTickerIsUnavailable(kind: TickerKind, symbol: DecodedTicker): bool =
  not(validTicker(symbol)) implies not(displayTicker(kind, symbol).available) and
    displayTicker(kind, symbol).prefixDollars == 0 and displayTicker(kind, symbol).body.length() == 0
pure val symbolValues = Set(
  { canonicalSymbol: "CREDIT", leadingDollars: 0, body: List("C", "R", "E", "D", "I", "T") },
  { canonicalSymbol: "$$EPYH", leadingDollars: 2, body: List("E", "P", "Y", "H") },
  { canonicalSymbol: "SOL", leadingDollars: 0, body: List("S", "O", "L") },
  { canonicalSymbol: "ETH", leadingDollars: 0, body: List("E", "T", "H") },
  { canonicalSymbol: "USDC", leadingDollars: 0, body: List("U", "S", "D", "C") },
  { canonicalSymbol: "USDG", leadingDollars: 0, body: List("U", "S", "D", "G") },
  { canonicalSymbol: "", leadingDollars: 0, body: List() },
  { canonicalSymbol: "$$", leadingDollars: 1, body: List("$") }
)
```

Ticker notation does not alter integer amounts, asset identity, reward terms,
or the existing formatting of dollar-denominated amounts. A prefix does not
supply an exchange rate or a USD equivalent.

## Story: Read exact amounts in their own asset

> As a contributor, sponsor or project owner, I want every amount shown
> exactly as the base units it records, in its asset's decimals, so that
> what I read is what is owed or paid.

### Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros

An amount is canonical integer base units and its asset's decimals, from 0 to
36 (six when the registry names no asset). The text is the whole part with
comma groups of three digits, then, when the remainder is not zero, a point
and the remainder padded to the decimals with its trailing zeros removed. The
formatter works on big integers and never on floating point; its reverse
parses whole and fraction digits and refuses more fraction digits than the
asset has. The model below states the same arithmetic over integers;
the hand-written formatter carries it as a `//@` contract on its round trip.
Grouping is a rendering of the whole part. Project cards may abbreviate a
token pool or a bounty amount in compact notation (at most two fraction
digits); a page where an amount is reviewed, signed or paid always shows the
exact text.

```quint
type ShownAmount = { whole: int, fraction: int, fractionDigits: int }
pure val decimalPlaces = List(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36)
pure def tenTo(power: int): int = decimalPlaces.foldl(1, (product, place) => if (place < power) product * 10 else product)
pure def validDecimals(decimals: int): bool = decimals >= 0 and decimals <= 36
pure def scaledDown(n: int, power: int): int = if (tenTo(power) > 0) n / tenTo(power) else 0
pure def belowScale(n: int, power: int): int = if (tenTo(power) > 0) n % tenTo(power) else 0
pure def trailingZeros(remainder: int, decimals: int): int =
  if (remainder == 0) decimals
  else decimalPlaces.foldl(0, (zeros, place) =>
    if (place <= decimals and belowScale(remainder, place) == 0) place else zeros)
pure def showAmount(units: int, decimals: int): ShownAmount =
  val remainder = belowScale(units, decimals)
  val zeros = trailingZeros(remainder, decimals)
  { whole: scaledDown(units, decimals), fraction: scaledDown(remainder, zeros), fractionDigits: decimals - zeros }
pure def lawShownAmountRoundTrips(units: int, decimals: int): bool =
  (units >= 0 and validDecimals(decimals)) implies
    showAmount(units, decimals).whole * tenTo(decimals) +
      showAmount(units, decimals).fraction * tenTo(decimals - showAmount(units, decimals).fractionDigits) == units
pure def lawNoTrailingFractionZero(units: int, decimals: int): bool =
  (units >= 0 and validDecimals(decimals) and showAmount(units, decimals).fractionDigits > 0)
    implies showAmount(units, decimals).fraction % 10 != 0
pure def lawWholeAmountHasNoFraction(units: int, decimals: int): bool =
  (units >= 0 and validDecimals(decimals) and belowScale(units, decimals) == 0)
    implies showAmount(units, decimals).fractionDigits == 0
pure val unitsValues = Set(0, 1, 10, 1500000, 1234567, 100000000)
pure val decimalsValues = Set(0, 2, 6)
```

## Story: See the site under the name it was reached by

> As a visitor who came through slop.tech, I want the site to name slop.tech
> wherever it names its own domain.

### The wordmark and footer domain follow the serving host

The shell lowercases the host name and removes one trailing dot. `slop.tech`
and `www.slop.tech` are shown as slop.tech; every other host, including
staging and local hosts, as slop.cash. The production Pages Function applies
the same choice to the social metadata of each HTML response (canonical
origin, site name and `og-slop-tech.png` or `og-slop-cash.png`), adds
`no-transform` to its cache control and varies on the host; that code is
carried byte for byte.

```quint
type PublicDomain = SlopCash | SlopTech
pure def publicDomain(normalizedHost: str): PublicDomain =
  if (normalizedHost == "slop.tech" or normalizedHost == "www.slop.tech") SlopTech else SlopCash
pure def lawOnlyTechHostsShowTech(normalizedHost: str): bool =
  publicDomain(normalizedHost) == SlopTech iff Set("slop.tech", "www.slop.tech").contains(normalizedHost)
pure val normalizedHostValues = Set("slop.cash", "slop.tech", "www.slop.tech", "localhost", "staging.slop.cash")
```

## Story: Hand the contribution prompt to an agent

> As a contributor, I want to open the prompt in the agent I use, or copy it
> for any other agent.

### Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt

Beside the prompt and its Copy button ("Copy", "Copied", or "Select text" when
the clipboard refuses), "Open in" offers desktop agent shortcuts aligned with
`lalalune/agent-deeplinks`: Claude Code, Codex, Cursor, Antigravity, OpenClaw,
Hermes Agent, GitHub Copilot, Grok Bot, Meta Muse and OpenCode. Claude Code,
Codex, Cursor (double-encoded to preserve literal `+` and percent escapes),
Antigravity, OpenClaw (up to its 240-grapheme limit, falling back to its
dashboard launch), GitHub Copilot and Grok Bot open their native desktop app
schemes with the prompt in the same tab. Hermes Agent opens its confirmed
desktop skill install (`hermes://skill/install`) for the page's skill address
in the same tab: on Home the selected journey's (`/contribute/SKILL.md` or
`/maintain/SKILL.md`, below), on a cleared project page that project's
`/projects/<slug>/SKILL.md`, and on uncleared project and security bounty pages
this site's `/SKILL.md`. Meta Muse opens its desktop Universal Link handoff
(`https://agent.meta.ai/chat`) in a new tab without a referrer, and OpenCode
launches its desktop app (`opencode://`) in the same tab; neither carries a
prompt parameter. Opening any shortcut also copies the prompt to the clipboard.
One concise note under the row states that a desktop coding agent with a
terminal and the GitHub CLI is required. Any provider, model and agent client
may participate, so the list is never exclusive: the generic prompt and copy
stay available whatever the list holds.

```quint
type AgentTarget = DesktopHandoff | AppScheme
type AgentPayload = PromptPayload | SkillPayload | LaunchOnly
type AgentShortcut = { agent: str, target: AgentTarget, payload: AgentPayload }
pure val agentShortcuts = List(
  { agent: "Claude Code", target: AppScheme, payload: PromptPayload },
  { agent: "Codex", target: AppScheme, payload: PromptPayload },
  { agent: "Cursor", target: AppScheme, payload: PromptPayload },
  { agent: "Antigravity", target: AppScheme, payload: PromptPayload },
  { agent: "OpenClaw", target: AppScheme, payload: PromptPayload },
  { agent: "Hermes Agent", target: AppScheme, payload: SkillPayload },
  { agent: "GitHub Copilot", target: AppScheme, payload: PromptPayload },
  { agent: "Grok Bot", target: AppScheme, payload: PromptPayload },
  { agent: "Meta Muse", target: DesktopHandoff, payload: LaunchOnly },
  { agent: "OpenCode", target: AppScheme, payload: LaunchOnly })
pure val siteSkillPath = "/SKILL.md"
pure def shortcutSkillPath(onHome: bool, journey: HomeAudience, projectSkillPath: str): str =
  if (onHome) skillPath(journey) else if (projectSkillPath != "") projectSkillPath else siteSkillPath
pure def opensNewTab(shortcut: AgentShortcut): bool = shortcut.target == DesktopHandoff
pure def openingCopiesPrompt(shortcut: AgentShortcut): bool = true
pure def genericPromptAvailable(shortcuts: List[AgentShortcut]): bool = true
pure def lawOpeningAnyShortcutCopies(shortcut: AgentShortcut): bool = openingCopiesPrompt(shortcut)
pure def lawShortcutsNeverReplaceGenericSetup(shortcuts: List[AgentShortcut]): bool = genericPromptAvailable(shortcuts)
pure def lawOnlyDesktopHandoffsOpenNewTabs(shortcut: AgentShortcut): bool = opensNewTab(shortcut) iff shortcut.target == DesktopHandoff
pure val shortcutValues = Set(
  { agent: "Claude Code", target: AppScheme, payload: PromptPayload },
  { agent: "Hermes Agent", target: AppScheme, payload: SkillPayload },
  { agent: "Meta Muse", target: DesktopHandoff, payload: LaunchOnly })
pure val shortcutsValues = Set(List(), agentShortcuts)
```

## Story: Choose the contributor or maintainer journey on Home

> As a visitor, I want to say whether I contribute or maintain, so that the
> heading, the prompt and every agent shortcut lead to the right skill.

### Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent's skill address together

The journey comes from the `audience` query parameter alone: "maintainer" is
the Maintainer journey, and an absent or any other value is the Contributor
journey. The switch (a group labelled "Choose your Slop journey" of two
pressed-state buttons, "Contributor" and "Maintainer") pushes one history
entry, dropping forward entries, that sets `audience=maintainer` or removes
the parameter, keeping every other query parameter and the fragment; it
stores nothing. Choosing the journey already shown does nothing. The
heading (`campaignOf`), the prompt ("Read <origin><skill path> and follow
it.", under "Paste into your agent.") and every agent shortcut's skill
address derive from the journey alone, so back, forward and reload restore
all three together. A change resets the copy feedback, discards a pending
copy result of the old prompt and restarts the campaign. The direct "Add a
project" route and the shared sections stay (development `src/App.tsx`
`HomePage`, `formal/models/ui/ui_home_audience.qnt` and
`tests/e2e/home-audience.spec.ts` at `67fd54fd4`).

```quint
type HomeAudience = Contributor | Maintainer
type CopyFeedback = CopyIdle | CopyCopied | CopySelectText
pure val maintainerQuery = "maintainer"
pure def audienceOf(query: str): HomeAudience = if (query == maintainerQuery) Maintainer else Contributor
pure def audienceQuery(journey: HomeAudience): str = if (journey == Maintainer) maintainerQuery else ""
pure def skillPath(journey: HomeAudience): str = if (journey == Maintainer) "/maintain/SKILL.md" else "/contribute/SKILL.md"
pure def audienceChanges(shown: HomeAudience, chosen: HomeAudience): bool = shown != chosen
pure def feedbackAfterChoice(shown: HomeAudience, chosen: HomeAudience, feedback: CopyFeedback): CopyFeedback =
  if (audienceChanges(shown, chosen)) CopyIdle else feedback
pure def lawPromptAndLauncherFollowTheAudience(query: str): bool =
  skillPath(audienceOf(query)) == skillPath(audienceOf(audienceQuery(audienceOf(query))))
    and campaignOf(audienceOf(query)) == campaignOf(audienceOf(audienceQuery(audienceOf(query))))
pure def lawUnknownAudienceIsContributor(query: str): bool = query != maintainerQuery implies audienceOf(query) == Contributor
pure def lawSwitchResetsFeedback(shown: HomeAudience, chosen: HomeAudience, feedback: CopyFeedback): bool =
  shown != chosen implies feedbackAfterChoice(shown, chosen, feedback) == CopyIdle
pure def lawChoosingTheShownJourneyDoesNothing(shown: HomeAudience, feedback: CopyFeedback): bool =
  feedbackAfterChoice(shown, shown, feedback) == feedback
pure val queryValues = Set("", "maintainer", "contributor", "invalid")
```
