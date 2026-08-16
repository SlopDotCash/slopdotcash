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

function Team() {
  const leads = [
    {
      name: "Shaw",
      role: "CEO",
      x: "https://x.com/shawmakesmagic",
      github: "https://github.com/lalalune",
      portrait: "https://deck.eliza.app/team_shaw.jpg",
      contributions: "https://deck.eliza.app/github_lalalune.svg",
    },
    {
      name: "Nubs",
      role: "CTO",
      x: "https://x.com/nubsvault",
      github: "https://github.com/NubsCarson",
      portrait: "https://deck.eliza.app/team_nubs.jpg",
      contributions: "https://deck.eliza.app/github_nubscarson.svg",
    },
  ];
  return (
    <Frame index={1} label="The builders behind Slop" className="deck-team">
      <h2>We built a movement in open source.</h2>
      <div className="deck-team-leads">
        {leads.map((lead) => (
          <article className="deck-team-lead" key={lead.name}>
            <a
              className="deck-team-avatar"
              href={lead.x}
              target="_blank"
              rel="noreferrer"
              aria-label={`${lead.name} on X`}
            >
              <img src={lead.portrait} alt={lead.name} />
            </a>
            <div className="deck-team-identity">
              <h3>{lead.name}</h3>
              <span>{lead.role}</span>
            </div>
            <a
              className="deck-team-contributions"
              href={lead.github}
              target="_blank"
              rel="noreferrer"
              aria-label={`${lead.name} on GitHub`}
            >
              <img
                src={lead.contributions}
                alt={`${lead.name} GitHub contributions`}
              />
            </a>
          </article>
        ))}
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
            <b className="deck-flywheel-label">{stage}</b>
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
        {channels.map(({ icon, title, copy }) => (
          <article key={title}>
            {icon}
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </Frame>
  );
}

function Ownership() {
  const modes = [
    [
      "Funded by a project",
      "An outside party funds a defined outcome. The project sets the license or assignment.",
    ],
    [
      "Owned together",
      "ASI and similar projects become collective IP governed by the community.",
    ],
    [
      "Won together",
      "The $1M Proximity Prize is shared by contribution—and the result enters the commons.",
    ],
  ];
  return (
    <Frame
      index={5}
      label="Ownership follows published project rules"
      className="deck-ownership"
    >
      <div>
        <h2>There is more than one way to own progress.</h2>
        <p className="deck-supporting">
          Some work serves a sponsor. Some becomes collective IP. Some wins a
          prize we split together.
        </p>
      </div>
      <div className="deck-ownership-modes">
        {modes.map(([title, copy], index) => (
          <article key={title}>
            <i aria-hidden="true">
              {index === 0 ? "●" : index === 1 ? "◉" : "◎"}
            </i>
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
    ["Yukon", "Humans + AI on frontier research"],
    ["OpenSolve", "Agent-run, zero-trust science"],
    ["Gitcoin", "Ecosystem grant allocation"],
    ["LFX", "Maintainer crowdfunding"],
  ];
  return (
    <Frame
      index={6}
      label="Slop in the open-source funding market"
      className="deck-competition"
    >
      <div>
        <h2>
          Open intelligence is becoming a market.
          <br />
          <em>Slop makes the work investable.</em>
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
          <p>Verifiable outcomes across repos</p>
          <p>Humans + agents</p>
          <p>Cash + compute sponsors</p>
          <p>Project, collective, or prize ownership</p>
        </div>
      </div>
    </Frame>
  );
}

function Economics() {
  const projections = [
    ["Year 1", "$2M", "$250K", "$0"],
    ["Year 2", "$8M", "$500K", "+$150K"],
    ["Year 3", "$20M", "$1.0M", "+$500K"],
  ];
  return (
    <Frame
      index={7}
      label="Revenue and token economics"
      className="deck-economics"
    >
      <div className="deck-economics-heading">
        <h2>Break even first. Then compound.</h2>
        <p>
          3% of payouts plus sponsorships, collaborations, and contributed
          compute offset the network’s cost in year one.
        </p>
      </div>
      <div className="deck-economics-model">
        <div
          className="deck-profit-chart"
          role="img"
          aria-label="Projected annual profit starts at break even in year one, then rises to positive 150 thousand dollars in year two and positive 500 thousand dollars in year three"
        >
          <span className="deck-chart-zero">$0</span>
          <i aria-hidden="true" />
          <svg viewBox="0 0 800 360" aria-hidden="true">
            <path
              className="deck-chart-area"
              d="M60 190 C180 190 260 154 390 126 S610 72 740 40 L740 190 Z"
            />
            <path
              className="deck-chart-line"
              d="M60 190 C180 190 260 154 390 126 S610 72 740 40"
            />
            <circle cx="60" cy="190" r="8" />
            <circle cx="390" cy="126" r="8" />
            <circle cx="740" cy="40" r="8" />
          </svg>
          <strong className="deck-chart-label deck-chart-label-one">$0</strong>
          <strong className="deck-chart-label deck-chart-label-two">
            +$150K
          </strong>
          <strong className="deck-chart-label deck-chart-label-three">
            +$500K
          </strong>
          <span className="deck-chart-year deck-chart-year-one">Y1</span>
          <span className="deck-chart-year deck-chart-year-two">Y2</span>
          <span className="deck-chart-year deck-chart-year-three">Y3</span>
        </div>
        <div className="deck-projections">
          <div className="deck-projection-labels">
            <span>Payout volume</span>
            <span>Cash + offsets</span>
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
            Illustrative base case, not historical results. Year one assumes
            $60K from 3% payout fees and $190K from sponsors, collaborations,
            and contributed resources.
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
    <Frame index={9} label="When we build it we own it" className="deck-close">
      <div className="deck-close-mark" aria-hidden="true">
        <GitBranch />
      </div>
      <h2>
        When we build it, <em>we own it.</em>
      </h2>
      <p>Fund the people, agents, and compute accelerating open progress.</p>
      <div className="deck-close-links">
        <a href="https://slop.cash" target="_blank" rel="noreferrer">
          slop.cash <ArrowRight aria-hidden="true" />
        </a>
        <a href="mailto:shawmakesmagic@gmail.com">shawmakesmagic@gmail.com</a>
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
