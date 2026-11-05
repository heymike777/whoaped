# Discovery v1

- Source: a one-time snapshot of Kolscan's Solana profiles. The project owner has confirmed permission to import these profiles. The imported source URL and timestamp are stored with the snapshot.
- Refresh: run `node apps/api/scripts/import-kolscan.mjs` from the repository root and review the generated diff before deployment. This is an explicit maintenance step, not a background job.
- Profiles are static catalog entries. They are **not** inserted into `wallets` or any Helius subscription. Tracking starts only when a user taps **Track**; the existing per-user wallet limit and duplicate checks apply.
- Search and pagination are served from `GET /v1/discovery`. No additional database collection or scheduled indexer is required for the initial catalog.

## PnL follow-up

Add a separately refreshed `discovery_performance` dataset keyed by `(chain, address, window, methodology_version)`, with `window` equal to 1d/7d/30d. Prefer independently computed realized trading PnL in USD (proceeds minus acquisition cost and transaction fees for closed positions), not wallet balance change or leaderboard rank. Include `asOf`, `coverage`, and an `incomplete` flag: transfers, open positions, missing prices, and offchain activity make wallet PnL misleading. Compute in a batch job for visible catalog profiles rather than subscribing every wallet to Helius. Do not display a number until the methodology is validated against sample wallets.
