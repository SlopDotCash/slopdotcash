// spec/app/index.md, "The shell shows one route, opened from the address"
import { cn, shell } from "@repo/ui";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type PageShellWidth = "shell" | "lg" | "md" | "sm";
export type PageShellGap = "4" | "6" | "8" | "10" | "12";

const widthClasses: Readonly<Record<PageShellWidth, string>> = {
  shell: "",
  lg: "max-w-(--breakpoint-lg)",
  md: "max-w-(--breakpoint-md)",
  sm: "max-w-(--breakpoint-sm)",
};

const gapClasses: Readonly<Record<PageShellGap, string>> = {
  "4": "gap-4",
  "6": "gap-6",
  "8": "gap-8",
  "10": "gap-10",
  "12": "gap-12",
};

export interface PageShellProps extends ComponentPropsWithoutRef<"main"> {
  width?: PageShellWidth;
  gap?: PageShellGap;
  children?: ReactNode;
}

export function pageShellClass(width: PageShellWidth = "lg", gap: PageShellGap = "6", className?: string): string {
  return cn(shell, "flex flex-1 flex-col py-8", widthClasses[width], gapClasses[gap], className);
}

export function PageShell({ width = "lg", gap = "6", className, children, ...props }: PageShellProps) {
  return (
    <main className={pageShellClass(width, gap, className)} {...props}>
      {children}
    </main>
  );
}
