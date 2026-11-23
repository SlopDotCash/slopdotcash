# Design system

Slop is warm ink on a near-black page, with one orange accent. Color carries meaning; position, size and
weight carry hierarchy. The product renders dark: the application and Storybook set `.dark` on the root.
The light set keeps the same roles at AA contrast for printing and for a system preference the product does
not force.

- **Surfaces.** `background` is the page, `card` a raised panel, `popover` anything floating above a card.
  `muted` and `secondary` are quiet fills, `accent` the hover and selection fill.
- **Text.** `foreground` by default, `muted-foreground` for what matters less. Every `x-foreground` is the
  text color on `x`, and each pair meets WCAG AA in both themes.
- **Meaning.** `primary` is the one accent: the main action, links and the focus `ring`. The main action
  turns `primary-hover` under the pointer and `primary-pressed` while pressed. `ok`, `warn`,
  `destructive` and `info` are states, never decoration, and always travel with an icon or a word.
- **Boundaries.** `input` outlines a field and `ring` shows focus; both meet 3:1 against the page and a card
  (WCAG 1.4.11). `border` divides content and is decorative.
- **Type.** Bricolage Grotesque for every word, with optical sizing; JetBrains Mono for amounts, addresses,
  hashes and commands, with tabular numbers, in 400 to 700. Sizes are a named scale, each with its line
  height: `text-ui` (13px) is the dense interface size, `text-copy` (15px) running copy, `text-control`
  (15px, tight) a header control, `text-prompt` (17px) the agent prompt, `text-wordmark` (22px, 19px under `md`
  as `text-wordmark-sm`) the header's wordmark, and `xs` to `4xl` keep Tailwind's steps, `3xl` (32px) and
  `4xl` (40px) being a project card's name and amount on a wide screen, `name` (22px), `amount` (28px) and
  `amount-lg` (31px) the same on narrower ones; `5xl` (48px) to `9xl` (128px) are display sizes with a line height of
  1. Development sizes the home page's display type with the viewport; the tokens step it at `md`, `lg` and `xl` to
  development's size at 390, 1024 and 1440px: `hero` (56px), `hero-lg` (92px) and `hero-xl` (130px) the campaign
  heading at `leading-hero` (0.86), its action from `title` to `action-xl` (94px), and `title` (44px), `title-lg` (61px)
  and `title-xl` (86px) a section title at `leading-title` (0.88); `lead` (22px) is the hero's line under the
  heading. `leading-summary` (1.45) is a card's description. `leading-page` (1.2) is the page's own line height, as
  development's `normal`, and `leading-data` (1.32) the same for JetBrains Mono; `tracking-amount` (-0.03em) is a
  card's amount. `leading-*` and `tracking-*` set a heading's or label's own rhythm: `display` for
  the large headings, `label` for small capitals. Development's headings are 800 (12 rules), `font-extrabold`;
  `font-strong` (650) and `font-heavy` (750) sit between Tailwind's weights.
- **Shape.** One `radius` of 8px; `rounded-sm` (4px), `-md` (6px), `-lg` (8px) and `-xl` (12px) derive from
  it, and `rounded-full` is the pill and the avatar. `rounded-chip` (0.6rem) is a chip or tag and
  `rounded-card` (16px) a large card, `rounded-avatar` (10px) a project's picture. One `panel` shadow, for what floats; `shadow-underline` marks the
  selected tab, `shadow-edge` (an inset 1px `primary` ring) the selected step, and `shadow-glow` (3px of `primary`
  at 25%) a focused field around its `ring`.
- **Controls.** A button is 48px high, 40px small, in 16px bold with 18px icons, as development's `.button`;
  `outline` is its bordered secondary button and `inverse` the ink "Log in"; a text field or select is 52px. Every control can be hit
  in a 44px square, however small it is drawn.
- **Motion.** `fast` for hover and press, `base` for most changes, `slow` for entering and leaving.
  `animate-caret` blinks the typing caret; a spinner is Tailwind's `animate-spin`. Reduced motion removes all of
  it.
- **Focus.** The ring is 3px wide and 3px off the element, as in development, in `ring`.
- **Layers.** `z-raised` lifts a cell over its neighbours, `z-header` is the sticky header (over the page
  behind `backdrop-blur-header`, 16px), and `z-modal`
  holds menus, dialogs and the backdrop behind them, above the header.
