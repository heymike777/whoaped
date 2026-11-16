# WhoAped launch video — version 5

English project-and-token launch creative for traders on X and Telegram: 30 seconds, 1080 × 1080, 30 fps. The final two cards announce WhoAped and end on **Powered by $WHOAPED**. This is brand copy, not a claim about an existing token, price, utility, or launch date. No mobile-app changes are needed to build the video.

## Reproduce

Requires Node.js 22+ and Python 3. Remotion downloads its own rendering browser on first use. The first render requires network access; subsequent renders use local assets.

```sh
cd apps/launch-video
npm ci
npm run assets
python3 scripts/make-soundtrack.py
npm run typecheck
npm run studio
npm run render
npm run poster
npm run closing
```

The video, cover, and closing preview are written to `outputs/launch-video-v5/` at the repository root. Previous MP4s remain in their versioned output directories. All `remotion` packages are pinned to the same version. Runtime dependencies are isolated from the mobile and API projects.

Version 5 replaces the launch-film example labels `yarl` → `$CLMFND` in the explanatory row and notification, and `$NEWSCUM` → `$WHOAPED` in the app screenshot shown inside the film. The source screenshot remains untouched; the replacement is a Remotion overlay. These are illustrative labels, not a representation of an actual onchain transaction involving those tokens.

Version 4 reframes the story for Solana traders, extends it to 30 seconds, and adds a distinct token-brand reveal after the project CTA. The soundtrack is extended and accented to meet that reveal.

Version 3 changed the closing CTA to “Start watching.” and updated the companion subtitles and post copy.

Version 2 revises the add-wallet scene: a single-line “Start with a wallet.” headline, one complete native sheet, a gentle camera move, and a tap accent inside the original button. It removes the duplicated phone / disconnected field crop and the added readiness annotation. Other scenes and the 24-second timing are unchanged.

## Story

| Time | Scene |
| --- | --- |
| 0–3 s | “Who just aped?” and “Follow the wallets that move first.” |
| 3–7 s | “Watch the wallets.” with the native add-wallet sheet |
| 7–14.7 s | “The move. Not the hash.” with native activity and Who / What / Where |
| 14.7–19.7 s | “Wallet activity. In plain English.” with an illustrative alert |
| 19.7–24.5 s | “WhoAped is launching.” → whoaped.com → “Follow the launch.” |
| 24.5–30 s | “Powered by $WHOAPED” token-brand reveal |

Scene overlaps are 10 frames; full scene durations are 100 / 130 / 240 / 160 / 155 / 165 frames, producing 900 frames total. All animations use the Remotion frame clock. Font loading and image readiness are handled by Remotion before capture.

## Provenance and presentation

- Brand source: `brand.md`, `DESIGN.md`, and `files/whoaped-app-icon.svg`.
- Typography: the project's existing local Space Grotesk Regular and Bold files; no remote font fetching.
- App screenshots: `files/store-screenshots/captures/ios/06-add-wallet.png` and `01-activity.png`. Their capture provenance is documented in `files/store-screenshots/README.md`.
- The activity scene uses a native capture as a design base, but two token labels are overlaid for the launch film. Its footer explicitly says “Illustrative UI · token labels adapted for launch.” The `SOL → $CLMFND` annotation and `$WHOAPED` screenshot label are independent illustrative examples, not a single transaction or evidence of a live token market.
- The add-wallet scene and subsequent activity are a **demo sequence of separate native captures**, not a recording of a single continuous session. The add-wallet capture uses a different public-wallet example.
- The notification is a **motion graphic preview**, not evidence of measured push delivery or an actual `$CLMFND` swap. It is labeled “Illustrative notification · sample values.” Its title/body follow the wallet-name and normalized-activity pattern in `apps/api/src/services/parsed-transactions.ts`.
- Audio is original, deterministic synthesized audio from `scripts/make-soundtrack.py`: a quiet harmonic bed, soft plucks, and transition swells, including a final reveal accent. No stock track, external voiceover, or licensed music service is used.
- The CTA is `whoaped.com` and “Follow the launch.” The video promises no store availability or token mechanics.

## Editing

`src/Video.tsx` contains scene layout, copy, timings, and colors. `src/Root.tsx` defines the output dimensions and duration. The screenshot assets are copied from their original repository locations by `npm run assets`; avoid editing the source captures to change data. To substitute a new transaction, replace the capture and its matching annotations / illustrative notification together.

The `.srt` in the output directory is a companion text transcript of the on-screen story, not a speech transcription. The MP4 already contains all essential text and works without sound.
