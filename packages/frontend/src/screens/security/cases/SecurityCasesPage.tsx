// spec/frontend/navigation.md, "Every existing product route is one Page and only private destinations need an account"; spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"
import { PageHeader } from "@repo/ui";
import { LockKeyhole } from "lucide-react";
import { pageShellClass } from "../../../app/PageShell.tsx";
import type { PageProps } from "../../../app/pages.ts";
import type { PaymentSlot } from "./CaseDetail.tsx";
import { SecurityInbox } from "./SecurityInbox.tsx";

/** `/security`: the signed-in viewer's private reports and cases. */
export function SecurityCasesPage({ runtime, payment }: PageProps & { payment?: PaymentSlot }) {
  return (
    <main className={pageShellClass("md", "8", "py-12")}>
      <PageHeader icon={<LockKeyhole className="size-6" />} title="Security cases" />
      <SecurityInbox runtime={runtime} payment={payment} />
    </main>
  );
}
