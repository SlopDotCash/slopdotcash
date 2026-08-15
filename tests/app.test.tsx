/**
 * Exercises the public product routes against a contract-valid snapshot,
 * including explicit data failure, project isolation, contributor and cycle
 * views, authenticated install commands, and GitHub-native project proposals.
 */

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, publicFooterDomain } from "../src/App";
import { cycleIndexFixture, snapshotFixture } from "./fixtures";

function route(path: string): void {
  window.history.replaceState({}, "", path);
}

describe("public footer domain", () => {
  it("uses the active Slop authority and defaults unknown hosts to slop.cash", () => {
    expect(publicFooterDomain("slop.cash")).toBe("slop.cash");
    expect(publicFooterDomain("slop.tech")).toBe("slop.tech");
    expect(publicFooterDomain("www.slop.tech")).toBe("slop.tech");
    expect(publicFooterDomain("127.0.0.1")).toBe("slop.cash");
  });
});

function mockSnapshot(value: unknown = snapshotFixture()): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    Response.json(
      structuredClone(
        String(input).includes("/data/cycles/") ? cycleIndexFixture() : value,
      ),
    ),
  );
}

function augustRollingSnapshot() {
  const snapshot = snapshotFixture();
  const to = snapshot.generatedAt;
  const from = new Date(
    Date.parse(to) - 35 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  snapshot.window = { days: 35, from, to };
  snapshot.source.cutoffAt = to;
  snapshot.source.fetchedAt = to;
  snapshot.source.verificationWindow = { days: 35, from, to };
  return snapshot;
}

function archivedPaidCycleIndex() {
  const index = cycleIndexFixture();
  const prefix = "/data/cycles/eliza/2026-06";
  const file = (name: string) => ({
    sha256: "a".repeat(64),
    url: `${prefix}/${name}.json`,
  });
  index.cycles = [
    {
      projectId: "eliza",
      cycleId: "2026-06",
      kind: "monthly-pool",
      state: "paid",
      generatedAt: "2026-07-20T00:00:00.000Z",
      contributionWindow: {
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-07-01T00:00:00.000Z",
      },
      reviewEndsAt: "2026-07-15T00:00:00.000Z",
      approvedAt: "2026-07-16T00:00:00.000Z",
      settledAt: "2026-07-20T00:00:00.000Z",
      reward: {
        currency: "USDC",
        capMinor: "1000000",
        suggestedMinor: "1000000",
        approvedMinor: "1000000",
        paidMinor: "1000000",
        feeMinor: "10000",
        sharePartsPerMillion: null,
      },
      contributors: [
        {
          actor: { id: "U_archived", login: "archive-only" },
          score: 7,
          state: "paid",
          suggestedMinor: "1000000",
          approvedMinor: "1000000",
          paidMinor: "1000000",
          sharePartsPerMillion: null,
          wallet: {
            address: "11111111111111111111111111111111",
            chain: "solana",
            observedAt: "2026-07-01T00:00:00.000Z",
            sourceCommit: "b".repeat(40),
            sourceUrl: `https://github.com/archive-only/archive-only/blob/${"b".repeat(40)}/README.md`,
          },
        },
      ],
      files: {
        sourceSnapshot: file("source-snapshot"),
        proposal: file("proposal"),
        allocation: file("allocation"),
        executionPlan: file("execution-plan"),
        settlement: file("settlement"),
      },
    },
  ];
  return index;
}

beforeEach(() => {
  route("/");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("discovery", () => {
  it("leads with the money-forward message and separates both reward models", async () => {
    mockSnapshot();
    render(<App />);

    expect(screen.getByRole("link", { name: "Slop home" })).toHaveTextContent(
      "slop.cash",
    );
    expect(
      screen.queryByRole("link", { name: /^Home$/u }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Protocol" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("© 2026 slop.cash.")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "MAKE MONEY SHIPPING SLOP." }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Public beta.")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Rankings are live. Payouts are off/u),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Contribute to Eliza." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Paste this into any coding agent."),
    ).toBeInTheDocument();
    const homePrompt = screen.getByLabelText("Agent prompt");
    expect(homePrompt).toHaveTextContent(`${window.location.origin}/SKILL.md`);
    expect(homePrompt).toHaveTextContent(
      "contribute to github.com/elizaOS/eliza",
    );
    expect(homePrompt.querySelectorAll("wbr")).toHaveLength(2);
    expect(
      await screen.findByRole("heading", { name: "Leaderboard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "This month" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tab", { name: "Eliza, $10,000 monthly pool" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/July 2026 · Eliza/u)).toBeInTheDocument();
    const leaderboard = screen.getByRole("table", {
      name: /Eliza July 2026 reward leaderboard/u,
    });
    expect(
      within(leaderboard).getByRole("columnheader", {
        name: "Accepted score",
      }),
    ).toBeInTheDocument();
    expect(
      within(leaderboard).getByRole("columnheader", {
        name: "Simulated share",
      }),
    ).toBeInTheDocument();
    expect(
      within(leaderboard).queryByRole("columnheader", {
        name: "Paid to date",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("How it works")).toBeInTheDocument();
    expect(
      screen.getByText(/Payouts are off during beta/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View more" })).toHaveAttribute(
      "href",
      "/projects/eliza",
    );
    expect(
      screen.getByRole("heading", { name: "Projects" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Eliza" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Delta Star" }),
    ).toBeInTheDocument();
    const elizaCard = screen.getByRole("link", { name: /^Eliza /u });
    expect(within(elizaCard).getByText("$10,000")).toBeInTheDocument();
    expect(within(elizaCard).getByText("/ month")).toBeInTheDocument();
    expect(
      within(elizaCard).getByText(/Build and verify the elizaOS framework/u),
    ).toBeInTheDocument();
    const deltaCard = screen.getByRole("link", { name: /^Delta Star /u });
    expect(within(deltaCard).getByText("$1,000,000")).toBeInTheDocument();
    expect(within(deltaCard).getByText("external prize")).toBeInTheDocument();
    expect(
      within(deltaCard).getByText(/Advance ArkLib's machine-checked/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/GitHub ledger \+ reward records live/u),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("THE GITARMY NETWORK")).not.toBeInTheDocument();
    expect(screen.queryByText("Work in. Money out.")).not.toBeInTheDocument();
    expect(screen.getByText("finish-line")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "All-time record" }));
    const record = screen.getByRole("table", {
      name: "All-time accepted-work record",
    });
    expect(
      within(record).getByRole("columnheader", { name: "Paid to date" }),
    ).toBeInTheDocument();
    expect(
      within(record).queryByRole("columnheader", {
        name: "Simulated share",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /This rank does not determine any current monthly pool/u,
      ),
    ).toBeInTheDocument();
  });

  it("scrolls hash navigation to the requested section", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    mockSnapshot();
    render(<App />);

    await screen.findByRole("heading", { name: "Leaderboard" });
    fireEvent.click(screen.getByRole("link", { name: "Leaderboard" }));

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    });
    expect(window.location.hash).toBe("#leaderboard");
  });

  it("rotates the money-forward statement when motion is allowed", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    mockSnapshot();
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "MAKE MONEY SHIPPING SLOP." }),
    ).toBeInTheDocument();
    const visibleAction = () =>
      document.querySelector(".hero-typewriter")?.textContent ?? "";
    expect(visibleAction()).toBe("SHIPPING SLOP.");
    act(() => vi.advanceTimersToNextTimer());
    act(() => vi.advanceTimersToNextTimer());
    expect(visibleAction()).toBe("SHIPPING SLOP");

    for (const action of [
      "PROVING MATH.",
      "DISCOVERING DRUGS.",
      "HARDENING THE WEB.",
      "FIXING BUGS.",
      "SECURING THE INTERNET.",
      "SOLVING MATH.",
      "ADVANCING SCIENCE.",
      "BUILDING AGENTS.",
    ]) {
      let attempts = 0;
      while (
        (screen.queryByRole("heading", { name: `MAKE MONEY ${action}` }) ===
          null ||
          visibleAction() !== action) &&
        attempts < 100
      ) {
        act(() => vi.advanceTimersToNextTimer());
        attempts += 1;
      }
      expect(
        screen.getByRole("heading", { name: `MAKE MONEY ${action}` }),
      ).toBeInTheDocument();
      expect(visibleAction()).toBe(action);
    }
  }, 8_000);

  it("keeps the first hero statement fixed when reduced motion is requested", () => {
    vi.useFakeTimers();
    mockSnapshot();
    render(<App />);

    act(() => vi.advanceTimersByTime(28_000));
    expect(
      screen.getByRole("heading", { name: "MAKE MONEY SHIPPING SLOP." }),
    ).toBeInTheDocument();
  });

  it("renders malformed public data as an error and retries explicitly", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ schemaVersion: "forged" }));
    render(<App />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Live totals unavailable",
    );
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
  });

  it("rejects a declared snapshot larger than the browser safety limit", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/data/cycles/")) {
        return Response.json(cycleIndexFixture());
      }
      return new Response("{}", {
        headers: {
          "content-length": String(32 * 1024 * 1024 + 1),
          "content-type": "application/json",
        },
      });
    });
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "snapshot exceeded the 33554432-byte limit",
    );
  });

  it("keeps historical-only contributors on the global leaderboard", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      Response.json(
        String(input).includes("/data/cycles/")
          ? archivedPaidCycleIndex()
          : snapshotFixture(),
      ),
    );
    render(<App />);

    fireEvent.click(
      await screen.findByRole("tab", { name: "All-time record" }),
    );
    const contributor = await screen.findByText("archive-only");
    const row = contributor.closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("7");
    expect(row).toHaveTextContent("$1");
  });

  it("ranks accepted prior-month work when the active project cycle has moved on", async () => {
    mockSnapshot(augustRollingSnapshot());
    render(<App />);

    fireEvent.click(
      await screen.findByRole("tab", { name: "All-time record" }),
    );
    const contributor = await screen.findByText("finish-line");
    const row = contributor.closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("34");
    expect(row).toHaveTextContent("2 scored cycles");
  });
});

