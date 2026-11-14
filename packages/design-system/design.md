# Design system

Slop is warm ink on a near-black page, with one orange accent. Color carries meaning; position, size and
weight carry hierarchy. The product renders dark: the application and Storybook set `.dark` on the root.
The light set keeps the same roles at AA contrast for printing and for a system preference the product does
not force.

- **Surfaces.** `background` is the page, `card` a raised panel, `popover` anything floating above a card.
  `muted` and `secondary` are quiet fills, `accent` the hover and selection fill.
- **Text.** `foreground` by default, `muted-foreground` for what matters less. Every `x-foreground` is the
  text color on `x`, and each pair meets WCAG AA in both themes.
- **Meaning.** `primary` is the one accent: the main action, links and the focus `ring`. `ok`, `warn`,
  `destructive` and `info` are states, never decoration, and always travel with an icon or a word.
- **Boundaries.** `input` outlines a field and `ring` shows focus; both meet 3:1 against the page and a card
  (WCAG 1.4.11). `border` divides content and is decorative.
- **Type.** Bricolage Grotesque for every word, with optical sizing; JetBrains Mono for amounts, addresses,
  hashes and commands, with tabular numbers.
- **Shape.** One `radius` of 8px; `rounded-sm` (4px), `-md` (6px), `-lg` (8px) and `-xl` (12px) derive from
  it, and `rounded-full` is the pill and the avatar. One `panel` shadow, for what floats.
- **Motion.** `fast` for hover and press, `base` for most changes, `slow` for entering and leaving. Reduced
  motion removes all of it.
- **Width.** `sm`, `md` and `lg` are the phone, the narrow column and the two-column layout.

Network marks (Base, Ethereum, Robinhood Chain, Solana) and the Slop mark keep their own published colors.
They are literal colors in `@repo/ui`, each with its reason on the line above, because they are another
party's identity, not a role of this palette.

Name a value by its token (`bg-primary`, `var(--primary)`), never by its value. Where a literal color
is unavoidable, such as a chart series or third-party markup, say why on the line above:
`// eslint-disable-next-line design-system/no-literal-colors -- chart series`.

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
| `breakpoint.sm` | 30rem |
| `breakpoint.md` | 42.5rem |
| `breakpoint.lg` | 56.25rem |
| `duration.fast` | 160ms |
| `duration.base` | 180ms |
| `duration.slow` | 300ms |
| `ease.standard` | cubic-bezier(0.4, 0, 0.2, 1) |
<!-- tokens:end -->
