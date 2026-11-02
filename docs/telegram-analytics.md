# Telegram bot analytics

The API stores first-party Telegram product events in MongoDB collection `telegram_analytics_events`. This remains the exact source of truth for daily bot users and action counts. The stream worker can also forward events to a **separate GA4 Web data stream in the same GA4 property as the iOS and Android Firebase apps**. Firebase Admin SDK does not send Analytics events. Do not use an iOS/Android Firebase App ID or an App stream for the bot: Measurement Protocol App streams require SDK-generated `app_instance_id` values that Telegram cannot provide.

Set these **server-side runtime secrets** on the stream-worker component in DigitalOcean:

- `GA4_TELEGRAM_MEASUREMENT_ID`: `G-K64PZX5YSP` for the dedicated WhoAped Telegram Bot Web stream.
- `GA4_TELEGRAM_API_SECRET`: create a Measurement Protocol API secret for **that same stream** in GA4 Admin → Data streams → Measurement Protocol API secrets.
- `INTERNAL_JOB_SECRET`: already used by the backend; also HMACs Telegram chat IDs into pseudonymous GA4 `client_id` values. Do not rotate it casually, or GA4 will treat existing bot users as new client IDs.

The API secret must never be in the mobile app, website, repository, or client logs. The worker sends only event names, a bounded command category, daily `user_status` (`new`/`returning`), and a pseudonymous client ID; it does not send wallet addresses, message text, usernames or raw Telegram IDs. Delivery is asynchronous, retries temporary failures, and only forwards events from the last 71 hours (GA4 Measurement Protocol's backdating limit is 72 hours). HTTP success means GA4 accepted the request, not that a report has been verified. Measurement Protocol is primarily an augmentation mechanism; server-only bot streams can have incomplete built-in GA4 user/session metrics. For exact bot DAU, new and returning users, use the MongoDB report below. Filter GA4 by stream to avoid mixing the bot audience with app installations.

Deploy the updated API/stream worker to start collecting; historical bot interactions cannot be recovered from Telegram. Events recorded before GA4 is configured can only be forwarded while still within the 71-hour window.

From the DigitalOcean App Console (API component), run:

```sh
npm run analytics:telegram -- 30
```

The output is JSON for the last 30 UTC calendar days (1–366 supported), including zero-activity days. `daily` contains:

- `activeUsers`: distinct private-chat users who sent at least one message or tapped a button that day.
- `newUsers`: active users whose first processed private-chat update was that UTC day.
- `returningUsers`: active users first seen before that day. `newUsers + returningUsers = activeUsers`.
- `interactions`: inbound messages and button taps, counted once per Telegram `update_id`.
- `commands`: slash-command messages only; `buttonTaps` counts inline button callbacks separately.
- `commandsByName`: slash commands and button action names. Callback payload parameters, message text, wallet addresses and usernames are never stored in analytics events.
- `walletsAdded` / `walletsRemoved`: successfully changed wallet records, not attempted commands. Multiple wallets in one message count separately.

`totals` sums daily events and new users over the requested range. **Do not sum `activeUsers` across days to claim unique users over the whole period**; the same user can appear on multiple days. The current UTC day is partial. Existing `telegram_chats.createdAt` is the first-seen source, so users who interacted before instrumentation are correctly classified as returning when they next use the bot. A Telegram chat is counted separately from the linked mobile account for bot engagement.

Events have stable IDs derived from Telegram's `update_id` and, for bulk wallet actions, line number; retries do not double-count them. Event-write failures are logged but do not interrupt bot actions. Raw event collection has no TTL for now; monitor its size and add an archival/rollup policy when volume warrants it.