describe("project routes", () => {
  it("renders an Eliza-only leaderboard and authenticated one-command installer", async () => {
    route("/projects/eliza");
    mockSnapshot();
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Make money building agents.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("building agents.")).toHaveClass(
      "project-headline-action",
    );
    expect(screen.getByRole("link", { name: /^Home$/u })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.queryByRole("link", { name: /Start in one command/u }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /View cycle/u }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /View in GitHub/u }),
    ).toHaveAttribute("href", "https://github.com/elizaOS/eliza");
    expect(
      screen.getByRole("link", { name: /View in SlopHub/u }),
    ).toHaveAttribute("href", "https://git.slop.cash/elizaOS/eliza");
    expect(
      screen.queryByText("1% platform fee · Solana"),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText("$10,000", { exact: true }).length,
    ).toBeGreaterThan(0);
    expect(
      screen
        .getByText("MONTHLY POOL")
        .closest("aside")
        ?.querySelector(".reward-amount-monthly"),
    ).toHaveTextContent("$10,000");
    expect(
      screen.queryByText("simulated monthly pool"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("scored contributors")).not.toBeInTheDocument();
    expect(screen.queryByText("accepted outcomes")).not.toBeInTheDocument();
    expect(screen.getAllByText("24").length).toBeGreaterThan(0);
    const prompt = screen.getByLabelText("Agent prompt");
    expect(prompt).toHaveTextContent(`${window.location.origin}/SKILL.md`);
    expect(prompt).toHaveTextContent("contribute to github.com/elizaOS/eliza");
    expect(prompt).not.toHaveTextContent(
      "Before installing anything or reading local usage",
    );
    expect(screen.getByText(/Any model can join/u)).toBeInTheDocument();
    expect(
      screen.queryByText(/One prompt handles the contribution/u),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Payout setup uses a GitHub wallet claim/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Solana public address"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/GitHub profile README/u),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Outcome score leads/u)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/GitHub ledger \+ reward records live/u),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/^Updated /u)).toBeInTheDocument();
    expect(
      screen.queryByText(/receipt-linked tokens/u),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Manual install command")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy agent prompt" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        prompt.textContent,
      ),
    );

    fireEvent.click(screen.getByText("Advanced options"));
    const command = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Manual install command",
    });
    expect(command.value).toContain(
      `python3 - '${window.location.origin}/projects/eliza'`,
    );
    expect(command.value).toContain("skills/contribute-to-eliza");
    expect(
      screen.getByRole("link", { name: /Preview the complete workflow/u }),
    ).toHaveAttribute(
      "href",
      `${window.location.origin}/projects/eliza/mission.md`,
    );
    expect(screen.queryByText("Live from GitHub")).not.toBeInTheDocument();
    expect(
      screen.queryByText("How credit survives review"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy manual install command" }),
    );
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2),
    );
  });

  it("never turns Delta Star's external share into a platform payout", async () => {
    route("/projects/delta-star");
    mockSnapshot();
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Make money solving math." }),
    ).toBeInTheDocument();
    expect(screen.getByText("EXTERNAL OPPORTUNITY")).toBeInTheDocument();
    expect(
      screen.getByText("No platform pool · no dollar projection"),
    ).toBeInTheDocument();
    expect(screen.getByText("100.00% share")).toBeInTheDocument();
    expect(
      screen.getByText(/The prize sponsor controls eligibility and payment/i),
    ).toBeInTheDocument();
  });
});

