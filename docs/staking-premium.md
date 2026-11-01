# Streamflow Premium staging

Premium staking is **Coming Soon**. The purchase flow is hidden in the app and Telegram. Existing payment receipts and support remain processable, but new paid orders are disabled. No WhoAped Streamflow pool has been created and no mainnet fee has been paid.

## Product rule

The intended product is a token lock, not a yield promise: lock 1,000,000 WhoAped tokens for Premium, request unstaking at any time, and wait seven days before withdrawal. The actual token mint and pool address are not yet known. A token balance or pasted address alone never grants Premium.

Streamflow staking supports devnet and a pool-level `unstakePeriod`. The proposed pool parameters are `minDuration=0`, user stake `duration=0`, `unstakePeriod=604800`, `autoUnstake=false`, and `freezeStakeMint=true`. Verify the exact request/withdraw behavior and receipt-token freezing in a funded devnet end-to-end test before using these settings on mainnet. Never create a mainnet pool or pay a setup fee as part of staging.

## What is wired now

- `/v1/staking/offer` returns `provider: streamflow`, `status: coming_soon`, the planned amount and cooldown, and `available: false`. A compile-time `STAKING_LIVE=false` prevents environment variables alone from switching on deposits.
- The app shows Premium · Coming Soon with no staking or purchase button. The Telegram `/premium` command says the same and never asks users to send tokens to the bot.
- The API includes a read-only Streamflow pool/position inspector. It rejects any pool whose mint, seven-day cooldown, immediate requestability, or frozen receipt-mint setting differs from the configured product. The position summarizer counts only matching, open, zero-duration entries; it does **not** grant an entitlement.
- `npm run check:streamflow` in `apps/api` checks the devnet program and, when configured, the candidate pool. It does not send a transaction.

## Devnet test recipe

1. Fund a dedicated devnet-only wallet with test SOL through the official faucet; the public RPC airdrop can be rate-limited. Keep its key out of Git. Do not use a mainnet production key for testing.
2. Create a devnet test SPL mint with the intended decimals and mint at least 1,000,000 test units to that wallet.
3. Create a **devnet** Streamflow pool with the parameters above. The pool should be permissionless, have no automatic unstaking, and use a frozen/nontransferable receipt mint. Record pool and mint addresses.
4. Configure `STREAMFLOW_CLUSTER=devnet`, `STREAMFLOW_RPC_URL`, `STREAMFLOW_POOL_ADDRESS`, `STREAMFLOW_TOKEN_MINT`, `STREAMFLOW_TOKEN_SYMBOL`, and `STREAMFLOW_REQUIRED_AMOUNT_RAW` (one million times ten to the mint decimals). Run `npm run check:streamflow`.
5. Test stake, repeated stakes, request unstake, early withdrawal rejection, seven-day completion, actual withdrawal, wrong-owner access, and pool/mint mismatch. Also inspect what happens to position entries after withdrawal and if the receipt can be transferred. The entitlement rule must be tested against those onchain states.

## Before any live launch

1. Set the real project-token mint and decimals. Create and verify a devnet pool first; then make a deliberate separate mainnet deployment decision and budget the Streamflow setup fee.
2. Implement nonce-bound wallet ownership proof linked to a canonical WhoAped account. For Telegram, this needs a wallet-signing Mini App or another verifiable signing flow. Android/Seeker can use native Mobile Wallet Adapter. Do not trust a pasted wallet address or a transaction signature by itself.
3. Add wallet-signed stake, request-unstake, and withdraw transaction flows, with error handling and finalized confirmation. Verify that Streamflow's cooldown matches the promised rule. If cancel-request is desired, verify that the deployed program actually supports it before advertising it.
4. Grant and reconcile Premium only from finalized, verified Streamflow positions tied to the signed owner; handle withdrawal, account linking, chain reorgs, RPC outages, and replay attempts. One position must not unlock unrelated accounts.
5. Audit the SDK's transitive dependency advisories and review the pool's privileged authorities, upgradeability, fees, and operational recovery. Review App Store/legal policy before showing any token-lock CTA on iOS.
6. Only then change the hard-off switch, deploy backend, and release clients together. Keep old payment support intact for existing orders.

The older local escrow prototype at `programs/premium-lock` remains **unshipped** and is not the selected provider. Do not deploy it for this feature.
