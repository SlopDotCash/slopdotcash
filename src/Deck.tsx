/* biome-ignore-all lint/a11y/noNoninteractiveTabindex: Narrow slides can scroll and must remain keyboard-accessible. */
import {
  ArrowLeft,
  ArrowRight,
  Cpu,
  GitBranch,
  Megaphone,
  Users,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./deck.css";

const SLIDE_COUNT = 10;
function initialSlide(): number {
  const parsed = Number.parseInt(window.location.hash.slice(1), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= SLIDE_COUNT
    ? parsed - 1
    : 0;
}

function Meta() {
  useEffect(() => {
    document.title = "Slop — make money shipping slop";
    const values: Record<string, string> = {
      'meta[name="description"]':
        "Slop turns capital and compute into verified open-source progress.",
      'meta[property="og:title"]': "MAKE MONEY SHIPPING SLOP.",
      'meta[property="og:description"]':
        "The fundraising deck for slop.cash — the incentive network for open progress.",
      'meta[property="og:image"]':
        "https://deck.slop.cash/og-shipping-slop.png",
      'meta[name="twitter:title"]': "MAKE MONEY SHIPPING SLOP.",
      'meta[name="twitter:description"]':
        "The fundraising deck for slop.cash — the incentive network for open progress.",
      'meta[name="twitter:image"]':
        "https://deck.slop.cash/og-shipping-slop.png",
    };
    for (const [selector, content] of Object.entries(values)) {
      document
        .querySelector<HTMLMetaElement>(selector)
        ?.setAttribute("content", content);
    }
    document
      .querySelector<HTMLLinkElement>('link[rel="canonical"]')
      ?.setAttribute("href", "https://deck.slop.cash/");
  }, []);
  return null;
}

function Frame({
  children,
  className = "",
  index,
  label,
}: {
  children: ReactNode;
  className?: string;
  index: number;
  label: string;
}) {
  return (
    <section
      className={`deck-slide ${className}`}
      aria-label={`${index + 1} of ${SLIDE_COUNT}: ${label}`}
      tabIndex={0}
    >
      <div className="deck-kicker">
        <img src="/slop-mark.svg" alt="" />
        <span>slop.cash</span>
      </div>
      {children}
    </section>
  );
}

function Cover() {
  return (
    <Frame
      index={0}
      label="Make money shipping slop and building the future"
      className="deck-cover"
    >
      <div className="deck-cover-copy">
        <h1 aria-label="MAKE MONEY SHIPPING SLOP.">
          <span className="deck-cover-prefix">MAKE MONEY</span>
          <em className="deck-cover-action">SHIPPING SLOP.</em>
        </h1>
        <p>
          <strong className="deck-cover-brand">Slop.cash</strong> is the
          incentive network that turns capital and compute into verified open
          work.
        </p>
      </div>
      <div className="deck-cover-network" aria-hidden="true">
        {["capital", "compute", "people", "agents", "progress"].map(
          (item, index) => (
            <span key={item} style={{ "--i": index } as CSSProperties}>
              <b className="deck-orbit-label">{item}</b>
            </span>
          ),
        )}
        <strong>S</strong>
      </div>
    </Frame>
  );
}

const team = [
  ["Shaw", "CEO"],
  ["Nubs", "CTO"],
];

function Team() {
  return (
    <Frame
      index={1}
      label="Two builders with 25 thousand GitHub stars"
      className="deck-team"
    >
      <div>
        <h2>Two builders. 25K+ GitHub stars.</h2>
        <p className="deck-supporting">
          Shaw and Nubs have built open-source projects used and followed by
          thousands of developers.
        </p>
      </div>
      <div className="deck-team-proof">
        <div className="deck-team-stats">
          <p>
            <strong>25K+</strong>
            <span>GitHub stars across projects</span>
          </p>
        </div>
        <div className="deck-team-list">
          {team.map(([name, role], index) => (
            <article key={name}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{name}</strong>
              <small>{role}</small>
            </article>
          ))}
        </div>
      </div>
    </Frame>
  );
}

function Mission() {
  return (
    <Frame
      index={2}
      label="Progress should belong to everyone"
      className="deck-mission"
    >
      <div className="deck-mission-ring" aria-hidden="true">
        <span>everyone</span>
      </div>
      <div className="deck-mission-copy">
        <h2>Progress should belong to everyone.</h2>
        <p>
          Use decentralized compute to accelerate humanity—without concentrating
          the value in a handful of companies.
        </p>
        <div className="deck-mission-examples">
          <article>
            <strong>$1M Proximity Prize</strong>
            <span>
              A major conjecture. A prize split fairly by contribution.
            </span>
          </article>
          <article>
            <strong>ASI continual learning</strong>
            <span>Novel IP built together—and owned collectively.</span>
          </article>
        </div>
      </div>
    </Frame>
  );
}

function Flywheel() {
  const stages = [
    "Capital + compute",
    "Incentives",
    "People + agents",
    "Verified results",
    "Shared value",
  ];
  return (
    <Frame
      index={3}
      label="Capital in and breakthroughs out"
      className="deck-flywheel-slide"
    >
      <div className="deck-flywheel-copy">
        <h2>
          Capital in.
          <br />
          <em>Breakthroughs out.</em>
        </h2>
        <p>
          Projects publish valuable work. People and agents compete to solve it.
          Maintainers verify the result. Contributors get paid.
        </p>
      </div>
      <div className="deck-flywheel" role="img" aria-label={stages.join(", ")}>
        {stages.map((stage, index) => (
          <span key={stage} style={{ "--i": index } as CSSProperties}>
            {stage}
          </span>
        ))}
        <strong>↻</strong>
      </div>
    </Frame>
  );
}

function GoToMarket() {
  const channels = [
    {
      icon: <Users aria-hidden="true" />,
      title: "Hack traction.",
      copy: "Turn open projects like Extropic’s THRML + torx into public, fundable work.",
    },
    {
      icon: <Cpu aria-hidden="true" />,
      title: "Align the supporters.",
      copy: "Match sponsors like Sapiom—capital, compute, and distribution—to the builder’s goals.",
    },
    {
      icon: <Megaphone aria-hidden="true" />,
      title: "Make support one click.",
      copy: "Give anyone a simple path to donate, fund a task, or sponsor an outcome.",
    },
  ];
  return (
    <Frame
      index={4}
      label="Go to market through trusted open source"
      className="deck-gtm"
    >
      <div>
        <h2>
          Find the people building the future.{" "}
          <em>Accelerate the shit out of their work.</em>
        </h2>
      </div>
      <div className="deck-gtm-grid">
        {channels.map(({ icon, title, copy }, index) => (
          <article key={title}>
            <span>0{index + 1}</span>
            {icon}
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
      <p className="deck-gtm-loop">
        Visible progress → attention → sponsor proof → more progress.
      </p>
    </Frame>
  );
}

function Ownership() {
  const modes = [
    [
      "Project-owned",
      "The creator sets assignment or license terms before work starts.",
    ],
    [
      "Collectively owned",
      "Proximity Prize results enter the commons; the prize is shared by contribution.",
    ],
    ["DAO-owned", "ASI work becomes intellectual property of the DAO."],
  ];
  return (
    <Frame
      index={5}
      label="Ownership follows published project rules"
      className="deck-ownership"
    >
      <div>
        <h2>The ownership rules are clear before the work begins.</h2>
        <p className="deck-supporting">
          One network. Different ways to own the result.
        </p>
      </div>
      <div className="deck-ownership-modes">
        {modes.map(([title, copy], index) => (
          <article key={title}>
            <i aria-hidden="true">
              {index === 0 ? "●" : index === 1 ? "◉" : "◎"}
            </i>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </Frame>
  );
}

function Competition() {
  const competitors = [
    ["Gitcoin", "Grant rounds"],
    ["OnlyDust", "Fellowships + grants"],
    ["Algora", "Bounties + hiring"],
    ["Drips", "Funding flows"],
  ];
  return (
    <Frame
      index={6}
      label="Slop in the open-source funding market"
      className="deck-competition"
    >
      <div>
        <h2>
          Funding is crowded.
          <br />
          <em>Verified, agent-native work is not.</em>
        </h2>
      </div>
      <div className="deck-competition-map">
        <div className="deck-competitor-row">
          {competitors.map(([name, focus]) => (
            <article key={name}>
              <strong>{name}</strong>
              <span>{focus}</span>
            </article>
          ))}
        </div>
        <div className="deck-slop-position">
          <strong>SLOP</strong>
          <p>Outcome-level verification</p>
          <p>People + agents</p>
          <p>Compute sponsorships</p>
          <p>Explicit ownership modes</p>
        </div>
      </div>
    </Frame>
  );
}

function Economics() {
  const projections = [
    ["Year 1", "$2M", "$100K", "−$150K"],
    ["Year 2", "$10M", "$400K", "+$50K"],
    ["Year 3", "$30M", "$1.0M", "+$400K"],
  ];
  return (
    <Frame
      index={7}
      label="Revenue and token economics"
      className="deck-economics"
    >
      <div className="deck-economics-heading">
        <h2>A realistic path to profit.</h2>
        <p>
          Base case: a 3% payout fee plus sponsor programs, collaborations, and
          paid features.
        </p>
      </div>
      <div className="deck-economics-model">
        <div
          className="deck-profit-chart"
          role="img"
          aria-label="Projected annual profit rises from negative 150 thousand dollars in year one to positive 50 thousand dollars in year two and positive 400 thousand dollars in year three"
        >
          <span className="deck-chart-zero">$0</span>
          <i aria-hidden="true" />
          <svg viewBox="0 0 800 360" aria-hidden="true">
            <path
              className="deck-chart-area"
              d="M60 286 C180 286 260 198 390 190 S610 82 740 40 L740 190 L60 190 Z"
            />
            <path
              className="deck-chart-line"
              d="M60 286 C180 286 260 198 390 190 S610 82 740 40"
            />
            <circle cx="60" cy="286" r="8" />
            <circle cx="390" cy="190" r="8" />
            <circle cx="740" cy="40" r="8" />
          </svg>
          <strong className="deck-chart-label deck-chart-label-one">
            −$150K
          </strong>
          <strong className="deck-chart-label deck-chart-label-two">
            +$50K
          </strong>
          <strong className="deck-chart-label deck-chart-label-three">
            +$400K
          </strong>
          <span className="deck-chart-year deck-chart-year-one">Y1</span>
          <span className="deck-chart-year deck-chart-year-two">Y2</span>
          <span className="deck-chart-year deck-chart-year-three">Y3</span>
        </div>
        <div className="deck-projections">
          <div className="deck-projection-labels">
            <span>Payout volume</span>
            <span>Revenue</span>
            <span>Profit</span>
          </div>
          {projections.map(([period, payouts, revenue, profit]) => (
            <article key={period}>
              <span>{period}</span>
              <strong>{payouts}</strong>
              <strong>{revenue}</strong>
              <strong>{profit}</strong>
            </article>
          ))}
          <small>
            Illustrative base case, not historical results. Planned 3% fee: ⅓
            $SLOP buybacks · ⅓ team · ⅓ bounties and incentives.
          </small>
        </div>
      </div>
    </Frame>
  );
}

function Raise() {
  const allocation = [
    ["40%", "$100K", "Team"],
    ["30%", "$75K", "Bounties + incentives"],
    ["20%", "$50K", "Marketing"],
    ["10%", "$25K", "Legal"],
  ];
  return (
    <Frame index={8} label="A 250 thousand dollar raise" className="deck-raise">
      <div className="deck-raise-heading">
        <h2>
          We need <em>$250K</em> to change the world.
        </h2>
      </div>
      <div className="deck-allocation-bar">
        {allocation.map(([percent, amount, label]) => (
          <article
            key={label}
            style={
              {
                "--weight": Number.parseInt(percent, 10),
              } as CSSProperties
            }
          >
            <span>{percent}</span>
            <strong>{amount}</strong>
            <p>{label}</p>
          </article>
        ))}
      </div>
    </Frame>
  );
}

function Close() {
  return (
    <Frame index={9} label="We own the results together" className="deck-close">
      <div className="deck-close-mark" aria-hidden="true">
        <GitBranch />
      </div>
      <h2>
        We own the results <em>together.</em>
      </h2>
      <p>Fund the people, agents, and compute accelerating open progress.</p>
      <div className="deck-close-links">
        <a href="https://slop.cash" target="_blank" rel="noreferrer">
          slop.cash <ArrowRight aria-hidden="true" />
        </a>
        <a href="mailto:shaw@elizalabs.ai">shaw@elizalabs.ai</a>
      </div>
    </Frame>
  );
}

const slides = [
  <Cover key="cover" />,
  <Team key="team" />,
  <Mission key="mission" />,
  <Flywheel key="flywheel" />,
  <GoToMarket key="gtm" />,
  <Ownership key="ownership" />,
  <Competition key="competition" />,
  <Economics key="economics" />,
  <Raise key="raise" />,
  <Close key="close" />,
];

export function Deck() {
  const [slide, setSlide] = useState(initialSlide);
  const touchStart = useRef<number | null>(null);
  const go = useCallback((next: number) => {
    const bounded = Math.max(0, Math.min(SLIDE_COUNT - 1, next));
    setSlide(bounded);
    window.history.replaceState(null, "", `#${bounded + 1}`);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        setSlide((current) => {
          const next = Math.min(SLIDE_COUNT - 1, current + 1);
          window.history.replaceState(null, "", `#${next + 1}`);
          return next;
        });
      } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        setSlide((current) => {
          const next = Math.max(0, current - 1);
          window.history.replaceState(null, "", `#${next + 1}`);
          return next;
        });
      } else if (event.key === "Home") {
        event.preventDefault();
        go(0);
      } else if (event.key === "End") {
        event.preventDefault();
        go(SLIDE_COUNT - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go]);

  return (
    <main
      className="deck"
      aria-label="Slop fundraising deck"
      onTouchStart={(event) => {
        touchStart.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        if (touchStart.current === null) return;
        const distance =
          (event.changedTouches[0]?.clientX ?? touchStart.current) -
          touchStart.current;
        if (Math.abs(distance) > 48) go(slide + (distance < 0 ? 1 : -1));
        touchStart.current = null;
      }}
    >
      <Meta />
      <div className="deck-stage" key={slide}>
        {slides[slide]}
      </div>
      <div className="deck-progress" aria-hidden="true">
        <i style={{ width: `${((slide + 1) / SLIDE_COUNT) * 100}%` }} />
      </div>
      <nav className="deck-nav" aria-label="Slide navigation">
        <button
          type="button"
          disabled={slide === 0}
          onClick={() => go(slide - 1)}
          aria-label="Previous slide"
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <span aria-live="polite">
          {slide + 1} / {SLIDE_COUNT}
        </span>
        <button
          type="button"
          disabled={slide === SLIDE_COUNT - 1}
          onClick={() => go(slide + 1)}
          aria-label="Next slide"
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </nav>
    </main>
  );
}
