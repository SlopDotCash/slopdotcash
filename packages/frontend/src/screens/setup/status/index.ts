// spec/frontend/presentation.md, "Setup readiness shows authority, Slopbot, security and funding separately"
export { actOnApplication, type ApplicationAction, type ApplicationOutcome, pendingApplications } from "./applications.vibe";
export { followSetup, type SetupFollow, type SetupView } from "./check.vibe";
export { authorityReadiness, exemptionLabels, installationReadiness, scanFinding, scanReadiness, setupHeadings } from "./checks.ts";
export { type SetupFunding, setupFundingOf } from "./funding.schema.ts";
export { NewProjectPage } from "./NewProjectPage.tsx";
export { applicationName, PendingApplication, type PendingApplicationProps, PendingApplications } from "./PendingApplications.tsx";
export { ScanClearance, type ScanClearanceProps } from "./ScanClearance.tsx";
export { SetupStatusPanel, type SetupStatusPanelProps } from "./SetupStatusPanel.tsx";
export { SetupSummary, type SetupSummaryProps } from "./SetupSummary.tsx";
