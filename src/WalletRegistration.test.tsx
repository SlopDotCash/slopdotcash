import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareWalletRegistration,
  type RegisteredWalletClaim,
  type WalletRegistrationOptions,
  type WalletRegistrationSession,
} from "./lib/wallet-registration";
import { WalletRegistration } from "./WalletRegistration";

vi.mock("./lib/wallet-registration", () => ({
  prepareWalletRegistration: vi.fn(),
}));
const prepare = vi.mocked(prepareWalletRegistration);
const ADDRESS = "11111111111111111111111111111111";
const claim: RegisteredWalletClaim = {
  schemaVersion: 1,
  claimId: "test_claim",
  githubActorId: "123",
  githubLogin: "octocat",
  address: ADDRESS,
  source: "d1_registry",
  issueRepository: null,
  issueNumber: null,
  observedAt: "2026-09-10T12:00:00.000Z",
  sourceBodySha256: "a".repeat(64),
  recordDigest: "b".repeat(64),
  supersedesClaimId: null,
};
function setup() {
  const close = vi.fn();
  const replace = vi.fn();
  const popup = { close, location: { replace }, opener: null };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  const confirm = vi.fn(async () => claim);
  const cancel = vi.fn();
  const session: WalletRegistrationSession = {
    preview: {
      identity: { githubActorId: "123", githubLogin: "octocat" },
      address: ADDRESS,
      current: null,
      expiresAt: "2026-09-10T12:10:00.000Z",
    },
    confirm,
    cancel,
  };
  prepare.mockImplementation(async (_address, options) => {
    options.authorize(
      "https://identity.slop.cash/v1/oauth/authorize?synthetic",
    );
    return session;
  });
  const rendered = render(<WalletRegistration />);
  fireEvent.change(screen.getByLabelText("Solana public address"), {
    target: { value: ADDRESS },
  });
  return { confirm, cancel, close, replace, rendered, session };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  prepare.mockReset();
});

describe("wallet registration confirmation UI", () => {
  it("shows the exact identity/address and submits only after Confirm register", async () => {
    const { confirm, replace } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    );
    const button = await screen.findByRole("button", {
      name: "Confirm register",
    });
    expect(screen.getByText("octocat")).toBeInTheDocument();
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith(
      "https://identity.slop.cash/v1/oauth/authorize?synthetic",
    );
    fireEvent.click(button);
    expect(
      await screen.findByRole("heading", { name: "Wallet registered" }),
    ).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("link", { name: "View public claim" }),
    ).toHaveAttribute(
      "href",
      "https://api.slop.cash/api/v1/wallet-claims/test_claim",
    );
  });
  it("cancels a preview without registration and disposes the session", async () => {
    const { confirm, cancel } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    );
    await screen.findByRole("button", { name: "Confirm register" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No wallet claim was submitted",
    );
  });
  it("aborts on unmount and never displays a late authentication result", async () => {
    const { rendered, session, cancel } = setup();
    let options: WalletRegistrationOptions | undefined;
    let resolve: ((value: WalletRegistrationSession) => void) | undefined;
    prepare.mockImplementation((_address, value) => {
      options = value;
      return new Promise((done) => {
        resolve = done;
      });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    );
    rendered.unmount();
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => {
      resolve?.(session);
    });
    expect(cancel).toHaveBeenCalled();
  });
  it("handles blocked popups without starting OAuth", async () => {
    setup();
    vi.mocked(window.open).mockReturnValue(null);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Allow the GitHub sign-in popup",
      ),
    );
    expect(prepare).not.toHaveBeenCalled();
  });
});
