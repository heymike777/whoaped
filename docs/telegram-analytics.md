# Telegram bot analytics

The API stores first-party Telegram product events in MongoDB collection `telegram_analytics_events`. No Google/Firebase analytics SDK, extra service or environment variable is needed. Deploy the updated API/stream worker to start collecting; historical bot interactions cannot be recovered from Telegram.

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
