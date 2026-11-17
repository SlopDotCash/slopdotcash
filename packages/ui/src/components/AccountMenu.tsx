import type { ComponentProps, ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { LogOut } from "lucide-react";
import { cn, focusRing, target } from "../lib/cn.ts";
import { controlState } from "../lib/control.ts";
import { popover } from "../lib/overlay.ts";
import { Avatar } from "./Avatar.tsx";
import { StatusIcon } from "./Status.tsx";

export type AccountMenuProps = {
  /** The account's GitHub login: part of the trigger's accessible name. */
  login: string;
  /** The account's picture; its initial stands in without one. */
  avatarUrl?: string;
  /** The account's points, already formatted, shown on the trigger. */
  points?: string;
  /** The account's destinations, as `AccountMenuItem`s. */
  children?: ReactNode;
  /** Signs the account out; called once per choice of the item. */
  onSignOut: () => void;
  /** Sign-out is in flight: the item stays in the menu and refuses another choice. */
  loading?: boolean;
  signOutLabel?: string;
};
export type AccountMenuItemProps = ComponentProps<typeof Menu.Item>;

const item =
  "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground aria-disabled:opacity-50";

/**
 * The signed-in account's menu: Settings, Payouts and Inbox stay separate pages reached from it, and signing out
 * ends the account's private views. Escape and a click outside close it; the page behind stays readable while it is open.
 * spec/frontend/navigation.md, "Navigation gates private destinations on a signed-in account";
 * spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs".
 */
export function AccountMenu({ login, avatarUrl, points, children, onSignOut, loading = false, signOutLabel = "Sign out" }: AccountMenuProps) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className={cn(focusRing, target, "inline-flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm hover:bg-accent data-[state=open]:bg-accent")}>
        <Avatar name={login} src={avatarUrl} />
        <span className="sr-only">{login}</span>
        {points ? <span className="font-mono tabular-nums">{points}</span> : null}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className={cn(popover, "min-w-48 p-1")}>
          <Menu.Label className="truncate px-2 py-1.5 text-sm font-medium">{login}</Menu.Label>
          {children}
          <Menu.Separator className="my-1 h-px bg-border" />
          {/* spec/ui/controls.md, "A disabled or busy control refuses activation and stays named": a busy item stays focusable and the menu open. */}
          <Menu.Item className={item} onSelect={onSignOut} {...controlState(false, loading)}>
            {loading ? <StatusIcon icon="Spinner" /> : <LogOut aria-hidden className="size-4" />}
            {signOutLabel}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A destination in the `AccountMenu`; pass `asChild` to use a router's link. */
export function AccountMenuItem({ className, ...props }: AccountMenuItemProps) {
  return <Menu.Item className={cn(item, className)} {...props} />;
}
