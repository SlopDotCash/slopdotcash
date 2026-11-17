// spec/frontend/navigation.md, "Every existing product route is one Page and only private destinations need an account"; spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"
import type { PageProps } from "../../../app/pages.ts";
import { SecurityCasesPage } from "../cases/SecurityCasesPage.tsx";
import { casePayments } from "./CasePayment.tsx";

/** `/security` with each case's payment controls for the payer. */
export function SecurityCasesWithPayments({ runtime, route }: PageProps) {
  return <SecurityCasesPage runtime={runtime} route={route} payment={casePayments(runtime)} />;
}
