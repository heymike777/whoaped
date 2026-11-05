# Discovery v1

- Source: Kolscan's Solana profiles. The project owner has confirmed permission to import these profiles. The original bundled snapshot remains a fallback.
- The existing `parsed-stream-worker` attempts a refresh at startup and checks the persistent schedule hourly. A MongoDB lease allows one worker to fetch the leaderboard once per successful 24-hour period; errors retry after one hour. A malformed or unexpectedly small response never replaces existing profiles.
- `discovery_profiles` is append-only by address: new wallets are added, existing names/social links are refreshed, and profiles missing from a later scrape remain visible. `discovery_sync` stores the last success, next run, count, and last error.
- Manual fallback: run `node apps/api/scripts/import-kolscan.mjs` from the repository root and review the generated snapshot diff before deployment. Normal daily refreshes do not modify git.
- Discovery profiles are **not** inserted into `wallets` or any Helius subscription. Tracking starts only when a user taps **Track**; the existing per-user wallet limit and duplicate checks apply.
- Search and pagination are served from `GET /v1/discovery`, merging the bundled snapshot with the latest MongoDB profiles.

## PnL follow-up

Add a separately refreshed `discovery_performance` dataset keyed by `(chain, address, window, methodology_version)`, with `window` equal to 1d/7d/30d. Prefer independently computed realized trading PnL in USD (proceeds minus acquisition cost and transaction fees for closed positions), not wallet balance change or leaderboard rank. Include `asOf`, `coverage`, and an `incomplete` flag: transfers, open positions, missing prices, and offchain activity make wallet PnL misleading. Compute in a batch job for visible catalog profiles rather than subscribing every wallet to Helius. Do not display a number until the methodology is validated against sample wallets.
