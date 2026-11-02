# Paybox wallet import

Set `PAYBOX_REDIRECT_URI` on the API to its public HTTPS URL followed by `/integrations/paybox/callback`. The mobile button is visible only when the authenticated availability endpoint reports it enabled. Deploy this API before the mobile release. No client secret or manual client registration is required: Paybox supports dynamic registration.

WhoAped opens system-browser OAuth with S256 PKCE and random, single-use state. The HTTPS callback imports granted Solana wallet names and public addresses using MCP `list_credentials`. It never reads ungranted credentials or invokes payment/signing tools. OAuth scope is `mcp`; Paybox does not document an address-only scope. The UI explains this and recommends approval for every operation. No `offline_access` is requested and no Paybox tokens are persisted. Paybox may retain the connector grant; users can revoke it in Paybox Clients after import.

The app polls its authenticated import record after returning from the browser and lets the user choose addresses. Existing tracked addresses are disabled. Selected wallets use the normal wallet creation endpoint, including its duplicate validation and ingestion behavior. Closing cancels the import. Import records expire after ten minutes and are deleted after the app retrieves the result.

Exclude callback query strings from reverse-proxy/access logs as well as application logs. The callback sends `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The mobile session token is never sent to Paybox or included in browser URLs.

Verify with a real Paybox account before enabling in production: approve a Solana wallet, return to WhoAped, select it, and confirm activity tracking; also check denial, an EVM-only grant, duplicates, expired connections and cancellation. Live consent requires the user's passkey.

References: https://docs.paybox.sh/connect/oauth and https://docs.paybox.sh/reference/mcp-tools (checked 2026-11-02).
