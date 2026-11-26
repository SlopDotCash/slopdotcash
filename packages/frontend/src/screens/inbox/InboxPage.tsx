// spec/operations/notifications.md, "Story: Read, acknowledge and escalate private case notices"; spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/composition.md, "Account changes erase drafts and preserve every child invariant"; spec/slopbot/assessmentInbox.md, "A read captures its actor, exact registry binding and response route"
import type { NotificationsPage } from "@repo/operations/client";
import { Alert, Button, PageHeader, Spinner } from "@repo/ui";
import { ChevronLeft, ChevronRight, Inbox as InboxIcon, Settings } from "lucide-react";
import { Suspense, lazy } from "react";
import { pageShellClass } from "../../app/PageShell.tsx";
import type { PageProps } from "../../app/pages.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { SignInPanel } from "../../app/SignInPanel.tsx";
import { useAddress } from "../../app/useAddress.ts";
import { loginHrefFor, useSession } from "../../app/useSession.ts";
import type { InboxView } from "../../flows/account/inbox.vibe";
import { useView } from "../account/useView.ts";
import type { PaymentSlot } from "../security/cases/CaseDetail.tsx";
import { useMounted } from "../security/program/hooks.ts";
import { InboxEmailLink } from "./EmailLinkAction.tsx";
import { Notices } from "./InboxItem.tsx";
import { AssessmentQueue } from "./IncompleteAssessments.tsx";
import { type InboxRuntime, acknowledgeNotice, inboxRuntime, loadInbox, markNotices, newerNotices, olderNotices, watchInbox } from "./runtime.vibe";

const SecurityInbox = lazy(() => import("../security/cases/SecurityInbox.tsx").then((module) => ({ default: module.SecurityInbox })));
const PointsReview = lazy(() => import("./PointsDisputes.tsx").then((module) => ({ default: module.PointsReview })));

const loads = new WeakMap<NotificationsPage, number>();
let loaded = 0;

function loadOf(page: NotificationsPage): number {
  const known = loads.get(page);
  if (known !== undefined) return known;
  loaded += 1;
  loads.set(page, loaded);
  return loaded;
}

type BodyProps = { runtime: PageRuntime; section: InboxRuntime; view: InboxView | undefined; payment?: PaymentSlot };

function InboxBody({ runtime, section, view, payment }: BodyProps) {
  useMounted(section, loadInbox);
  const shown = useSession(runtime);
  const address = new URL(useAddress(), "https://slop.invalid");
  const send = (work: Parameters<InboxRuntime["runFork"]>[0]) => {
    section.runFork(work);
  };
  if (view === undefined || shown === undefined) return <Spinner label="Loading inbox" />;
  const { status, recipient, page, busy } = view;
  const ready = status === "ready" && page !== undefined;
  const reviewing = address.searchParams.has("points") || address.searchParams.has("pointsDispute");
  return (
    <>
      {status === "loading" ? <Spinner label="Loading inbox" /> : null}
      {status === "signedOut" ? <SignInPanel view={{ status: "signedOut" }} href={loginHrefFor(shown, `/inbox${address.search}`)} /> : null}
      {status === "failed" ? (
        <Alert variant="destructive" action={<Button variant="outline" size="sm" onClick={() => send(loadInbox())}>Retry</Button>}>
          {view.message}
        </Alert>
      ) : null}
      {recipient !== null ? (
        <div key={recipient} hidden={status === "loading"} className="flex flex-col gap-8">
          {ready && page.incompleteAssessments !== undefined ? <AssessmentQueue key={loadOf(page)} section={section} actor={recipient} initial={page.incompleteAssessments} loadedAt={view.loadedAt} /> : null}
          {reviewing ? (
            <Suspense fallback={<Spinner label="Loading Points review" />}>
              <PointsReview key={address.search} section={section} actor={recipient} />
            </Suspense>
          ) : null}
          <Suspense fallback={<Spinner label="Loading reports" />}>
            <SecurityInbox runtime={runtime} embedded payment={payment} />
          </Suspense>
        </div>
      ) : null}
      {ready ? <Notices page={page} busy={busy} onMark={(keys) => send(markNotices(keys))} onAcknowledge={(notice) => send(acknowledgeNotice(notice))} /> : null}
      {ready && (view.hasNewer || page.nextCursor !== null) ? (
        <nav aria-label="Notification pages" className="flex gap-2">
          <Button variant="outline" disabled={busy || !view.hasNewer} aria-label="Newer notifications" title="Newer notifications" onClick={() => send(newerNotices())}>
            <ChevronLeft aria-hidden className="size-4" /> Newer
          </Button>
          <Button variant="outline" disabled={busy || page.nextCursor === null} aria-label="Older notifications" title="Older notifications" onClick={() => send(olderNotices())}>
            Older <ChevronRight aria-hidden className="size-4" />
          </Button>
        </nav>
      ) : null}
      {view.done ? <p role="status">{view.done}</p> : null}
      {view.actionError ? <Alert variant="destructive">{view.actionError}</Alert> : null}
    </>
  );
}

function HeaderActions({ view }: { view: InboxView | undefined }) {
  if (view?.status !== "ready" || view.page === undefined) return null;
  return (
    <>
      {view.page.unread > 0 ? (
        <span className="rounded-full bg-info/10 px-2.5 py-0.5 text-sm font-medium text-info">
          {view.page.unread}
          <span className="sr-only"> unread</span>
        </span>
      ) : null}
      <Button asChild variant="outline" size="icon">
        <a href="/account#notifications" aria-label="Email preferences" title="Email preferences">
          <Settings aria-hidden className="size-5" />
        </a>
      </Button>
    </>
  );
}

/** `/inbox`: the signed-in member's notices, the pending email link, and the private queues and reviews that belong to them. */
export function InboxPage({ runtime, payment }: PageProps & { payment?: PaymentSlot }) {
  const section = inboxRuntime(runtime);
  const view = useView(section, watchInbox);
  return (
    <main className={pageShellClass("md", "8", "py-12")}>
      <PageHeader icon={<InboxIcon className="size-6" />} title="Inbox" actions={<HeaderActions view={view} />} />
      <InboxEmailLink runtime={runtime} />
      <InboxBody runtime={runtime} section={section} view={view} payment={payment} />
    </main>
  );
}
