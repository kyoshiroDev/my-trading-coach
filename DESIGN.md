---
name: MyTradingCoach Landing
description: Journal de trading intelligent avec coach IA — pour traders actifs qui veulent progresser
colors:
  primary: "#3b82f6"
  primary-light: "#60a5fa"
  pulse: "#22d3ee"
  profit: "#10b981"
  loss: "#ef4444"
  alert: "#f59e0b"
  bg-void: "#06090f"
  bg-deep: "#080c14"
  bg-raised: "#0d1420"
  surface: "#0f1824"
  surface-elevated: "#111b2e"
  border-subtle: "#639bff1a"
  border-strong: "#639bff38"
  text-primary: "#e2eaf5"
  text-secondary: "#9db4ce"
  text-muted: "#7090b0"
typography:
  display:
    fontFamily: "Inter, sans-serif"
    fontSize: "clamp(30px, 5vw, 52px)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.5px"
  headline:
    fontFamily: "Inter, sans-serif"
    fontSize: "clamp(40px, 7vw, 84px)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-1px"
  title:
    fontFamily: "Inter, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.4px"
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "clamp(15px, 2vw, 19px)"
    fontWeight: 300
    lineHeight: 1.65
  label:
    fontFamily: "DM Mono, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.5px"
rounded:
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "16px"
  pill: "100px"
spacing:
  xs: "8px"
  sm: "14px"
  md: "24px"
  lg: "36px"
  xl: "56px"
  section: "96px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "16px 32px"
  button-primary-hover:
    backgroundColor: "{colors.primary-light}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "13px 22px"
  card-default:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "36px 32px"
  badge-mono:
    backgroundColor: "transparent"
    textColor: "{colors.pulse}"
    rounded: "{rounded.pill}"
    padding: "5px 14px"
---

# Design System: MyTradingCoach Landing

## 1. Overview

**Creative North Star: "The Trading Terminal"**

This landing page is not a marketing brochure. It is a terminal window into the tool itself. The design speaks the language of traders: dark backgrounds they stare at for hours, monospace labels that feel like data feeds, blue accents that read as interface elements not decoration. Every section should feel like the interface is leaking out of the mockups and into the page itself.

The typographic scale is aggressive: headlines at near-90px with negative letter-spacing, sections labeled with uppercase mono at 11px with 2px tracking. There is no soft middle ground. Body copy is lightweight (300) to contrast with the weight of the display type. This is not "clean" in the minimal-white-space sense; it is precise, structured, information-dense in the right places and breathable everywhere else.

The system explicitly rejects: glassmorphism and purple gradients (cliché crypto 2021), hero-metric templates (big number + stat + gradient = SaaS cliché, invisible to a trader with a TradingView terminal open), Coinbase-style mass-market smoothness, and the generic "Boost your productivity" tone. A trader who has blown a prop challenge does not want to feel like they're buying a todo app.

