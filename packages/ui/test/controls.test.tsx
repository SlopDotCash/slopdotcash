// @vitest-environment happy-dom
// spec/ui/copy.md, "Story: Copy a value and know whether it worked"; "Success settles back to ready; failure stays until the next attempt"
// spec/ui/pagination.md, "Story: Move through pages without leaving the list"; "The page stays within the pages that exist"
// spec/ui/index.md, "Each control kind has one primitive, and every component has stories"
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { Checkbox, CopyButton, Pagination, usePagination } from "../src/index.ts";

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previous = environment.IS_REACT_ACT_ENVIRONMENT;
let root: Root | undefined;

async function show(node: ReactNode) {
  await act(async () => {
    root?.unmount();
  });
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => {
    root?.render(node);
  });
  return host;
}

beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  document.body.replaceChildren();
});

afterAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = previous;
});

it("copies, settles back to ready via AbortSignal.timeout, and keeps failure until retried", async () => {
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  const restAfter = 86_400_000;
  let restController: AbortController | undefined;
  Object.assign(AbortSignal, {
    timeout: (ms: number) => {
      if (ms !== restAfter) return originalTimeout(ms);
      restController = new AbortController();
      return restController.signal;
    },
  });
  try {
    let shouldSucceed = true;
    const host = await show(
      <CopyButton
        text="slop-value"
        label="Copy value"
        restAfter={restAfter}
        onCopy={() => (shouldSucceed ? Promise.resolve() : Promise.reject(new Error("denied")))}
      />,
    );
    const button = host.querySelector<HTMLButtonElement>("button")!;
    const status = host.querySelector('[role="status"]')!;

    await act(async () => {
      button.click();
    });
    expect(button.getAttribute("data-copy")).toBe("Copied");
    expect(status.textContent).toBe("Copied");

    await act(async () => {
      restController?.abort();
    });
    expect(button.getAttribute("data-copy")).toBe("Ready");
    expect(status.textContent).toBe("");

    shouldSucceed = false;
    await act(async () => {
      button.click();
    });
    expect(button.getAttribute("data-copy")).toBe("CopyFailed");
    expect(status.textContent).toBe("Copy failed. Select and copy the text.");
  } finally {
    Object.assign(AbortSignal, { timeout: originalTimeout });
  }
});

it("moves focus to the opposite pagination button when reaching an end of a two-page list", async () => {
  function TwoPages() {
    const [state, send] = usePagination({ page: 1, pages: 2 });
    return <Pagination state={state} onSend={send} label="Results" />;
  }
  const host = await show(<TwoPages />);
  const previousButton = host.querySelector<HTMLButtonElement>('button[aria-label="Previous page"]')!;
  const nextButton = host.querySelector<HTMLButtonElement>('button[aria-label="Next page"]')!;

  expect(previousButton.disabled).toBe(true);
  expect(nextButton.disabled).toBe(false);

  await act(async () => {
    nextButton.focus();
    nextButton.click();
  });

  expect(previousButton.disabled).toBe(false);
  expect(nextButton.disabled).toBe(true);
  expect(document.activeElement).toBe(previousButton);
});

it("renders a lucide Check icon inside a checked Checkbox", async () => {
  const host = await show(<Checkbox aria-label="Accept terms" checked />);
  const svg = host.querySelector("svg");
  expect(svg).not.toBeNull();
  expect(svg?.classList.contains("lucide-check")).toBe(true);
});
