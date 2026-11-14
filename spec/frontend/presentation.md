# Required product presentation

PRD sections 3, 4 and 7 preserve the existing product layout and controls.
These pure view contracts specify observable behavior for the future React
shell. They do not certify rendered accessibility or introduce a redesign.
The read lifecycle owns freshness and failures; this contract keeps the
contribution and reporting entry points usable independently of discovery.

## Story: Start contribution or private reporting when discovery is unavailable

### Home keeps distinct contribution and report entry points and generic agent setup

Current security offers appear before project lists and rankings. Loading,
empty, stale or failed discovery never removes the generic agent setup.
Offer data comes from its own authorized public read; failure never invents an
offer. The section-order list specifies relative placement, not extra headings,
cards or controls.

```quint
import requests as R from "./requests"
type HomeSection = ContributionEntry | PrivateReportEntry | SecurityOffers | ProjectList | Rankings
pure val homeOrder = List(ContributionEntry, PrivateReportEntry, SecurityOffers, ProjectList, Rankings)
pure def genericAgentSetupAvailable(discovery: R::ReadStatus, clearedProjects: int): bool = true
pure def contributionEntryAvailable(discovery: R::ReadStatus): bool = true
pure def privateReportEntryAvailable(discovery: R::ReadStatus): bool = true
pure def lawDiscoveryFailureKeepsEntryPoints(discovery: R::ReadStatus, clearedProjects: int): bool =
  genericAgentSetupAvailable(discovery, clearedProjects) and contributionEntryAvailable(discovery) and privateReportEntryAvailable(discovery)
pure def lawOffersPrecedeDiscovery(order: List[HomeSection]): bool =
  order == homeOrder implies order.nthOr(2, Rankings) == SecurityOffers and order.nthOr(3, Rankings) == ProjectList and order.nthOr(4, ProjectList) == Rankings
```

### The campaign keeps one stable accessible heading and respects reduced motion

The visible campaign may type and delete in normal motion mode. Its accessible
heading remains stable through that animation. Reduced motion displays the
complete heading and disables typing and deletion. The persistent header stays
at viewport top while scrolling. The existing main landmark and keyboard
navigation remain, without restoring the removed Skip to content link.

```quint
type Motion = NormalMotion | ReducedMotion
pure def campaignAnimationEnabled(motion: Motion): bool = motion == NormalMotion
pure def campaignVisibleText(motion: Motion, completeHeading: str, animatedText: str): str =
  if (motion == ReducedMotion) completeHeading else animatedText
pure def campaignAccessibleHeading(completeHeading: str, animatedText: str): str = completeHeading
pure def headerViewportTop(scrollOffset: int): int = 0
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
pure val headingValues = Set("Make money shipping and securing open source.")
pure val completeHeadingValues = Set("Make money shipping and securing open source.")
pure val animatedTextValues = Set("", "Make money", "Make money shipping and securing open source.")
pure val firstFrameValues = Set("", "Make money")
pure val secondFrameValues = Set("Make money", "Make money shipping and securing open source.")
pure val orderValues = Set(homeOrder, List(ProjectList, SecurityOffers, Rankings))
pure val clearedProjectsValues = Set(0, 1, 2)
pure val scrollOffsetValues = Set(0, 1, 1000)
```

## Story: Complete project setup with explicit independent readiness

### Setup presents Project, Rewards and Review with both skill previews

The repository step offers the user's public-repository picker and URL entry
for another public repository, then loads the selected repository facts.
Project setup previews the public page and both generated skills. Rewards
presents the approved monthly pool or private-bounty choice and its terms;
it never adds a second review pool for a new project. Existing historical
review commitments retain their terms. A custom image falls back to the
GitHub owner avatar and never uses a social-preview image.

```quint
type SetupPresentation = { projectStep: bool, rewardsStep: bool, reviewStep: bool,
  publicRepositoryPicker: bool, repositoryUrlEntry: bool, selectedFactsLoaded: bool,
  publicPreview: bool, contributorSkillPreview: bool, reviewerSkillPreview: bool,
  monthlyPoolChoice: bool, privateBountyChoice: bool, secondReviewPool: bool,
  grossAwardVisible: bool, researcherShareVisible: bool, slopShareVisible: bool,
  privateReportTermsVisible: bool }
pure def acceptedSetupPresentation(view: SetupPresentation): bool =
  view.projectStep and view.rewardsStep and view.reviewStep and view.publicRepositoryPicker and
  view.repositoryUrlEntry and view.selectedFactsLoaded and view.publicPreview and
  view.contributorSkillPreview and view.reviewerSkillPreview and view.monthlyPoolChoice and
  view.privateBountyChoice and not(view.secondReviewPool) and view.grossAwardVisible and
  view.researcherShareVisible and view.slopShareVisible and view.privateReportTermsVisible
pure def projectImage(customImage: str, ownerAvatar: str): str =
  if (customImage != "") customImage else ownerAvatar
pure def lawImageFallback(ownerAvatar: str): bool = projectImage("", ownerAvatar) == ownerAvatar
pure def lawNoSecondReviewPool(view: SetupPresentation): bool = acceptedSetupPresentation(view) implies not(view.secondReviewPool)
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
    researcherShareVisible: true, slopShareVisible: true, privateReportTermsVisible: true }
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
