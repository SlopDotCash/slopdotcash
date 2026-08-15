/* biome-ignore-all lint/a11y/noNoninteractiveTabindex: Narrow slides can scroll and must remain keyboard-accessible. */
import {
  ArrowLeft,
  ArrowRight,
  Check,
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
    document.title = "Slop — fund progress, own the upside";
    const values: Record<string, string> = {
      'meta[name="description"]':
        "Slop turns capital and compute into verified open-source progress.",
      'meta[property="og:title"]': "Fund progress. Own the upside.",
      'meta[property="og:description"]':
        "The fundraising deck for slop.cash — the incentive network for open progress.",
      'meta[property="og:image"]': "https://deck.slop.cash/og-deck-v2.png",
      'meta[name="twitter:title"]': "Fund progress. Own the upside.",
      'meta[name="twitter:description"]':
        "The fundraising deck for slop.cash — the incentive network for open progress.",
      'meta[name="twitter:image"]': "https://deck.slop.cash/og-deck-v2.png",
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
      label="Fund progress and own the upside"
      className="deck-cover"
    >
      <div className="deck-cover-copy">
        <h1 aria-label="Fund progress. Own the upside.">
          Fund progress.
          <br />
          <em>Own the upside.</em>
        </h1>
        <p>
          Slop is the incentive network that turns capital and compute into
          verified open work.
        </p>
      </div>
      <div className="deck-cover-network" aria-hidden="true">
        {["capital", "compute", "people", "agents", "progress"].map(
          (item, index) => (
            <span key={item} style={{ "--i": index } as CSSProperties}>
              {item}
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
  ["Shadow", "Head of partnerships"],
  ["Sayo", "Founding engineer"],
  ["Stan", "Founding engineer"],
];

function Team() {
  return (
    <Frame index={1} label="The team behind Slop" className="deck-team">
      <div>
        <h2>We know how to make open source move.</h2>
        <p className="deck-supporting">
          The team behind elizaOS is building the incentive layer for what comes
          next.
        </p>
      </div>
      <div className="deck-team-proof">
        <div className="deck-team-stats">
          <p>
            <strong>19K</strong>
            <span>stars</span>
          </p>
          <p>
            <strong>5.6K</strong>
            <span>forks</span>
          </p>
          <p>
            <strong>671</strong>
            <span>contributors</span>
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
        <div>
          <span>Open work</span>
          <span>Shared upside</span>
          <span>Collective ownership</span>
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
      title: "Start with trust.",
      copy: "Help well-known builders with specific work in their open-source repos.",
    },
    {
      icon: <Cpu aria-hidden="true" />,
      title: "Turn compute into sponsorship.",
      copy: "Providers allocate resources. Projects give them visible proof of impact.",
    },
    {
      icon: <Megaphone aria-hidden="true" />,
      title: "Make useful work the ad.",
      copy: "Sponsors fund public challenges that earn attention by creating value.",
    },
  ];
  return (
    <Frame
      index={4}
      label="Go to market through trusted open source"
      className="deck-gtm"
    >
      <div>
        <h2>Start with people the world already trusts.</h2>
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
        Every accepted result becomes the proof that wins the next project.
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
    ["12 mo", "50", "$5M", "$0.5M"],
    ["24 mo", "200", "$25M", "$2M"],
    ["36 mo", "500", "$75M", "$5M"],
  ];
  return (
    <Frame
      index={7}
      label="Revenue and token economics"
      className="deck-economics"
    >
      <div className="deck-economics-top">
        <div>
          <h2>Every payout makes the network stronger.</h2>
          <div className="deck-revenue-chips">
            <span>Planned 1% payout fee</span>
            <span>Collaborations</span>
            <span>Features</span>
            <span>Sponsors</span>
          </div>
        </div>
        <div className="deck-fee-example">
          <strong>$100</strong>
          <span>payout</span>
          <b>→</b>
          <strong>$1</strong>
          <span>fee</span>
        </div>
        <div className="deck-token-split">
          <article>
            <strong>⅓</strong>
            <span>$SLOP buybacks</span>
          </article>
          <article>
            <strong>⅓</strong>
            <span>team</span>
          </article>
          <article>
            <strong>⅓</strong>
            <span>new incentives</span>
          </article>
        </div>
      </div>
      <div className="deck-projections">
        <div className="deck-projection-labels">
          <span>Projects</span>
          <span>Annual payouts</span>
          <span>Projected revenue</span>
        </div>
        {projections.map(([period, projects, payouts, revenue]) => (
          <article key={period}>
            <span>{period}</span>
            <strong>{projects}</strong>
            <strong>{payouts}</strong>
            <strong>{revenue}</strong>
          </article>
        ))}
        <small>
          Illustrative operating model including sponsorship, collaboration, and
          feature revenue—not historical results. $SLOP design is proposed and
          subject to final legal review.
        </small>
      </div>
    </Frame>
  );
}

function Raise() {
  const allocation = [
    ["75%", "$375K", "Bounties + incentives"],
    ["10%", "$50K", "Core team"],
    ["10%", "$50K", "Partnership launches"],
    ["5%", "$25K", "Protocol, legal + security"],
  ];
  return (
    <Frame index={8} label="A 500 thousand dollar raise" className="deck-raise">
      <div className="deck-raise-heading">
        <h2>
          <em>$500K</em> turns the flywheel for 18 months.
        </h2>
        <p>Every dollar exists to create more useful work.</p>
      </div>
      <div className="deck-allocation-bar">
        {allocation.map(([percent, amount, label], index) => (
          <article
            key={label}
            style={
              {
                "--weight": index === 0 ? 7.5 : index === 3 ? 0.5 : 1,
              } as CSSProperties
            }
          >
            <span>{percent}</span>
            <strong>{amount}</strong>
            <p>{label}</p>
          </article>
        ))}
      </div>
      <div className="deck-raise-targets">
        <p>
          <Check aria-hidden="true" />
          50 funded projects
        </p>
        <p>
          <Check aria-hidden="true" />
          $5M annual payout volume
        </p>
        <p>
          <Check aria-hidden="true" />A repeatable sponsor engine
        </p>
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
