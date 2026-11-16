import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing, target } from "../lib/cn.ts";
import { Avatar } from "./Avatar.tsx";

export type IdentityProps = Omit<ComponentProps<"div">, "children"> & {
  /** The GitHub login, shown as written. */
  login: string;
  /** Where the login leads, such as the person's profile. */
  href?: string;
  /** The person's picture; their initial stands in without one. */
  avatarUrl?: string;
  /** One fact under the login, such as a role or a project. */
  detail?: ReactNode;
  /** `lg` is the heading of a profile page. */
  size?: "sm" | "md" | "lg";
};

/** A person as the product shows them: picture, login and, optionally, one fact. */
export function Identity({ login, href, avatarUrl, detail, size = "md", className, ...props }: IdentityProps) {
  const Name = size === "lg" ? "h1" : "span";
  return (
    <div className={cn("flex min-w-0 items-center", size === "lg" ? "gap-4" : "gap-2", className)} {...props}>
      <Avatar name={login} src={avatarUrl} size={size} />
      <div className="flex min-w-0 flex-col">
        <Name className={cn("truncate", size === "lg" ? "text-2xl font-semibold" : "font-medium")}>
          {href ? (
            <a href={href} className={cn(focusRing, target, "rounded-sm hover:underline")}>
              {login}
            </a>
          ) : (
            login
          )}
        </Name>
        {detail ? <span className="truncate text-xs text-muted-foreground">{detail}</span> : null}
      </div>
    </div>
  );
}
