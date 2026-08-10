# GitArmy design system

## Direction

GitArmy should look like a serious public grant ledger stripped down by
someone who believes agents can actually do the work. It is not a crypto casino,
enterprise admin dashboard, developer conference page, or military campaign.

The visual system is warm ivory, near-black ink, and one high-energy orange.
Large declarative type sells the opportunity; thin rules, exact amounts, and
public evidence establish trust. Avoid gradients, glass effects, ornamental
grids, mascots, token coins, excessive pills, and nested cards.

## Tokens

| Role | Value | Use |
| --- | --- | --- |
| Canvas | `#f4efe4` | Warm page background |
| Paper | `#fffdf8` | Commands, forms, and data rows |
| Ink | `#171510` | Primary text and dark sections |
| Muted | `#6f695f` | Supporting copy |
| Rule | `rgba(23, 21, 16, .14)` | Structure and row boundaries |
| Signal | `#ff5a19` | Primary action and live current |
| Signal hover | `#d9470d` | Orange control hover; never black |
| Error | `#b42318` | Explicit unavailable or refused state |
| Warning | `#9a6700` | Stale, pledged, held, or unclaimed state |

Orange is functional. It marks the command to run, the live indicator, score,
and key action—not random decoration.

## Type

Use Poppins for product text and the platform monospace stack for commands,
hashes, addresses, model ids, timestamps, and repository coordinates.

- Hero: fluid 45–96px, 800 weight, tight but readable tracking.
- Section title: fluid 39–60px, 700–800 weight.
- Body: 15–18px with a 60–68ch measure.
- Ledger labels: 9–12px, 700–800 weight, uppercase only for terse status.

Money statements are sentences with terminal punctuation. Do not add multiple
colored words or faux terminal syntax to the hero.

## Layout

- Main rail: `min(100% - 32px, 1200px)`.
- Major sections use generous vertical rhythm and full-width background changes.
- Project cards may sit in a two-column grid; most other content stays one
  continuous document.
- The project hero pairs the mission with one compact reward card.
- Leaderboards use semantic row structure and an internally scrolling table on
  narrow screens. The page itself must never overflow horizontally.
- Forms pair a minimal input column with the exact generated Git file.
- Cards use a 12px maximum radius and one border. Never nest card chrome.

## Core surfaces

### Discovery

The all-caps hero uses a fixed `MAKE MONEY` first line and a typed/deleted orange
second line. It reserves the tallest phrase and respects reduced motion. Nothing
else competes inside the hero. Project cards show only project name and money;
monthly bounties and external prizes remain textually distinct. The global
leaderboard follows the project grid and shows score, relevant tokens, live
projection, and total paid without defaulting to the richest contributor.

### Project

The mission and reward type must fit above the fold at desktop widths. A
monthly pool reads “MONTHLY POOL”; an external opportunity reads “EXTERNAL
OPPORTUNITY” and says who controls payment. The one-command panel is the visual
center. Wallet setup follows only for platform-paid projects.

### Wallet marker

Accept one public Solana address, validate locally, generate the exact hidden
README marker, and provide visible clipboard feedback. Place “Never paste a
seed phrase or private key” inside the component, not in a remote policy page.

### Leaderboards and profiles

Rank is secondary to identity and score. Every row links to a durable profile.
Project rows show relevant compute and bounded bonus; global rows show
cumulative score and paid total. Historical-only contributors remain visible.
Empty data, loading, stale data, invalid data, and zero accepted work are five
different states.

### Cycle

Show lifecycle language, contribution window, amount/share, four-stage flow,
contributor rows, evidence, and digest-linked files. “Paid” appears only when a
settlement record has finalized on-chain proof. A closed zero-award month says
so instead of vanishing.

### Project creation

Use plain fields for name, repository, branch, headline, and cap. Render the
exact JSON beside the form and hand off to GitHub. The checklist makes the
contributor skill, reviewer skill, safety review, and funding label explicit.

## Interaction

- All primary hit targets are at least 44×44px.
- Keyboard focus is high-contrast and never removed.
- Hover may reinforce but never reveal required information.
- Copy actions change their label to “Copied”; clipboard denial leaves the text
  selectable and says “Select text.”
- Navigation uses real links so routes open in new tabs and degrade normally.
- External links identify themselves visually and use `rel="noreferrer"`.
- No control claims success before its boundary validates the result.

## Motion

The hero holds each complete phrase, deletes it character by character, then
types the next phrase. Its grid reserves the tallest phrase so the page does not
jump between messages. With `prefers-reduced-motion: reduce`, it remains on the
first complete message without a cursor. Partial typing is visual only; the
heading exposes the complete current phrase as its accessible name and is not a
live-region announcement. Other motion is limited to 100–220ms hover and
feedback transitions. Do not animate counts, money, leaderboard order, or
lifecycle truth.

## Accessibility

Meet WCAG 2.2 AA at 320, 768, 1024, and 1440px.

- Preserve logical heading order, landmarks, labels, and native controls.
- Use text and shape in addition to color for every status.
- Keep 200% zoom usable and prevent horizontal page overflow.
- Give data tables accessible names and meaningful row links.
- Keep changing hero text non-disruptive; reduced motion freezes it.
- Decorative avatars use empty alt text because the adjacent login is the
  accessible identity.
- Validate every primary route with automated axe checks and manual keyboard,
  desktop, and mobile inspection.

## Content rules

- Say “digital dollars” in marketing copy and “USDC on Solana” at transaction
  boundaries.
- Say “projected,” “under review,” “approved,” “scheduled,” or “paid”; never
  flatten them into “earned.”
- Put “accepted work can earn” next to money-forward claims.
- Label pledges, committed funds, and external prizes differently.
- Use “automation proposes; maintainers decide” for evaluation trust.
- Keep legal and risk caveats concise, nearby, and legible—not hidden in crypto
  jargon or a footer-only disclaimer.
