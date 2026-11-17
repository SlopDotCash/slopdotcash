// spec/operations/notifications.md, "Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment"; spec/operations/notifications.md, "The Inbox shows one delivery word and never the address, digest, provider reference or attempt count"; spec/slopbot/appeals.md, "Only a moderator other than the appellant decides an escalated appeal"
import { type InboxNotice, type NotificationsPage, asksAcknowledgment } from "@repo/operations/client";
import { Button, ListItem } from "@repo/ui";
import { Bell, CircleDollarSign, FolderGit2, type LucideIcon, ShieldCheck, Wallet } from "lucide-react";
import { formatDateTime } from "../../app/format.ts";
import { awaitsAcknowledgment, unreadKeys } from "../../flows/account/inbox.vibe";
import { emailDeliveryLabel, noticePresentation } from "../../projections/notices.ts";

function iconOf(kind: InboxNotice["kind"]): LucideIcon {
  if (kind.startsWith("security_") || kind.startsWith("slopbot_")) return ShieldCheck;
  if (kind === "wallet_changed") return Wallet;
  if (kind.startsWith("payment_") || kind.startsWith("payout_") || kind === "award_reserved") return CircleDollarSign;
  if (kind.startsWith("project_") || kind.startsWith("application_") || kind.startsWith("reinstatement_")) return FolderGit2;
  return Bell;
}

export type InboxItemProps = {
  notice: InboxNotice;
  /** While an Inbox write is in flight no other write starts. */
  busy?: boolean;
  onMark: (eventKeys: ReadonlyArray<string>) => void;
  onAcknowledge: (notice: InboxNotice) => void;
};

/** One notice: what changed, where to act on it, when, whether it was read, and the one word on its email. */
export function InboxItem({ notice, busy = false, onMark, onAcknowledge }: InboxItemProps) {
  const unread = notice.readAt === null;
  const { title, action } = noticePresentation(notice);
  const Icon = iconOf(notice.kind);
  const delivery = notice.emailDelivery;
  const troubled = delivery === "failed" || delivery === "uncertain";
  return (
    <ListItem
      unread={unread}
      leading={<Icon aria-hidden className="size-5 text-muted-foreground" />}
      title={
        <a href={notice.actionPath} aria-label={`${title}: ${action}`} className="underline-offset-4 hover:underline">
          {title}
        </a>
      }
      detail={
        <>
          {notice.detail && notice.detail !== title ? <>{notice.detail} · </> : null}
          <time dateTime={notice.sourceAt}>{formatDateTime(notice.sourceAt)}</time>
          {unread ? null : <> · Read</>}
          {delivery ? <span className={troubled ? "text-destructive" : undefined}> · {emailDeliveryLabel(delivery)}</span> : null}
          {asksAcknowledgment(notice) && notice.acknowledgedAt ? <> · Acknowledged</> : null}
        </>
      }
      actions={
        <>
          {awaitsAcknowledgment(notice) ? (
            <Button size="sm" variant="outline" disabled={busy} aria-label={`Acknowledge: ${title}`} onClick={() => onAcknowledge(notice)}>
              Acknowledge
            </Button>
          ) : null}
          {unread ? (
            <Button size="sm" variant="ghost" disabled={busy} aria-label={`Mark as read: ${title}`} onClick={() => onMark([notice.eventKey])}>
              Mark as read
            </Button>
          ) : null}
        </>
      }
    />
  );
}

export type NoticesProps = Omit<InboxItemProps, "notice"> & { page: NotificationsPage };

/** The notices of one Inbox page, with how many are unread and one control to mark the shown ones read. */
export function Notices({ page, busy = false, onMark, onAcknowledge }: NoticesProps) {
  const shownUnread = unreadKeys(page);
  if (page.notifications.length === 0) return <p className="text-muted-foreground">You have no notifications.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{page.unread === 0 ? "All read." : `${page.unread} unread`}</p>
        {shownUnread.length > 0 ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onMark(shownUnread)}>
            Mark shown as read
          </Button>
        ) : null}
      </div>
      <ol aria-label="Notifications">
        {page.notifications.map((notice) => (
          <InboxItem key={notice.eventKey} notice={notice} busy={busy} onMark={onMark} onAcknowledge={onAcknowledge} />
        ))}
      </ol>
    </div>
  );
}
