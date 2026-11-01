# Premium by token lock — prototype, not live

The payment UI is hidden in Telegram and Android/Seeker. The API rejects new USDC orders and the bot rejects old purchase callbacks. Existing USDC orders, Telegram Stars receipts, refunds, and support remain processable so no in-flight payment is stranded.

## Intended rules

- The test token is mainnet BONK mint `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` (5 decimals). A million BONK is `100000000000` raw units. The production mint will be chosen later.
- One owner locks exactly the configured amount in a PDA-controlled SPL vault. The user retains control of the withdrawal path; the operator cannot transfer the deposit.
- The owner can request unlock at any time. The 7-day clock starts at that request. Premium stays active during cooldown and ends only when the deposit is withdrawn. The owner may cancel an unlock request.
- Pausing the pool blocks new locks, never normal withdrawals. An owner can immediately withdraw while the pool is emergency-paused.
- No staking rewards or yield are promised. The accurate product term is **token lock for Premium**.

## Local program prototype

`programs/premium-lock` contains the escrow state machine and pure deadline tests. The program ID in source is a local prototype ID, **not** an audited or deployed mainnet program. The public API's `/v1/staking/offer` returns `available: false`; no backend entitlement is granted from this prototype.

## Required before enabling deposits

1. Test lock, request, cancel, seven-day time travel, withdraw, emergency withdraw, duplicate position, wrong owner/mint/vault, and account-closure attacks in a Solana local validator or Surfpool fork with the BONK mint. Fuzz state transitions and vault conservation.
2. Obtain independent contract security review. Specify upgrade authority, pause authority, and multisig custody of privileged keys. Do not enable the feature or deploy mainnet custody before review.
3. Add wallet ownership proof: a nonce-bound, short-lived signed challenge for a canonical WhoAped account. The Telegram bot needs a wallet-signing Mini App; the Seeker app can use its existing native Mobile Wallet Adapter. Never accept a pasted address or a transaction signature alone as proof of ownership.
4. Build transaction construction and signing for lock, request unlock, cancel, and withdraw. Confirm onchain at finalized commitment and handle retries, app switching, and lost network connectivity.
5. Derive the position PDA server-side, verify program ownership, owner, mint, config, locked raw amount, and vault state from finalized RPC. Resolve Premium dynamically from that verified position; do not issue a permanent paid entitlement for a lock. One staked position must not unlock unrelated accounts.
6. Add reconciliation for account-link merges, withdrawals and RPC outages. Fail closed on unverifiable new grants; do not silently revoke an already verified active lock during a brief RPC outage.
7. Replace BONK with the actual token mint, verify decimals and token program, and update the offer and pool configuration together. Coordinate backend deployment and Android/bot rollout. Keep iOS out of this flow pending App Review/legal review.

The present UI intentionally says the lock is not live and warns users not to transfer tokens to a bot or arbitrary address.
