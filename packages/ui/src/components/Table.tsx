import type { ComponentProps } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn, focusRing, target } from "../lib/cn.ts";

export type TableProps = ComponentProps<"table"> & {
  /** Names the scrolling region that holds the table, for a person who reaches it by keyboard. */
  label: string;
};
export type TableSectionProps = ComponentProps<"tbody">;
export type TableRowProps = ComponentProps<"tr">;
export type TableHeadProps = ComponentProps<"th"> & {
  /** The order the column sorts the rows in, when it is the sorted column. */
  sort?: "ascending" | "descending" | "none";
  /** Asks to sort by this column; the column header becomes a button. */
  onSort?: () => void;
};
export type TableCellProps = ComponentProps<"td">;
export type TableCaptionProps = ComponentProps<"caption"> & {
  /** Keeps the caption for assistive technology only. */
  visuallyHidden?: boolean;
};

const arrows = { ascending: ArrowUp, descending: ArrowDown, none: ArrowUpDown };

/** Rows of values in columns. A wide table scrolls sideways within a region a keyboard can reach. */
export function Table({ label, className, ...props }: TableProps) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn(focusRing, "w-full overflow-x-auto rounded-md")}>
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

/** The header rows of a `Table`. */
export function TableHeader({ className, ...props }: TableSectionProps) {
  return <thead className={cn("border-b border-border", className)} {...props} />;
}

/** The body rows of a `Table`. */
export function TableBody({ className, ...props }: TableSectionProps) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

/** A row of a `Table`. */
export function TableRow({ className, ...props }: TableRowProps) {
  return <tr className={cn("border-b border-border", className)} {...props} />;
}

/** A column header; with `onSort` it sorts the rows and says in which order through `aria-sort`. */
export function TableHead({ sort, onSort, scope = "col", className, children, ...props }: TableHeadProps) {
  const Arrow = arrows[sort ?? "none"];
  return (
    <th scope={scope} aria-sort={sort ?? (onSort && "none")} className={cn(onSort ? "h-11" : "h-10", "px-3 text-left font-medium whitespace-nowrap text-muted-foreground", className)} {...props}>
      {onSort ? (
        <button type="button" onClick={onSort} className={cn(focusRing, target, "inline-flex items-center gap-1 rounded-sm hover:text-foreground")}>
          {children}
          <Arrow aria-hidden className="size-3.5" />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

/** A cell of a `Table`. */
export function TableCell({ className, ...props }: TableCellProps) {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}

/** The table's title, read first by assistive technology. */
export function TableCaption({ visuallyHidden = false, className, ...props }: TableCaptionProps) {
  return <caption className={cn(visuallyHidden ? "sr-only" : "mt-3 text-sm text-muted-foreground", className)} {...props} />;
}
