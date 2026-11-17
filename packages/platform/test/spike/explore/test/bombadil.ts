/// <reference lib="dom" />
// spec/frontend/requests.md, "Story: Read current data without losing the last good result"
import { always } from "@antithesishq/bombadil";
import { extract } from "@antithesishq/bombadil/browser";
export * from "@antithesishq/bombadil/browser/defaults";

const greeting = extract(({ document }) => document.querySelector("output")?.textContent ?? "");

export const greetingIsNeverAnError = always(() => greeting.current === "" || greeting.current === "hello pages");
