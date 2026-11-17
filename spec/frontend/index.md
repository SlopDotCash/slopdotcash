# Frontend

The browser presents the state owned by the application machines. It obtains
authority from the authenticated backend and payment facts from reconciled
evidence. The existing product routes and controls are the design baseline.
These requirements specify the eventual React shell on the generated Machine
service. They introduce no new screens or visual design. Owner decision
frontend-ui:OD2 (port or redesign) is pending; the default is a port: every
route, control, label and deep-link id is kept, restyled only through the
design tokens of the shared component library.

- [Navigation and session ownership](./navigation.md)
- [Asynchronous reads and recovery](./requests.md)
- [Ranked snapshot validation](./rankedSnapshot.md)
- [Shared public snapshot ownership](./snapshotCache.md)
- [Private report drafts](./drafts.md)
- [Direct bounty wallet prompt ownership](./directBountyPrompt.md)
- [Independent private report details](./reportDetails.md)
- [Public and private projections](./projections.md)
- [Required product presentation](./presentation.md)
- [Referral link settings](./referralSettings.md)
- [Provisional EVM vault funding](./provisionalVault.md)
- [Atomic wallet deposit requests](./batchedDeposit.md)
- [Wallet attempt storage](./walletAttempt.md)
- [Payout wallet choice and binding consent](./walletConsent.md)
- [Solana bounty payment prompt](./solanaBountyPrompt.md)
- [Owner vault setup and transfers](./ownerVault.md)
- [Owner monthly pages](./ownerMonthly.md)
- [Public payment history assembly](./paymentHistory.md)
- [Cross-machine account ownership](./composition.md)
- [Project registry freshness](./registry.md)
- [Fragments and document heads](./routes.md)
- [Email link actions](./emailAction.md)
- [Project setup and manifest drafts](./projectDrafts.md)
- [Browser wallet discovery](./wallets.md)
- [Derived public views](./views.md)
- [Vault month locks](./vaultLocks.md)
- [Owner month lock card](./monthLock.md)
- [Monthly listing and the home grid](./poolListing.md)
- [Project page links](./projectLinks.md)

Source requirements are PRD sections 2–4 and 6–10. The retained UI models under
`reference/slop-main/formal/models/ui/` provide the individual legacy races and
named scenarios to replay through the eventual shell.