describe("public records", () => {
  it("keeps rolling-window contributors reachable outside the active cycle", async () => {
    route("/contributors/finish-line");
    mockSnapshot(augustRollingSnapshot());
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "finish-line" }),
    ).toBeInTheDocument();
    const totals = document.querySelector(".profile-totals");
    expect(totals).not.toBeNull();
    expect(totals).toHaveTextContent("34recorded score");
    expect(screen.getByText("Harden the ark manifest loader")).toBeVisible();
  });

  it("shows a contributor's cross-project score, tokens, projections, and evidence", async () => {
    route("/contributors/finish-line");
    mockSnapshot();
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "finish-line" }),
    ).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getAllByText("$10,000").length).toBeGreaterThan(0);
    expect(screen.getByText("Eliza")).toBeInTheDocument();
    expect(screen.getByText("Delta Star")).toBeInTheDocument();
    expect(
      screen.getAllByText("Ship the public contribution ledger", {
        exact: false,
      }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "Open work" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add verified screenshot, video, or log evidence before merge.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/2026-07 scoring ·/).length).toBeGreaterThan(0);
    expect(screen.getByText(/\+6 if it verifies/)).toBeInTheDocument();
  });

  it("shows opportunity-only contributors that have still-open guidance", async () => {
    route("/contributors/open-only");
    const snapshot = snapshotFixture();
    const openOnly: (typeof snapshot.leaders)[number]["actor"] = {
      id: "U_open_only",
      login: "open-only",
      avatarUrl: "https://avatars.githubusercontent.com/u/99?v=4",
      url: "https://github.com/open-only",
      kind: "User",
    };
    snapshot.opportunities = [
      {
        id: "PR_open_only:opportunity:partial-evidence",
        actor: openOnly,
        kind: "partial-evidence",
        category: "evidence",
        potentialPoints: 4,
        occurredAt: "2026-07-29T18:00:00.000Z",
        repository: "elizaOS/eliza",
        source: {
          id: "PR_open_only",
          kind: "pull-request",
          number: 17399,
          title: "Open-only checklist",
          url: "https://github.com/elizaOS/eliza/pull/17399",
        },
        reason:
          "Open pull request evidence is partial with 2 of 6 points verified.",
        hint: "Finish verified evidence categories before merge.",
      },
    ];
    snapshot.workQueue.pullRequests[0] = {
      ...snapshot.workQueue.pullRequests[0],
      id: "PR_open_only",
      number: 17399,
      title: "Open-only checklist",
      url: "https://github.com/elizaOS/eliza/pull/17399",
      author: openOnly,
    };
    mockSnapshot(snapshot);
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "open-only" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Open work" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Finish verified evidence categories before merge."),
    ).toBeInTheDocument();
  });

  it("hides the opportunity section when the contributor has none", async () => {
    route("/contributors/finish-line");
    const emptyOpportunities = snapshotFixture();
    emptyOpportunities.opportunities = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      Response.json(
        String(input).includes("/data/cycles/")
          ? cycleIndexFixture()
          : emptyOpportunities,
      ),
    );
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "finish-line" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Open work",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps at most five still-open opportunities on a profile", async () => {
    route("/contributors/finish-line");
    const crowded = snapshotFixture();
    const actor = crowded.leaders[0].actor;
    crowded.opportunities = Array.from({ length: 7 }, (_, index) => {
      const number = 18000 + index;
      return {
        id: `PR_crowd_${number}:opportunity:missing-evidence`,
        actor,
        kind: "missing-evidence" as const,
        category: "evidence" as const,
        potentialPoints: 6,
        occurredAt: `2026-07-${String(29 - index).padStart(2, "0")}T12:00:00.000Z`,
        repository: "elizaOS/eliza" as const,
        source: {
          id: `PR_crowd_${number}`,
          kind: "pull-request" as const,
          number,
          title: `Open checklist ${number}`,
          url: `https://github.com/elizaOS/eliza/pull/${number}`,
        },
        reason:
          "Open pull request evidence is missing with 0 of 6 points verified.",
        hint: "Add verified screenshot, video, or log evidence before merge.",
      };
    });
    crowded.workQueue.pullRequests = crowded.opportunities.map(
      (opportunity) => ({
        ...crowded.workQueue.pullRequests[0],
        id: opportunity.source.id,
        number: opportunity.source.number,
        title: opportunity.source.title,
        url: opportunity.source.url,
      }),
    );
    crowded.workQueue.pullRequests.sort(
      (left, right) => right.number - left.number,
    );
    crowded.source.counts.openPullRequests =
      crowded.workQueue.pullRequests.length;
    mockSnapshot(crowded);
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Open work",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/\+6 if it verifies/)).toHaveLength(5);
    expect(screen.getByText(/Open checklist 18000/)).toBeInTheDocument();
    expect(screen.queryByText(/Open checklist 18005/)).not.toBeInTheDocument();
  });

  it("shows an immutable public payout wallet on an archived profile", async () => {
    route("/contributors/archive-only");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      Response.json(
        String(input).includes("/data/cycles/")
          ? archivedPaidCycleIndex()
          : snapshotFixture(),
      ),
    );
    render(<App />);

    const wallet = await screen.findByRole("link", {
      name: /GitHub wallet claim · 11111111111111111111111111111111/i,
    });
    expect(wallet).toHaveAttribute("href", expect.stringContaining("/blob/"));
  });

  it("shows review stages and the cycle leaderboard without duplicate evidence", async () => {
    route("/cycles/eliza/2026-07");
    mockSnapshot();
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Eliza · 2026-07" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Settlement")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "July 2026 leaderboard." }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cycle evidence.")).not.toBeInTheDocument();
  });

  it("renders a zero-award month as closed instead of payment-ready", async () => {
    route("/cycles/eliza/2026-06");
    const index = archivedPaidCycleIndex();
    const [cycle] = index.cycles;
    cycle.state = "closed-no-awards";
    cycle.approvedAt = null;
    cycle.settledAt = null;
    cycle.reward = {
      ...cycle.reward,
      suggestedMinor: "0",
      approvedMinor: "0",
      paidMinor: "0",
      feeMinor: "0",
    };
    cycle.contributors = [];
    cycle.files = {
      ...cycle.files,
      allocation: null,
      executionPlan: null,
      settlement: null,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      Response.json(
        String(input).includes("/data/cycles/") ? index : snapshotFixture(),
      ),
    );
    render(<App />);

    expect(await screen.findByText(/closed no awards/u)).toBeInTheDocument();
    expect(
      screen.getByText("This cycle closed with no accepted awards."),
    ).toBeInTheDocument();
  });
});

