# Design system

PRD section 2 requires WCAG AA, states a person can tell apart, and one
consistent product presentation. The design system names every color by its
role, never by its value. `packages/design-system/tokens.json` gives each role
a value in a light and a dark theme; the design tools refuse a value that
breaks the contrast this spec requires.

## Story: Name every color by what it does

### Each role is one token in both themes

```quint
type Role = Background | Foreground | Card | CardForeground | Popover | PopoverForeground
  | Primary | PrimaryForeground | PrimaryHover | PrimaryPressed | Secondary | SecondaryForeground | Muted | MutedForeground
  | Accent | AccentForeground | Destructive | DestructiveForeground | Border | Input | Ring | Ok | Warn | Info | Gold
pure val roles = List(Background, Foreground, Card, CardForeground, Popover, PopoverForeground,
  Primary, PrimaryForeground, PrimaryHover, PrimaryPressed, Secondary, SecondaryForeground, Muted, MutedForeground,
  Accent, AccentForeground, Destructive, DestructiveForeground, Border, Input, Ring, Ok, Warn, Info, Gold)
pure def token(role: Role): str = match role {
  | Background => "background" | Foreground => "foreground" | Card => "card" | CardForeground => "card-foreground"
  | Popover => "popover" | PopoverForeground => "popover-foreground" | Primary => "primary"
  | PrimaryForeground => "primary-foreground" | PrimaryHover => "primary-hover" | PrimaryPressed => "primary-pressed"
  | Secondary => "secondary" | SecondaryForeground => "secondary-foreground"
  | Muted => "muted" | MutedForeground => "muted-foreground" | Accent => "accent" | AccentForeground => "accent-foreground"
  | Destructive => "destructive" | DestructiveForeground => "destructive-foreground" | Border => "border"
  | Input => "input" | Ring => "ring" | Ok => "ok" | Warn => "warn" | Info => "info" | Gold => "gold"
}
pure def lawTokensAreDistinct(a: Role, b: Role): bool = a != b implies token(a) != token(b)
```

### Text meets 4.5:1 and boundaries 3:1 on the surfaces they sit on

A contrast requirement is in tenths: 45 is 4.5:1. Every `-foreground` role is
read on its own fill; every role used as text is read on the page and on a
card; a field's outline and the focus ring must be seen on both (WCAG 1.4.11).
`border` divides content and carries no meaning, so it has no requirement.
The main action darkens or lightens to `primary-hover` under the pointer and to
`primary-pressed` while pressed; its text stays readable on both.

```quint
type Pair = { text: Role, surface: Role, least: int }
pure def pair(text: Role, surface: Role, minimum: int): Pair = { text: text, surface: surface, least: minimum }
pure def onPageAndCard(role: Role, minimum: int): List[Pair] = List(pair(role, Background, minimum), pair(role, Card, minimum))
pure val requiredContrast: List[Pair] =
  List(pair(Foreground, Background, 45), pair(Foreground, Muted, 45), pair(MutedForeground, Popover, 45),
    pair(CardForeground, Card, 45), pair(PopoverForeground, Popover, 45), pair(PrimaryForeground, Primary, 45),
    pair(PrimaryForeground, PrimaryHover, 45), pair(PrimaryForeground, PrimaryPressed, 45), pair(SecondaryForeground, Secondary, 45), pair(MutedForeground, Muted, 45), pair(AccentForeground, Accent, 45),
    pair(DestructiveForeground, Destructive, 45))
    .concat(onPageAndCard(MutedForeground, 45)).concat(onPageAndCard(Primary, 45)).concat(onPageAndCard(Destructive, 45))
    .concat(onPageAndCard(Ok, 45)).concat(onPageAndCard(Warn, 45)).concat(onPageAndCard(Info, 45)).concat(onPageAndCard(Gold, 45))
    .concat(onPageAndCard(Input, 30)).concat(onPageAndCard(Ring, 30))
pure def required(text: Role, surface: Role): int =
  requiredContrast.foldl(0, (minimum, p) => if (p.text == text and p.surface == surface and p.least > minimum) p.least else minimum)
pure def lawForegroundsAreReadable(role: Role): bool =
  match role {
    | CardForeground => required(CardForeground, Card) == 45
    | PopoverForeground => required(PopoverForeground, Popover) == 45
    | PrimaryForeground => required(PrimaryForeground, Primary) == 45
    | SecondaryForeground => required(SecondaryForeground, Secondary) == 45
    | MutedForeground => required(MutedForeground, Muted) == 45
    | AccentForeground => required(AccentForeground, Accent) == 45
    | DestructiveForeground => required(DestructiveForeground, Destructive) == 45
    | _ => true
  }
pure def lawPrimaryStatesAreReadable(fill: Role): bool =
  (fill == PrimaryHover or fill == PrimaryPressed) implies required(PrimaryForeground, fill) == 45
pure def lawBoundariesAreVisible(surface: Role): bool =
  (surface == Background or surface == Card) implies required(Input, surface) >= 30 and required(Ring, surface) >= 30
pure def lawNoBorderRequirement(surface: Role): bool = required(Border, surface) == 0
```

## Story: Mean the same thing everywhere

### Each tone is a role that is readable as text

A status is shown in a tone (`spec/ui/status.md`). The tone's role must be
readable on the page and on a card, so a status never depends on a fill
behind it.

```quint
type Tone = Neutral | Emphasis | Positive | Caution | Negative | Notice
pure def toneRole(tone: Tone): Role = match tone {
  | Neutral => MutedForeground
  | Emphasis => Primary
  | Positive => Ok
  | Caution => Warn
  | Negative => Destructive
  | Notice => Info
}
pure def lawTonesAreReadable(tone: Tone): bool =
  required(toneRole(tone), Background) >= 45 and required(toneRole(tone), Card) >= 45
pure def lawTonesAreDistinct(a: Tone, b: Tone): bool = a != b implies toneRole(a) != toneRole(b)
```
