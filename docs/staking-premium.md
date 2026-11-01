# Streamflow Premium staging

Premium staking is **Coming Soon**. The purchase flow is hidden in the app and Telegram. Existing payment receipts and support remain processable, but new paid orders are disabled. A disposable **devnet** Streamflow test pool exists; no mainnet pool has been created and no mainnet fee has been paid.

## Product rule

The intended product is a token lock, not a yield promise: lock 1,000,000 WhoAped tokens for Premium, request unstaking after the minimum one-second stake duration, and wait seven days before withdrawal. The real token mint and mainnet pool address are not yet known. A token balance or pasted address alone never grants Premium.

Streamflow staking supports devnet and a pool-level `unstakePeriod`. The verified devnet pool parameters are `minDuration=1`, `maxDuration=1`, user stake `duration=1`, `unstakePeriod=604800`, `autoUnstake=false`, and `freezeStakeMint=true`. The program rejects `minDuration=0` with `InvalidMinDuration`; this was caught by simulation before submitting a transaction. Never create a mainnet pool or pay a setup fee as part of staging.

## What is wired now

- `/v1/staking/offer` returns `provider: streamflow`, `status: coming_soon`, the planned amount and cooldown, and `available: false`. A compile-time `STAKING_LIVE=false` prevents environment variables alone from switching on deposits.
- The app shows Premium · Coming Soon with no staking or purchase button. The Telegram `/premium` command says the same and never asks users to send tokens to the bot.
- The API includes a read-only Streamflow pool/position inspector. It rejects any pool whose mint, seven-day cooldown, one-second duration, manual unstaking, or frozen receipt-mint setting differs from the configured product. The position summarizer counts only matching, open, one-second-duration entries; it does **not** grant an entitlement.
- `npm run check:streamflow` in `apps/api` checks the devnet program and, when configured, the candidate pool. It does not send a transaction.

## Devnet test recipe

1. Fund a dedicated devnet-only wallet with test SOL through the official faucet; the public RPC airdrop can be rate-limited. Keep its key out of Git. Do not use a mainnet production key for testing.
2. Create a devnet test SPL mint with the intended decimals and mint at least 1,000,000 test units to that wallet.
3. Create a **devnet** Streamflow pool with the parameters above. It should have no automatic unstaking and freeze receipt accounts. Record pool and mint addresses.
4. Configure `STREAMFLOW_CLUSTER=devnet`, `STREAMFLOW_RPC_URL`, `STREAMFLOW_POOL_ADDRESS`, `STREAMFLOW_TOKEN_MINT`, `STREAMFLOW_TOKEN_SYMBOL`, and `STREAMFLOW_REQUIRED_AMOUNT_RAW` (one million times ten to the mint decimals). Run `npm run check:streamflow`.
5. Test stake, repeated stakes, request unstake, early withdrawal rejection, seven-day completion, actual withdrawal, wrong-owner access, and pool/mint mismatch. Also inspect what happens to position entries after withdrawal and if the receipt can be transferred. The entitlement rule must be tested against those onchain states.

### Current devnet run (2026-11-01)

- Test wallet `DU4v9rRpp4uy3yHMo9mXLGobd27HkW9prPM4EKTJTD56`; key is locally in ignored `files/private/streamflow-devnet-wallet.json`.
- Six-decimal test mint `5HSZEmt1KXAQRf3sYWVY84B7WBr4AiQ9xnpSvxHwJTL6`; pool `AM9LCVrdrA1afNqfHDCSzy93Sj85MvBZ74QteinAH6gp`; receipt mint `9YB7yJFG1YwTANWR64jMshh8E2XAQbrp11YSkpFdXB2`.
- Created pool, staked 1,000,000 test tokens, and requested unstaking. Receipt account is `Frozen`. The position remains open with `amountRaw=1000000000000`, `duration=1`, and `unstakeTs=1793555516`.
- A withdrawal simulation **before** request failed with `UnstakeRequestRequired`; another **after** request failed with `UnstakeTooEarly`. No failed transaction was submitted.
- Earliest expected withdrawal: **2026-11-08 17:51:56 UTC**. Actual final withdrawal and post-withdrawal position state remain untested until then.
- Repeat the read-only inspection with `STREAMFLOW_TEST_POOL=AM9LCVrdrA1afNqfHDCSzy93Sj85MvBZ74QteinAH6gp node scripts/streamflow-devnet-test.mjs inspect` from `apps/api`. The script refuses a non-devnet RPC; `--execute` is required for any transaction.

## Before any live launch

1. Set the real project-token mint and decimals. Create and verify a devnet pool first; then make a deliberate separate mainnet deployment decision and budget the Streamflow setup fee.
2. Implement nonce-bound wallet ownership proof linked to a canonical WhoAped account. For Telegram, this needs a wallet-signing Mini App or another verifiable signing flow. Android/Seeker can use native Mobile Wallet Adapter. Do not trust a pasted wallet address or a transaction signature by itself.
3. Add wallet-signed stake, request-unstake, and withdraw transaction flows, with error handling and finalized confirmation. Verify that Streamflow's cooldown matches the promised rule. If cancel-request is desired, verify that the deployed program actually supports it before advertising it.
4. Grant and reconcile Premium only from finalized, verified Streamflow positions tied to the signed owner; handle withdrawal, account linking, chain reorgs, RPC outages, and replay attempts. One position must not unlock unrelated accounts.
5. Audit the SDK's transitive dependency advisories and review the pool's privileged authorities, upgradeability, fees, and operational recovery. Review App Store/legal policy before showing any token-lock CTA on iOS.
6. Only then change the hard-off switch, deploy backend, and release clients together. Keep old payment support intact for existing orders.

The older local escrow prototype at `programs/premium-lock` remains **unshipped** and is not the selected provider. Do not deploy it for this feature.