describe("project proposals", () => {
  it("generates a public manifest and a GitHub new-file handoff without login state", async () => {
    route("/projects/new");
    mockSnapshot();
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: "Add a project.",
      }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Open Protein" },
    });
    fireEvent.change(screen.getByLabelText("Public GitHub repository"), {
      target: { value: "example/open-protein" },
    });
    fireEvent.change(screen.getByLabelText("Money-forward headline"), {
      target: { value: "Make money proving proteins fold." },
    });
    fireEvent.change(screen.getByLabelText("Goal"), {
      target: { value: "Make protein research reproducible." },
    });
    fireEvent.change(screen.getByLabelText("Acceptance criteria"), {
      target: { value: "Accepted pull requests with verified tests." },
    });
    fireEvent.change(
      screen.getByLabelText("Maximum monthly pool, digital dollars"),
      {
        target: { value: "2500" },
      },
    );

    const handoff = screen.getByRole("link", { name: /continue on github/i });
    expect(handoff).toHaveAttribute(
      "href",
      expect.stringContaining("github.com/elizaOS/slopdotcash/new/develop"),
    );
    expect(handoff).toHaveAttribute(
      "href",
      expect.stringContaining("projects%2Fopen-protein%2Fproject.json"),
    );
    expect(
      screen.getByText(/"monthlyCapMinor": "2500000000"/),
    ).toBeInTheDocument();
    expect(screen.getByText(/"mode": "open"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /copy json/i }));
    await act(async () => Promise.resolve());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"id": "open-protein"'),
    );
    fireEvent.click(screen.getByRole("button", { name: /copy agent brief/i }));
    await act(async () => Promise.resolve());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("skills/review-eliza-contributions"),
    );
  });

  it("does not hand off an over-limit or imprecise money pool", () => {
    route("/projects/new");
    mockSnapshot();
    render(<App />);
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Unsafe Pool" },
    });
    fireEvent.change(screen.getByLabelText("Public GitHub repository"), {
      target: { value: "example/unsafe-pool" },
    });
    fireEvent.change(screen.getByLabelText("Money-forward headline"), {
      target: { value: "Make money doing exact work." },
    });
    fireEvent.change(screen.getByLabelText("Goal"), {
      target: { value: "Make exact work public." },
    });
    fireEvent.change(screen.getByLabelText("Acceptance criteria"), {
      target: { value: "Accepted pull requests only." },
    });
    fireEvent.change(
      screen.getByLabelText("Maximum monthly pool, digital dollars"),
      { target: { value: "1000000000.01" } },
    );

    expect(
      screen.getByRole("button", { name: /continue on github/i }),
    ).toBeDisabled();
  });
});

