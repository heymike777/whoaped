---
name: WhoAped
description: A live ledger for tracked on-chain wallet activity.
colors:
  signal-orange: "#F04B2F"
  ledger-ink: "#111313"
  paper: "#F4F4EF"
  sheet: "#FFFFFF"
  quiet-ink: "#5A605D"
  faint-ink: "#858A87"
  positive: "#137A52"
  route-blue: "#4055D9"
  destructive: "#C92F26"
typography:
  display:
    fontFamily: "Space Grotesk"
    fontSize: "46px"
    fontWeight: 700
    lineHeight: 1.09
    letterSpacing: "-0.033em"
  title:
    fontFamily: "Space Grotesk"
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.16
  body:
    fontFamily: "SF Pro, Roboto, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.47
  label:
    fontFamily: "SF Pro, Roboto, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
rounded:
  control: "13px"
  compact: "10px"
  status: "16px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "38px"
components:
  button-primary:
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.control}"
    padding: "16px 20px"
    height: "52px"
  activity-sheet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ledger-ink}"
    padding: "18px 14px"
---

# Design System: WhoAped

## Overview

**Creative North Star: "The Live Ledger"**

WhoAped feels like a calm financial record receiving signals in real time. Its personality comes from the tension between a warm paper field, sharp black typography, fine ledger rules, and small event markers. It should feel authored and operational without borrowing the visual identity of a wallet, exchange, block explorer, or trading terminal.

The interface prioritizes decoding over decoration. Protocol and token imagery exists only where it helps identify an event; chrome stays quiet so swaps, deposits, launches, multisig actions, NFTs, and balance changes remain the focus.

**Key Characteristics:**

- Warm paper background with crisp white ledger sheets.
- Space Grotesk for decisive headings; native system typography for long-form clarity.
- Signal orange is rare and identifies live state or the primary action.
- Hairlines, event dots, and ordered records replace decorative cards.
- Native platform navigation and controls remain native.

## Colors

The palette behaves like ink and annotations on a paper record.

**The Signal Rarity Rule.** Signal orange belongs to live state, event markers, and the single primary action; it must not wash whole surfaces.

**The Semantic Gain Rule.** Green means confirmed receipt, positive balance movement, or active listening—not generic brand decoration.

## Typography

**Display Font:** Space Grotesk
**Body Font:** SF Pro on iOS, Roboto on Android
**Data Font:** IBM Plex Mono

Space Grotesk gives headings a compact editorial voice. System text keeps metadata, explanations, and controls familiar on each platform. IBM Plex Mono is reserved for addresses, amounts, and measured data.

**The Data-Only Mono Rule.** Never use monospace to make an interface look technical; use it only when character alignment or exact values matter.

## Layout

Phone screens use a 20-point outer gutter. Major sections separate by 34–38 points, while related text uses 6–14 points. Activity records form one continuous sheet and are separated by hairlines instead of individual floating cards. Touch targets are at least 44 points on iOS and 48 dp on Android.

## Elevation & Depth

The system is flat by default. Depth comes from tonal layers—paper, sheet, and quiet control fill—plus the native iOS tab-bar material. Custom content does not use decorative shadows or blur.

**The Native Glass Rule.** Glass belongs to the OS-owned tab bar; it is not a general card material.

## Shapes

Content surfaces are rectangular and ledger-like. Controls use restrained 10–13 point corners. Fully rounded shapes are limited to compact status controls and event dots. Token artwork may remain circular because the shape belongs to the asset.

## Components

### Buttons

Primary buttons use signal orange, white text, a 13-point radius, and a 52-point minimum height. Secondary actions use ledger ink with white text. Pressed state reduces opacity and may contract to 98% scale.

### Activity records

Every record sits on the shared white activity sheet with a bottom hairline. A small colored signal dot identifies the event family. Wallet and time metadata lead; the decoded action is the dominant text. Swap, yield, and launch records may add protocol artwork and structured subpanels, but must not nest another decorative card.

### Status controls

Live/listening status uses a small semantic dot with a short plain-language label. Pills are allowed here because status is compact and atomic.

### Navigation

iOS uses the native liquid-glass `UITabBar`; Android uses Material navigation. Selected state uses signal orange, while unselected items use quiet ink. Never recreate either platform's navigation in JavaScript for visual consistency.

## Do's and Don'ts

### Do:

- **Do** make the decoded event and its amounts the strongest content in a transaction record.
- **Do** use hairlines and spacing to express grouping before adding a container.
- **Do** preserve protocol logos and token artwork when they improve recognition.
- **Do** keep errors specific and pair them with a recovery action.

### Don't:

- **Don't** add neon glows, crypto gradients, glass cards, orbit graphics, or decorative dashboards.
- **Don't** place every block inside a rounded rectangle.
- **Don't** use uppercase kickers above page headings.
- **Don't** invent balances, wallet activity, protocol data, or commercial claims for presentation.
- **Don't** visually copy Coinbase or any other product; match their standard of clarity, not their identity.
