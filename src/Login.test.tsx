// @vitest-environment-options {"url":"https://slop.cash/login"}
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LoginPage, PointsNav, PointsProvider } from "./Points";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("restores GitHub identity without needing the points ledger and signs out", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input) === "/api/v1/points/me")
      return Response.json({
        actor: { id: "U_test", login: "contributor" },
        joinedAt: "2026-09-24T00:00:00Z",
        public: false,
        welcome: 5,
      });
    if (String(input) === "/api/v1/points/signout")
      return Response.json({ ok: true });
    throw new Error(`Unexpected request: ${input}`);
  });
  render(
    <PointsProvider enabled={false}>
      <PointsNav />
      <LoginPage />
    </PointsProvider>,
  );
  const account = await screen.findByRole("button", { name: "Your account" });
  expect(screen.queryByText("@contributor")).not.toBeInTheDocument();
  fireEvent.click(account);
  expect(screen.getByText("@contributor")).toBeVisible();
  expect(screen.getByRole("link", { name: "View profile" })).toHaveAttribute(
    "href",
    "/contributors/contributor",
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(account).toHaveAttribute("aria-expanded", "false");
  expect(account).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("link", { name: "Log in" })).toHaveAttribute(
    "href",
    "/login",
  );
  expect(
    screen.getByRole("button", { name: "Continue with GitHub" }),
  ).toBeEnabled();
});

it("shows a recoverable session error and keeps GitHub as the sign-in option", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 503 }),
  );
  render(
    <PointsProvider enabled={false}>
      <LoginPage />
    </PointsProvider>,
  );
  expect(
    await screen.findByText(/couldn’t check your session/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Continue with GitHub" }),
  ).toBeEnabled();
});
