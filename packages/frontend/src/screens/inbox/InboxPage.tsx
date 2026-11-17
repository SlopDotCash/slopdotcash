// spec/operations/notifications.md, "Story: Read, acknowledge and escalate private case notices"; spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/composition.md, "Account changes erase drafts and preserve every child invariant"
import type { NotificationsPage } from "@repo/operations/client";
import { Alert, Button, PageHeader } from "@repo/ui";
import { Inbox as InboxIcon } from "lucide-react";
import type { PageProps } from "../../app/pages.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { SignInPanel } from "../../app/SignInPanel.tsx";
import { useAddress } from "../../app/useAddress.ts";
import { loginHrefFor, useSession } from "../../app/useSession.ts";
import { useView } from "../account/useView.ts";
import type { PaymentSlot } from "../security/cases/CaseDetail.tsx";
import { SecurityInbox } from "../security/cases/SecurityInbox.tsx";
import { useMounted } from "../security/program/hooks.ts";
import { InboxEmailLink } from "./EmailLinkAction.tsx";
import { Notices } from "./InboxItem.tsx";
import { AssessmentQueue } from "./IncompleteAssessments.tsx";
import { PointsReview } from "./PointsDisputes.tsx";
import { type InboxRuntime, acknowledgeNotice, inboxRuntime, loadInbox, markNotices, newerNotices, olderNotices, watchInbox } from "./runtime.vibe";

const loads = new WeakMap<NotificationsPage, number>();
let loaded = 0;

function loadOf(page: NotificationsPage): number {
  const known = loads.get(page);
  if (known !== undefined) return known;
  loaded += 1;
  loads.set(page, loaded);
  return loaded;
}

type BodyProps = { runtime: PageRuntime; section: InboxRuntime; payment?: PaymentSlot };

function InboxBody({ runtime, section, payment }: BodyProps) {
  useMounted(section, loadInbox);
  const view = useView(section, watchInbox);
  const shown = useSession(runtime);
  const address = new URL(useAddress(), "https://slop.invalid");
  const send = (work: Parameters<InboxRuntime["runFork"]>[0]) => {
    section.runFork(work);
  };
  if (view === undefined || shown === undefined) return <p role="status">Loading your inbox…</p>;
  const { status, recipient, page, busy } = view;
  const ready = status === "ready" && page !== undefined;
  const reviewing = address.searchParams.has("points") || address.searchParams.has("pointsDispute");
  return (
    <>
      {status === "loading" ? <p role="status">Loading your inbox…</p> : null}
      {status === "signedOut" ? <SignInPanel view={{ status: "signedOut" }} href={loginHrefFor(shown, `/inbox${address.search}`)} /> : null}
      {status === "failed" ? (
        <Alert variant="destructive" action={<Button variant="outline" size="sm" onClick={() => send(loadInbox())}>Retry</Button>}>
          {view.message}
        </Alert>
      ) : null}
      {recipient !== null ? (
        <div key={recipient} hidden={status === "loading"} className="flex flex-col gap-8">
          {page !== undefined ? <AssessmentQueue key={loadOf(page)} section={section} actor={recipient} /> : null}
          {reviewing ? <PointsReview key={address.search} section={section} actor={recipient} /> : null}
          <SecurityInbox runtime={runtime} embedded payment={payment} />
        </div>
      ) : null}
      {ready ? <Notices page={page} busy={busy} onMark={(keys) => send(markNotices(keys))} onAcknowledge={(notice) => send(acknowledgeNotice(notice))} /> : null}
      {ready && (view.hasNewer || page.nextCursor !== null) ? (
        <nav aria-label="Notification pages" className="flex gap-2">
          <Button variant="outline" disabled={busy || !view.hasNewer} onClick={() => send(newerNotices())}>
            Newer notifications
          </Button>
          <Button variant="outline" disabled={busy || page.nextCursor === null} onClick={() => send(olderNotices())}>
            Older notifications
          </Button>
        </nav>
      ) : null}
      {view.done ? <p role="status">{view.done}</p> : null}
      {view.actionError ? <Alert variant="destructive">{view.actionError}</Alert> : null}
      {ready ? (
        <a href="/account#notifications" className="self-start text-primary underline underline-offset-4">
          Email preferences
        </a>
      ) : null}
    </>
  );
}

/** `/inbox`: the signed-in member's notices, the pending email link, and the private queues and reviews that belong to them. */
export function InboxPage({ runtime, payment }: PageProps & { payment?: PaymentSlot }) {
  const section = inboxRuntime(runtime);
  return (
    <main className="mx-auto flex w-full max-w-(--breakpoint-md) flex-1 flex-col gap-8 px-4 py-12">
      <PageHeader icon={<InboxIcon className="size-6" />} title="Inbox" />
      <InboxEmailLink runtime={runtime} />
      <InboxBody runtime={runtime} section={section} payment={payment} />
    </main>
  );
}