**Key Characteristics:**
- Dark-by-nature: not "dark mode", the terminal is the default environment
- Data precision: specific numbers, specific times, specific patterns — not vague claims
- Mono as texture: DM Mono used for labels, badges, stats, timestamps — signals "data, not marketing"
- Blue as signal: the accent is never decorative; every blue element is a CTA or interactive affordance
- Cyan as live indicator: `--pulse` (#22d3ee) appears only on "live" elements — animated dots, real-time badges

## 2. Colors: The Terminal Palette

Five background layers, two accent channels, three semantic data colors, three text weights. Every value earns its place.

### Primary
- **Blueprint Blue** (#3b82f6 / `--blue`): The single CTA color. Buttons, interactive states, active accents. Used at ≤15% of any screen. Its scarcity signals importance.
- **Sky Blue** (#60a5fa / `--blue2`): Emphasis within text, italic accents, secondary links. Lighter than Blueprint; used where the primary is too heavy.

### Secondary
- **Live Feed Cyan** (#22d3ee / `--pulse`): Reserved exclusively for "active" states — the animated blinking dot, section labels, real-time indicators. Never used as a fill or large-area color. If it appears too much, the signal is diluted.

### Tertiary
- **Profit Green** (#10b981 / `--green`): Positive P&L values, checkmarks, success states. Only on data that represents gains.
- **Loss Red** (#ef4444 / `--red`): Negative P&L, error states. Only on data that represents losses.
- **Alert Amber** (#f59e0b / `--yel`): Urgency badges, warning highlights. Used in the pricing urgency badge and text warnings.

### Neutral
- **Void** (#06090f / `--bg`): The deepest layer. The base of the page itself.
- **Deep** (#080c14 / `--bg2`): Section backgrounds that alternate with Void.
- **Raised** (#0d1420 / `--bg3`): Slightly elevated surfaces (document-style cards, inner sections).
- **Surface** (#0f1824 / `--card`): Card backgrounds, mockup interiors.
- **Elevated** (#111b2e / `--card2`): The topmost card layer; used sparingly for nested elements.
- **Subtle Border** (rgba(99,155,255,0.10) / `--b`): Dividers, card borders at rest.
- **Strong Border** (rgba(99,155,255,0.22) / `--b2`): Card borders on hover or featured states.
- **Primary Text** (#e2eaf5 / `--txt`): Headings, strong copy, data values.
- **Secondary Text** (#9db4ce / `--txt2`): Body copy, descriptions, feature list.
- **Muted Text** (#7090b0 / `--txt3`): Labels, timestamps, disclaimers, secondary metadata.

### Named Rules
**The Signal Rule.** Blueprint Blue (#3b82f6) appears only on CTAs and interactive elements. Cyan (#22d3ee) appears only on live/animated indicators. If either color appears as decoration, strip it.

**The Layering Rule.** Five background values exist because depth matters. Moving from Void → Deep → Raised → Surface → Elevated is moving toward the user. Never skip layers; never use Surface where Void belongs.

## 3. Typography: Precision Over Warmth

**Display Font:** Inter (weights 300, 500, 600, 700, 800 — same family for display and UI)
**Label/Mono Font:** DM Mono (weights 300, 400, 500)
**Body Font:** DM Sans (weight 300 — lightweight for contrast against bold headings)

**Character:** Inter at heavy weights with negative letter-spacing reads like a Bloomberg terminal headline: authoritative, no-nonsense, built for someone who processes numbers. DM Mono at small sizes creates the data-feed texture that places this page inside the trader's professional environment. DM Sans at 300 weight is the human voice in the system — not soft, but conversational against the machinery.

### Hierarchy
- **Headline** (700, clamp(40px–84px), line-height 0.95, letter-spacing -1px): Hero H1 only. Compressed and massive. "Tu sais trader. Le problème, c'est toi." One idea per line.
- **Display** (700, clamp(30px–52px), line-height 1.1, letter-spacing -0.5px): Section H2 headings. Slightly looser than Headline but still tight.
- **Title** (700, 20px, line-height 1.3, letter-spacing -0.4px): Card titles, mockup headers, in-content labels. Compact.
- **Body** (300, clamp(15px–19px), line-height 1.65): Section descriptions, feature explanations. Light weight creates breathing room. Maximum 540px wide (≈65ch).
- **Label** (DM Mono, 11px, letter-spacing 2px, uppercase, color: `--pulse` or `--txt3`): Section category labels (`sec-label`), stat units, timestamps, mono data. Never used for body copy.

### Named Rules
**The Weight Contrast Rule.** Every section that has a Display or Headline must be directly followed or preceded by 300-weight body copy. Never two heavy elements back to back without a lightweight bridge.

**The Mono Texture Rule.** DM Mono appears only on data, labels, and timestamps — never on headings or descriptions. If a string reads like information rather than prose, it gets mono treatment.

## 4. Elevation

The system uses tonal layering as primary depth mechanism. Shadows appear only as structural or interactive signals — not as ambient decoration. Five background layers replace the shadow scale: proximity to the viewer is expressed by moving up the Neutral layer stack.

### Shadow Vocabulary
- **Structural lift** (`0 24px 60px rgba(0,0,0,0.5)`): Reserved for the prominent app mockup cards in the Debrief and Showcase. Signals "this is a physical object rising above the page." Used once per section maximum.
- **Glow** (`0 0 40px rgba(59,130,246,0.35)`): Primary button glow. Reinforces the CTA as the primary exit point of each section. Not used on non-interactive elements.
- **Section ambient** (`0 48px 120px rgba(0,0,0,0.85)`): Hero screenshot only. Creates the illusion that the app is floating above the page.

### Named Rules
**The Flat-By-Default Rule.** Cards and containers are flat at rest. Shadows appear only on the most prominent visual element per section (hero screenshot, featured mockup) and on interactive states (button hover glow). Ambient shadows on every card would make the system feel heavy and dated.

## 5. Components

### Buttons
Direct and functional. The primary CTA is the single loudest non-content element on every screen.

- **Shape:** Gently rounded (9–12px). Not pill, not sharp. Confident but not aggressive.
- **Primary** (#3b82f6, white text, `0 0 28px rgba(59,130,246,0.4)` glow, padding 16px 32px): Used once per section at most. Font: Inter 600.
- **Hover / Focus:** Background → #60a5fa, translateY(-2px), glow intensity increases to 0.55. Transition: all 0.2s.
- **Ghost:** Transparent, border 1px solid `--b2`, text `--txt2`. Hover: border → blue, text → `--txt`, background rgba(59,130,246,0.05). Used as secondary option alongside Primary.

### Badges / Labels (sec-label)
- **Style:** DM Mono, 11px, uppercase, letter-spacing 2px, color `--pulse`. Displayed as a `block` element above section headings. No background, no border.
- **Purpose:** Category signal. Not a chip; not a tag. A pure label that contextualizes what follows.

### Mono Badges (hero-badge, deb-doc-badge)
- **Style:** Inline-flex, background rgba(34,211,238,0.07), border 1px solid rgba(34,211,238,0.2), color `--pulse`, border-radius 100px, padding 5px 14px, DM Mono 11px, letter-spacing 0.4px.
- **Animation:** A 6px blinking dot (blink 2s ease infinite) precedes the text. This dot is the only animated element outside of scroll-reveals.

### Cards / Containers
- **Shape:** Border-radius 14–16px. Never sharp. Never full-pill.
- **Background:** `--card` (#0f1824). Featured cards: linear-gradient with blue/purple tint at 7% opacity.
- **Border:** 1px solid `--b` at rest. Featured: rgba(59,130,246,0.4).
- **Shadow:** None by default. Structural lift (see Elevation) on showcase/mockup cards only.
- **Internal Padding:** 36px 32px standard. 24px for compact cards (feature bullets, stat cells).
- **Document-style variant (.deb-mock-doc):** bg `--bg3`, border rgba(59,130,246,0.2), no box-shadow. Signals "report" not "app".

### Stat Cells (dm-stat)
- **Background:** `--bg3` (#0d1420), border 1px solid `--b`, border-radius 8px, padding 10px.
- **Value:** Inter 700, 20px, letter-spacing -0.3px. Color-coded: `--green` for gains, `--blue2` for rates, `--txt` for neutral scores.
- **Label:** DM Mono 10px, color `--txt3`, margin-top 3px.

### AI Analysis Block (dm-ai)
- **Background:** `linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.08))`, border rgba(139,92,246,0.15).
- **Label:** DM Mono 9px, uppercase, letter-spacing 0.5px, color `--blue2`. Preceded by blinking dot.
- **Body:** 12px, DM Sans 300, color `--txt2`, line-height 1.75. Strong tags → `--txt`. `.warn` → `--yel`. `.good` → `--green`.

### Navigation
- **Style:** Fixed, 60px height, `rgba(6,9,15,0.75)` with `backdrop-filter: blur(20px)`. Disappears into the page on scroll without obstructing content.
- **Links:** Inter 13px, color `--txt2`. Hover → `--txt`. No underline.
- **CTA:** Blueprint Blue button, 7px 16px padding, box-shadow glow at 0.3.
- **Mobile:** Full-screen overlay (#080c14 solid), links at 22px Inter 600. Hamburger with animated cross transition.
- **Mobile sticky:** Fixed bottom bar, Blueprint Blue full-width, 14px padding. Disappears when nav overlay is open.

### Pricing Cards
- **FREE:** Standard card. Ghost CTA.
- **PREMIUM:** Featured card with `linear-gradient(160deg, rgba(59,130,246,0.07), rgba(139,92,246,0.04))`, blue border, box-shadow 0 0 40px rgba(59,130,246,0.08). Primary CTA.
- **Urgency badge:** `rgba(245,158,11,0.1)` background, `rgba(245,158,11,0.3)` border, #f59e0b text. Used once per pricing card.

## 6. Do's and Don'ts

### Do:
- **Do** use DM Mono for any string that represents data, a timestamp, a label, or a category tag. If it reads like information rather than prose, it gets mono treatment.
- **Do** use blinking dots (#22d3ee, 6px, 2s blink animation) exclusively on elements that represent live or AI-generated content. Reserve `--pulse` for those moments.
- **Do** color-code financial data: green (#10b981) for gains, red (#ef4444) for losses. Never reverse them. Never use them for anything else.
- **Do** write specific numbers in mockup content: "$1,840", "67%", "jeudi après 15h". Vague claims ("high performance", "great results") are invisible to traders.
- **Do** use Inter 700 with negative letter-spacing (-0.5px to -1px) for all display headings. The compression is structural, not decorative.
- **Do** keep Blueprint Blue (#3b82f6) on CTAs and interactive affordances only. Its scarcity is what makes it a signal.
- **Do** alternate section backgrounds between `--bg` (#06090f) and `--bg2` (#080c14) to create rhythm without borders.
- **Do** respect `prefers-reduced-motion`: wrap the blink animation and scroll-reveal transitions in a motion media query.

### Don't:
- **Don't** use glassmorphism — blur cards, frosted glass panels, or heavy backdrop-filter as decoration. This is the explicit anti-reference from PRODUCT.md. If blur appears, it is on the fixed nav only.
- **Don't** use purple or violet gradients. They signal "generic crypto project 2021" to anyone who has been in the space for more than six months.
- **Don't** use gradient text (`background-clip: text`). Single solid colors only. Emphasis through weight or size.
- **Don't** use a hero-metric template: large isolated number, small label, supporting stats, gradient accent. This is the pattern traders have seen on every mediocre SaaS landing page. It signals low credibility.
- **Don't** use side-stripe borders (`border-left > 1px` as a colored accent). Never on cards, never on callouts.
- **Don't** soften the brand personality toward "Boost your productivity" tone. The copy must name real problems ("tu perds de l'argent le jeudi après 15h") not generic benefits ("improve your performance").
- **Don't** use `#000` or pure white `#fff`. The darkest value in the system is `--bg` (#06090f); the lightest text is `--txt` (#e2eaf5). Pure black/white breaks the tinted-neutral system.
- **Don't** put both an icon and a gradient on the same card. Cards carry one type of visual emphasis, not three.
- **Don't** make every card the same size in a grid. Identical card grids with icon + heading + body repeated identically are an anti-pattern. Use varied layouts.
- **Don't** use Coinbase-style mass-market language or Trading212-level visual quality. This product speaks to a trader who knows what ICT is. Treat them accordingly.
