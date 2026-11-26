// spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment"; spec/operations/notifications.md, "The Inbox shows one delivery word and never the address, digest, provider reference or attempt count"; spec/slopbot/appeals.md, "Only a moderator other than the appellant decides an escalated appeal"
import type { InboxNotice, NotificationsPage } from "@repo/operations/client";
import { Button, EmptyState, ListItem, cn } from "@repo/ui";
import { Bell, Check, CircleDollarSign, FolderGit2, Inbox, Lock, MailWarning, ShieldCheck, Wallet } from "lucide-react";
import { formatDateTime } from "../../app/format.ts";
import { awaitsAcknowledgment, unreadKeys } from "../../flows/account/inbox.vibe";
import { emailDeliveryLabel, noticePresentation } from "../../projections/notices.ts";

function NoticeIcon({ kind }: { kind: InboxNotice["kind"] }) {
  if (kind.startsWith("security_")) return <Lock aria-hidden className="size-5" />;
  if (kind.startsWith("slopbot_")) return <ShieldCheck aria-hidden className="size-5" />;
  if (kind === "wallet_changed") return <Wallet aria-hidden className="size-5" />;
  if (kind.startsWith("payment_") || kind.startsWith("payout_") || kind === "award_reserved") return <CircleDollarSign aria-hidden className="size-5" />;
  if (kind.startsWith("project_") || kind.startsWith("application_") || kind.startsWith("reinstatement_")) return <FolderGit2 aria-hidden className="size-5" />;
  return <Bell aria-hidden className="size-5" />;
}

const troubledDelivery = { failed: "text-destructive", uncertain: "text-warn" } as const;

function DeliveryMark({ delivery }: { delivery: InboxNotice["emailDelivery"] }) {
  if (delivery !== "failed" && delivery !== "uncertain") return null;
  const label = emailDeliveryLabel(delivery);
  return (
    <span role="img" aria-label={label} title={label} className={cn("inline-flex", troubledDelivery[delivery])}>
      <MailWarning aria-hidden className="size-3.5" />
    </span>
  );
}

export type InboxItemProps = {
  notice: InboxNotice;
  /** While an Inbox write is in flight no other write starts. */
  busy?: boolean;
  onMark: (eventKeys: ReadonlyArray<string>) => void;
  onAcknowledge: (notice: InboxNotice) => void;
};

/** One notice: what changed, where to act on it, when, whether it is unread, and a mark only when its email failed or is uncertain. */
export function InboxItem({ notice, busy = false, onMark, onAcknowledge }: InboxItemProps) {
  const unread = notice.readAt === null;
  const { title, action } = noticePresentation(notice);
  return (
    <ListItem
      leading={
        <span className="inline-flex rounded-md bg-info/10 p-2 text-info">
          <NoticeIcon kind={notice.kind} />
        </span>
      }
      title={
        <span className="flex min-w-0 items-center gap-2">
          {unread ? <span role="img" aria-label="Unread" title="Unread" className="inline-block size-2 shrink-0 rounded-full bg-info" /> : null}
          <a href={notice.actionPath} aria-label={`${title}: ${action}`} className={cn("truncate underline-offset-4 hover:underline", unread && "font-semibold text-foreground")}>
            {title}
          </a>
        </span>
      }
      detail={notice.detail && notice.detail !== title ? <span title={notice.detail}>{notice.detail}</span> : undefined}
      trailing={
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <time dateTime={notice.sourceAt}>{formatDateTime(notice.sourceAt)}</time>
          <DeliveryMark delivery={notice.emailDelivery} />
          {notice.kind === "security_case" && notice.acknowledgedAt ? (
            <span role="img" aria-label="Acknowledged" title="Acknowledged" className="inline-flex">
              <Check aria-hidden className="size-3.5" />
            </span>
          ) : null}
        </span>
      }
      actions={
        <>
          {awaitsAcknowledgment(notice) ? (
            <Button size="sm" variant="outline" disabled={busy} aria-label={`Acknowledge: ${title}`} onClick={() => onAcknowledge(notice)}>
              Ack
            </Button>
          ) : null}
          {unread ? (
            <Button size="sm" variant="ghost" disabled={busy} aria-label={`Mark as read: ${title}`} title="Mark as read" onClick={() => onMark([notice.eventKey])}>
              <Check aria-hidden className="size-4" />
            </Button>
          ) : null}
        </>
      }
    />
  );
}

export type NoticesProps = Omit<InboxItemProps, "notice"> & { page: NotificationsPage };

/** The notices of one Inbox page, with one control to mark the page's unread notices read. */
export function Notices({ page, busy = false, onMark, onAcknowledge }: NoticesProps) {
  const pageUnread = unreadKeys(page);
  if (page.notifications.length === 0) return <EmptyState title="Nothing yet" icon={<Inbox className="size-5" />} />;
  return (
    <div className="flex flex-col gap-2">
      {pageUnread.length > 0 ? (
        <Button size="sm" variant="outline" className="self-end" disabled={busy} onClick={() => onMark(pageUnread)}>
          Mark page read
        </Button>
      ) : null}
      <ol aria-label="Notifications">
        {page.notifications.map((notice) => (
          <InboxItem key={notice.eventKey} notice={notice} busy={busy} onMark={onMark} onAcknowledge={onAcknowledge} />
        ))}
      </ol>
    </div>
  );
}