- **Width.** `sm`, `md` and `lg` are the phone, the narrow column and the two-column layout, `xl` (1280px) the wide
  screen where the display type takes its largest step. `shell` (1180px)
  is the one content width of the header, the home page and the footer, as development's `.shell`: 24px of
  gutter each side, 14px under `md`.

Network marks (Base, Ethereum, Robinhood Chain, Solana: `NetworkMark`) and the Slop mark (`Logo`) keep their
own published colors. They are literal colors in `@repo/ui`, each with its reason on the line above, because
they are another party's identity, not a role of this palette. Agent client marks (`AgentMark`) are masks in
the color of the text around them, and need none.

Name a value by its token (`bg-primary`, `var(--primary)`), never by its value. A literal color is only
another party's mark, in the component that draws it, with the mark named on the line above:
`// eslint-disable-next-line design-system/no-literal-colors -- Base "The Square" blue`.

## Where it came from

`tokens.json` supersedes development's `src/brand-tokens.ts` (the Blackout tokens). Its dark set is that file
in oklch: `bg` #0f0e0c is `background` oklch(0.164 0.004 84.6), `surface` #1a1814 is `card` oklch(0.21 0.008
84.6), `raised` #24211c is `popover`, `secondary` and `muted` oklch(0.249 0.01 80.6), `ink` #f3efe6 is
`foreground` oklch(0.953 0.013 86.8), `muted` #a39d90 is `muted-foreground` oklch(0.697 0.02 86.2), `accent`
#ff5a19 is `primary` and `ring` oklch(0.682 0.212 38.4), `onAccent` #0f0e0c is `primary-foreground`,
`success` #3ddc84 is `ok` oklch(0.793 0.18 154), `warning` #ffb020 is `warn` oklch(0.813 0.165 75) and
`danger` #ff6b6b is `destructive` oklch(0.712 0.181 22.8). Its `radius.small` 6px, `medium` 8px, `large`
12px and `pill` are `rounded-md`, `-lg`, `-xl` and `rounded-full`; `size.buttonMedium` 48px, `buttonSmall`
40px and `input` 52px are the control heights above, and `motion.fast` and `ease` are `fast` and `standard`.
`accentHover` #ff7a42 is `primary-hover` oklch(0.726 0.177 42). `accentPressed` #d9480f is `primary-pressed` at
oklch(0.605 0.19 37.9), a step lighter than its oklch(0.6 0.19 37.9), because #0f0e0c on #d9480f is 4.49:1,
under AA. The operations pages' `--operations-green` #72dda6, `-blue` #9cc9ff and `-amber` #ffcb79 are `ok`,
`info` and `warn`. A focused field's glow, `0 0 0 3px` of the accent at 25%, is `shadow-glow`; the `inset 0 0 0
1px` accent ring of the selected proposal step is `shadow-edge` (the Solana mark's ring stays in
`NetworkMark`); the `wallet-spin` keyframes, a full turn in 1s, linear, are Tailwind's `spin`, which `Spinner`
runs. The translucent `line`, `lineStrong` and
`inputBorder` are `border-foreground/10`, `/22` and `/18`, not tokens. `faint` #77716a is not ported: it is
3.9:1 on the page, so it cannot carry text, and inactive controls fade to half opacity instead of
development's raised, faint look. The type, weight, leading, tracking, layer and focus values above came from
development's stylesheets, with near-duplicates merged: line heights 0.86 to 0.98 are `display`, 1.1 and 1.15 `tight`,
1.3 and 1.35 `snug`, 1.55 to 1.65 `body`, 1.4 and 1.45 `text-ui`'s; letter spacing -0.03em is `tight`'s
-0.02em, -0.06em `display`'s -0.055em, and 0.12em and 0.13em `label`'s 0.08em. Its 45 fluid `clamp()`
sizes, its off-grid spacing and control sizes, and its `font-synthesis` and `text-rendering` rules have no
token yet: the schema takes fixed lengths only and has no spacing or size group, so they wait on an owner or
upstream decision. A hex or TypeScript export for the identity Worker and the social image renderer waits
until those are ported.

## Changing it

`tokens.json` is the source; the CSS in `generated/` and the table below are built from it. Nothing reads
this prose into tokens. To change the design, describe it, and have the change written as a list in a file:

```json
[{ "path": "color.dark.primary", "value": "oklch(0.7 0.2 40)", "reason": "brighter accent" }]
```

- `node ../../vibestack/design/cli.ts apply changes.json` refuses an unknown path, an invalid value or a
  pair below AA, and prints each token before and after.
- The same with `--write` updates `tokens.json`, the CSS and the table.
- `pnpm build` regenerates; `pnpm check` fails on invalid tokens, low contrast or a stale table.

<!-- tokens:start -->
| Color | Light | Dark |
| --- | --- | --- |
| `background` | oklch(0.953 0.013 86.8) | oklch(0.164 0.004 84.6) |
| `foreground` | oklch(0.164 0.004 84.6) | oklch(0.953 0.013 86.8) |
| `card` | oklch(0.982 0.007 88.6) | oklch(0.21 0.008 84.6) |
| `card-foreground` | oklch(0.164 0.004 84.6) | oklch(0.953 0.013 86.8) |
| `popover` | oklch(0.982 0.007 88.6) | oklch(0.249 0.01 80.6) |
| `popover-foreground` | oklch(0.164 0.004 84.6) | oklch(0.953 0.013 86.8) |
| `primary` | oklch(0.528 0.17 37.4) | oklch(0.682 0.212 38.4) |
| `primary-foreground` | oklch(1 0 0) | oklch(0.164 0.004 84.6) |
| `primary-hover` | oklch(0.48 0.16 37.4) | oklch(0.726 0.177 42) |
| `primary-pressed` | oklch(0.44 0.15 37.4) | oklch(0.605 0.19 37.9) |
| `secondary` | oklch(0.917 0.016 86.4) | oklch(0.249 0.01 80.6) |
| `secondary-foreground` | oklch(0.164 0.004 84.6) | oklch(0.953 0.013 86.8) |
| `muted` | oklch(0.917 0.016 86.4) | oklch(0.249 0.01 80.6) |
| `muted-foreground` | oklch(0.469 0.017 84.6) | oklch(0.697 0.02 86.2) |
| `accent` | oklch(0.917 0.016 86.4) | oklch(0.226 0.006 91.6) |
| `accent-foreground` | oklch(0.164 0.004 84.6) | oklch(0.953 0.013 86.8) |
| `destructive` | oklch(0.5 0.182 29.5) | oklch(0.712 0.181 22.8) |
| `destructive-foreground` | oklch(1 0 0) | oklch(0.164 0.004 84.6) |
| `border` | oklch(0.859 0.019 86.2) | oklch(0.262 0.005 67.6) |
| `input` | oklch(0.629 0.019 81.3) | oklch(0.526 0.014 79.7) |
| `ring` | oklch(0.528 0.17 37.4) | oklch(0.682 0.212 38.4) |
| `ok` | oklch(0.482 0.113 153.7) | oklch(0.793 0.18 154) |
| `warn` | oklch(0.508 0.108 73.3) | oklch(0.813 0.165 75) |
| `info` | oklch(0.485 0.133 254.6) | oklch(0.824 0.09 253.4) |

| Token | Value |
| --- | --- |
| `radius` | 8px |
| `font.sans` | "Bricolage Grotesque Variable", ui-sans-serif, system-ui, sans-serif |
| `font.mono` | "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace |
| `shadow.panel` | 0 24px 60px oklch(0 0 0 / 0.55) |
| `shadow.underline` | inset 0 -2px var(--primary) |
| `shadow.glow` | 0 0 0 3px color-mix(in oklch, var(--primary) 25%, transparent) |
| `shadow.edge` | inset 0 0 0 1px var(--primary) |
| `breakpoint.sm` | 30rem |
| `breakpoint.md` | 42.5rem |
| `breakpoint.lg` | 56.25rem |
| `breakpoint.shell` | 73.75rem |
| `breakpoint.xl` | 80rem |
| `rounded.chip` | 0.6rem |
| `rounded.card` | 16px |
| `rounded.avatar` | 10px |
| `text.xs.size` | 0.75rem |
| `text.xs.leading` | 1rem |
| `text.ui.size` | 13px |
| `text.ui.leading` | 1.45 |
| `text.sm.size` | 0.875rem |
| `text.sm.leading` | 1.25rem |
| `text.copy.size` | 15px |
| `text.copy.leading` | 1.6 |
| `text.control.size` | 15px |
| `text.control.leading` | 1 |
| `text.base.size` | 1rem |
| `text.base.leading` | 1.5rem |
| `text.lg.size` | 1.125rem |
| `text.lg.leading` | 1.75rem |
| `text.prompt.size` | 17px |
| `text.prompt.leading` | 1.55 |
| `text.xl.size` | 1.25rem |
| `text.xl.leading` | 1.75rem |
| `text.wordmark-sm.size` | 19px |
| `text.wordmark-sm.leading` | 1 |
| `text.wordmark-sm.tracking` | -0.03em |
| `text.2xl.size` | 1.5rem |
| `text.2xl.leading` | 2rem |
| `text.wordmark.size` | 22px |
| `text.wordmark.leading` | 1 |
| `text.wordmark.tracking` | -0.03em |
| `text.3xl.size` | 2rem |
| `text.3xl.leading` | 1 |
| `text.4xl.size` | 2.5rem |
| `text.4xl.leading` | 0.95 |
| `text.5xl.size` | 3rem |
| `text.5xl.leading` | 1 |
| `text.6xl.size` | 3.75rem |
| `text.6xl.leading` | 1 |
| `text.7xl.size` | 4.5rem |
| `text.7xl.leading` | 1 |
| `text.8xl.size` | 6rem |
| `text.8xl.leading` | 1 |
| `text.9xl.size` | 8rem |
| `text.9xl.leading` | 1 |
| `text.name.size` | 22px |
| `text.name.leading` | 1 |
| `text.amount.size` | 28px |
| `text.amount.leading` | 0.95 |
| `text.amount-lg.size` | 31px |
| `text.amount-lg.leading` | 0.95 |
| `text.lead.size` | 22px |
| `text.lead.leading` | 1.6 |
| `text.title.size` | 44px |
| `text.title.leading` | 0.88 |
| `text.title-lg.size` | 61px |
| `text.title-lg.leading` | 0.88 |
| `text.title-xl.size` | 86px |
| `text.title-xl.leading` | 0.88 |
| `text.action-xl.size` | 94px |
| `text.action-xl.leading` | 0.88 |
| `text.hero.size` | 56px |
| `text.hero.leading` | 0.86 |
| `text.hero-lg.size` | 92px |
| `text.hero-lg.leading` | 0.86 |
| `text.hero-xl.size` | 130px |
| `text.hero-xl.leading` | 0.86 |
| `weight.medium` | 500 |
| `weight.semibold` | 600 |
| `weight.strong` | 650 |
| `weight.bold` | 700 |
| `weight.heavy` | 750 |
| `weight.extrabold` | 800 |
| `leading.display` | 0.9 |
| `leading.hero` | 0.86 |
| `leading.title` | 0.88 |
| `leading.page` | 1.2 |
| `leading.data` | 1.32 |
| `leading.none` | 1 |
| `leading.tight` | 1.15 |
| `leading.snug` | 1.3 |
| `leading.summary` | 1.45 |
| `leading.body` | 1.6 |
| `tracking.display` | -0.055em |
| `tracking.tighter` | -0.04em |
| `tracking.amount` | -0.03em |
| `tracking.tight` | -0.02em |
| `tracking.label` | 0.08em |
| `z.raised` | 1 |
| `z.header` | 20 |
| `z.modal` | 50 |
| `blur.header` | 16px |
| `focus.width` | 3px |
| `focus.offset` | 3px |
| `keyframes.typewriter-caret` | 50%{opacity:0} |
| `animate.caret` | typewriter-caret 720ms steps(1, end) infinite |
| `duration.fast` | 160ms |
| `duration.base` | 180ms |
| `duration.slow` | 300ms |
| `ease.standard` | cubic-bezier(0.4, 0, 0.2, 1) |
<!-- tokens:end -->
