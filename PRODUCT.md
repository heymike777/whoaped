# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Crypto-native users who monitor several public wallets and need to understand meaningful on-chain activity without reading raw transactions or keeping block explorers open.

## Product Purpose

WhoAped is a watch-only wallet activity tracker. A user adds public wallet addresses; the service begins monitoring immediately, translates new Solana transactions into concise human-readable events, and delivers them through an in-app feed and push notifications.

Success means the user can glance at the feed or notification and immediately understand who did what, with which assets, where, and in what amount.

## Positioning

WhoAped is not a portfolio wallet or a generic explorer. Its differentiator is a personalized live activity wire: transactions from named wallets are decoded into purpose-built event views for swaps, yield activity, token launches, NFTs, multisig actions, and balance changes.

## Operating Context

Users return to scan a chronological activity feed, investigate an event, follow token or protocol links, add and remove watched wallets, and confirm that monitoring is active. The main screen is read frequently and should reward fast scanning rather than invite prolonged management.

## Capabilities and Constraints

- React Native Community CLI with native iOS and Android projects; Expo is prohibited.
- Solana is the first supported chain, with a multichain architecture reserved for future EVM adapters.
- Helius Parsed Streams and APIs provide transaction data; MongoDB stores wallets and normalized activity.
- The app is watch-only and never asks for private keys or transaction signatures.
- The first tab is the tracked activity feed; wallet management and settings remain separate top-level tabs.
- Rich event cells exist for swaps, yield deposits/withdrawals, token launches, and generic semantic activity.
- External token actions may include BONKbot, GMGN, FOMO, DexScreener, and protocol/DEX destinations with configurable referrals.
- Push notifications use Firebase Cloud Messaging.

## Brand Commitments

- Product name: WhoAped.
- The visual system must be original rather than a Coinbase copy, while matching the clarity, confidence, restraint, accessibility, and production craft expected from a leading financial app.
- Avoid crypto-neon tropes, glassmorphism as a default, inflated marketing headlines, and decorative dashboards that compete with the activity feed.
- Voice is factual, concise, and action-first. No hype, urgency theatre, or invented financial claims.

## Evidence on Hand

- Existing React Native implementation under `apps/mobile/src`.
- Real normalized activity schema and backend implementation under `apps/api/src`.
- Existing native liquid-glass tab bar and App Store/TestFlight configuration.
- No approved logo system or photography is currently required for the main activity surface.

## Product Principles

1. Activity first: the newest meaningful wallet event is the primary content.
2. Decode, do not decorate: visual treatment should make transaction structure easier to understand.
3. Trust through restraint: familiar native behavior, precise language, and predictable hierarchy beat novelty.
4. One glance to comprehension: wallet, action, assets, amount, protocol, and time form a consistent reading order.
5. Watch-only safety is explicit when it matters and silent when it does not.

## Accessibility & Inclusion

Use native semantic roles, VoiceOver labels, at least 44-point touch targets on iOS and 48dp on Android, WCAG AA contrast, Dynamic Type/font scaling, Reduce Motion, and appearance-aware colors. Do not communicate transaction state through color alone.
