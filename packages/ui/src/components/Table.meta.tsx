import { expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { TableBody, TableCaption, TableCell, TableHead, TableHeader, type TableProps, TableRow } from "./Table.tsx";

const rows = [
  ["slop-cli", "42", "0x8f3a1c9e2b7d4f6a0c5e8b1d3f7a9c2e4b6d8f0a"],
  ["escrow", "17", "0x1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c"],
];
const onSort = fn();
const table = (sorted: boolean) => (
  <>
    <TableCaption visuallyHidden>Repositories</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead>Repository</TableHead>
        <TableHead {...(sorted && { sort: "descending", onSort })} className="text-right">Merged</TableHead>
        <TableHead>Vault</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map(([name, merged, vault]) => (
        <TableRow key={name}>
          <TableCell>{name}</TableCell>
          <TableCell className="text-right font-mono tabular-nums">{merged}</TableCell>
          <TableCell className="font-mono">{vault}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </>
);

export const meta: ComponentMeta<TableProps> = {
  args: { label: "Repositories", children: table(false) },
  examples: { Sorted: { children: table(true) } },
  play: {
    // spec/ui/controls.md, "A sortable column says its order and asks to sort when activated"
    Sorted: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const headers = within(canvasElement).getAllByRole("columnheader");
      await expect(headers.map((h) => h.getAttribute("aria-sort"))).toEqual([null, "descending", null]);
      onSort.mockClear();
      // The scrolling region comes first, so a keyboard can scroll a wide table, then the sort button.
      await userEvent.tab();
      await expect(document.activeElement).toBe(within(canvasElement).getByRole("region", { name: "Repositories" }));
      await userEvent.tab();
      await expect(document.activeElement).toBe(within(canvasElement).getByRole("button", { name: /Merged/ }));
      await userEvent.keyboard("{Enter}");
      await expect(onSort).toHaveBeenCalledOnce();
    },
    // spec/ui/controls.md, "A sortable column says its order and asks to sort when activated"
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const headers = within(canvasElement).getAllByRole("columnheader");
      await expect(headers.map((h) => h.getAttribute("aria-sort"))).toEqual([null, null, null]);
      await expect(within(canvasElement).queryByRole("button")).toBeNull();
    },
  },
};