describe("project owner workspace", () => {
  it("lets an owner set zero or larger allocations and calculates the exact payout fee", async () => {
    route("/projects/eliza/manage");
    const index = archivedPaidCycleIndex();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      Response.json(
        String(input).includes("/data/cycles/") ? index : snapshotFixture(),
      ),
    );
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Run Eliza." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign payout unavailable" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: /View unsigned plan/u }),
    ).toHaveAttribute("href", expect.stringContaining("execution-plan.json"));
    expect(
      screen.getByText(/remains unpaid until finalized USDC deltas/u),
    ).toBeInTheDocument();
    const amount = screen.getByLabelText("archive-only amount in USDC");
    const total = screen.getByLabelText("Total payout, USDC");
    const reason = screen.getByLabelText("archive-only reason");

    fireEvent.change(amount, { target: { value: "0" } });
    fireEvent.change(total, { target: { value: "0" } });
    fireEvent.change(reason, { target: { value: "Creator decision" } });
    expect(
      screen.getByRole("button", { name: "Copy allocation draft" }),
    ).toBeEnabled();

    fireEvent.change(amount, { target: { value: "12.345678" } });
    fireEvent.change(total, { target: { value: "12.345678" } });
    expect(screen.getByText("$0.12 fee")).toBeInTheDocument();
    expect(screen.getByText("$12.47 total debit")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy allocation draft" }),
    );
    await act(async () => Promise.resolve());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"approvedMinor": "12345678"'),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"feeMinor": "123456"'),
    );
  });

  it("shows project payment history without exposing trace contents", async () => {
    route("/projects/eliza");
    const index = archivedPaidCycleIndex();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      Response.json(
        String(input).includes("/data/cycles/") ? index : snapshotFixture(),
      ),
    );
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Payment history" }),
    ).toBeInTheDocument();
    expect(screen.getByText("$1 paid")).toBeInTheDocument();
    expect(screen.getByText("$0.01 in 1% payout fees")).toBeInTheDocument();
    expect(
      screen.getByText(/only Slop operators can access its contents/u),
    ).toBeInTheDocument();
    expect(screen.queryByText(/raw prompt/u)).not.toBeInTheDocument();
  });
});
