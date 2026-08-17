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

const SLIDE_COUNT = 9;
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
      mark: "S",
    },
    {
      name: "Nubs",
      role: "CTO",
      x: "https://x.com/nubsvault",
      github: "https://github.com/NubsCarson",
      mark: "N",
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
              <span className="deck-visually-hidden">{lead.name} on X</span>
              <span aria-hidden="true">{lead.mark}</span>
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
              View {lead.name}&apos;s public GitHub profile
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
        <span className="deck-mission-label">In progress</span>
        <div className="deck-mission-examples">
          <article>
            <strong>Eliza</strong>
            <span>MIT licensed open source AI for everyone.</span>
          </article>
          <article>
            <strong>Proximity Prize</strong>
            <span>
              A sponsor-run prize for a major conjecture. Slop publishes
              provisional contribution shares; the sponsor controls payment.
            </span>
          </article>
          <article>
            <strong>“ASI” continual learning</strong>
            <span>
              Continual-learning work with ownership terms published before
              contributions begin.
            </span>
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
          Maintainers verify the result. Reviewed project policy determines
          whether accepted contributors receive rewards.
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
      copy: "Turn reviewed public repositories into transparent contribution programs.",
    },
    {
      icon: <Cpu aria-hidden="true" />,
      title: "Align the supporters.",
      copy: "Match sponsors like Sapiom—capital, compute, and distribution—to the builder’s goals.",
    },
    {
      icon: <Megaphone aria-hidden="true" />,
      title: "Make support one click.",
      copy: "Give supporters a direct path to fund a reviewed project or sponsor an outcome.",
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

function Competition() {
  const competitors = [
    ["Yukon", "Humans + AI on frontier research"],
    ["OpenSolve", "Agent-run, zero-trust science"],
    ["Gitcoin", "Ecosystem grant allocation"],
    ["LFX", "Maintainer crowdfunding"],
  ];
  return (
    <Frame index={5} label="Why Slop is different" className="deck-competition">
      <div>
        <h2>
          Built for open source.
          <br />
          <em>Open to public GitHub projects.</em>
        </h2>
        <p className="deck-supporting">
          Slop starts where the work lives—GitHub—and lets anyone fund verified
          progress.
        </p>
      </div>
      <div className="deck-competition-map">
        <div className="deck-market-context">
          <span>Adjacent models</span>
          {competitors.map(([name, focus]) => (
            <article key={name}>
              <strong>{name}</strong>
              <span>{focus}</span>
            </article>
          ))}
        </div>
        <div className="deck-slop-position">
          <strong>Slop's reviewed scope</strong>
          <p>
            <b>Manifest governed</b>
            <span>
              Each public repository declares its rules before work begins.
            </span>
          </p>
          <p>
            <b>GitHub-native</b>
            <span>Work, proof, and reputation live in the open.</span>
          </p>
          <p>
            <b>Open-source first</b>
            <span>Funding compounds into shared public infrastructure.</span>
          </p>
        </div>
      </div>
    </Frame>
  );
}

function Economics() {
  const projections = [
    ["Scenario 1", "$2M", "1%", "$20K"],
    ["Scenario 2", "$8M", "1%", "$80K"],
    ["Scenario 3", "$20M", "1%", "$200K"],
  ];
  return (
    <Frame
      index={6}
      label="Transparent payout fee scenarios"
      className="deck-economics"
    >
      <div className="deck-economics-heading">
        <h2>Transparent fee math.</h2>
        <p>
          When an enabled monthly pool is actually paid, Slop charges 1% of the
          approved principal. These scenarios show fee revenue only—not profit,
          sponsorship income, or a forecast.
        </p>
      </div>
      <div className="deck-economics-model">
        <div
          className="deck-profit-chart"
          role="img"
          aria-label="Illustrative one percent payout fee scenarios: 20 thousand dollars at 2 million dollars of paid principal, 80 thousand dollars at 8 million, and 200 thousand dollars at 20 million"
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
          <strong className="deck-chart-label deck-chart-label-one">
            $20K
          </strong>
          <strong className="deck-chart-label deck-chart-label-two">
            $80K
          </strong>
          <strong className="deck-chart-label deck-chart-label-three">
            $200K
          </strong>
          <span className="deck-chart-year deck-chart-year-one">S1</span>
          <span className="deck-chart-year deck-chart-year-two">S2</span>
          <span className="deck-chart-year deck-chart-year-three">S3</span>
        </div>
        <div className="deck-projections">
          <div className="deck-projection-labels">
            <span>Payout volume</span>
            <span>Fee rate</span>
            <span>Fee revenue</span>
          </div>
          {projections.map(([period, payouts, rate, revenue]) => (
            <article key={period}>
              <span>{period}</span>
              <strong>{payouts}</strong>
              <strong>{rate}</strong>
              <strong>{revenue}</strong>
            </article>
          ))}
          <small>
            Pure scenario arithmetic, not historical results or a projection.
            Unpaid, held, unclaimed, disabled, and external-prize amounts
            produce no Slop payout fee.
          </small>
        </div>
      </div>
    </Frame>
  );
}

function Raise() {
  const allocation = [
    ["55%", "$137.5K", "Contributor incentives"],
    ["20%", "$50K", "Team"],
    ["15%", "$37.5K", "Marketing"],
    ["10%", "$25K", "Legal"],
  ];
  return (
    <Frame index={7} label="A 250 thousand dollar raise" className="deck-raise">
      <div className="deck-raise-heading">
        <h2>
          We need <em>$250K</em> to change the world.
        </h2>
      </div>
      <div className="deck-raise-model">
        <div
          className="deck-allocation-pie"
          role="img"
          aria-label="250 thousand dollar allocation: 55 percent contributor incentives, 20 percent team, 15 percent marketing, and 10 percent legal"
        >
          <div>
            <strong>$250K</strong>
            <span>total raise</span>
          </div>
        </div>
        <div className="deck-allocation-legend">
          {allocation.map(([percent, amount, label]) => (
            <article key={label}>
              <i aria-hidden="true" />
              <span>{percent}</span>
              <strong>{amount}</strong>
              <p>{label}</p>
            </article>
          ))}
        </div>
      </div>
    </Frame>
  );
}

function Close() {
  return (
    <Frame index={8} label="When we build it we own it" className="deck-close">
      <div className="deck-close-mark" aria-hidden="true">
        <GitBranch />
      </div>
      <h2>
        When we build it, <em>the terms stay clear.</em>
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
