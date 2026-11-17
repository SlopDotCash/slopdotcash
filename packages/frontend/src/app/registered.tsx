// spec/frontend/navigation.md, "Every existing product route is one Page and only private destinations need an account"
import { networkPays } from "../kernels/payingNetworks.ts";
import { projectTermsOf, repositoryRegistryOf } from "../reads/registryTerms.ts";
import { LoginPage, SettingsPage } from "../screens/account/index.ts";
import { AdminPage, VettingEvidencePage } from "../screens/admin/index.ts";
import { CycleArchivePage, CyclePage } from "../screens/cycles/index.ts";
import { InboxPage } from "../screens/inbox/index.ts";
import { PayoutsPage } from "../screens/payouts/index.ts";
import { PointsPage } from "../screens/points/index.ts";
import { ProfilePage } from "../screens/profiles/index.ts";
import { ProjectPage } from "../screens/projects/index.ts";
import { HowItWorksPage } from "../screens/public/index.ts";
import { casePayments, SecurityCasesWithPayments } from "../screens/security/payments/index.ts";
import { SecurityProgramWithSettings } from "../screens/security/settings/index.ts";
import { NewProjectPage } from "../screens/setup/status/index.ts";
import { UpdatePage } from "../screens/setup/update/index.ts";
import type { PageKind, RegisteredPage } from "./pages.ts";
import { HomeRoute, SponsorsRoute } from "./publicPages.tsx";

export const pages: Readonly<Record<PageKind, RegisteredPage>> = {
  Home: HomeRoute,
  HowItWorks: HowItWorksPage,
  Sponsors: SponsorsRoute,
  CycleArchive: CycleArchivePage,
  Cycle: (props) => <CyclePage {...props} repositoryRegistry={repositoryRegistryOf} projectTerms={projectTermsOf} />,
  Points: PointsPage,
  Account: SettingsPage,
  Login: LoginPage,
  Earnings: PayoutsPage,
  Inbox: (props) => <InboxPage {...props} payment={casePayments(props.runtime)} />,
  Admin: AdminPage,
  NewProject: NewProjectPage,
  VettingEvidence: VettingEvidencePage,
  SecurityCases: SecurityCasesWithPayments,
  Project: (props) => <ProjectPage {...props} networkPays={networkPays} repositoryRegistry={repositoryRegistryOf} />,
  ManageProject: UpdatePage,
  SecurityProgram: SecurityProgramWithSettings,
  Profile: (props) => <ProfilePage {...props} repositoryRegistry={repositoryRegistryOf} projectTerms={projectTermsOf} />,
};
