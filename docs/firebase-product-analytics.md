# Product analytics in one GA4 property

The Firebase project `whoaped` is linked to GA4 property `whoaped.com` (`561921602`). The native iOS and Android apps use `@react-native-firebase/analytics`; the landing page uses its GA4 Web stream after consent; the Telegram bot forwards from MongoDB through Measurement Protocol to a separate Web stream. Each surface has its own stream, making filtering possible in GA4. Do not interpret GA4's cross-platform total users as a de-duplicated count of people: one person may have a website browser, app installation and Telegram chat with separate identifiers.

GA4 streams created or confirmed on 2026-11-02:

| Surface | Stream ID | Measurement ID / app |
| --- | --- | --- |
| Landing page | `16254489473` | `G-N6ZMCJLS6S` (`GA_MEASUREMENT_ID` at Vercel build time) |
| Telegram bot | `16254934852` | `G-K64PZX5YSP` (`GA4_TELEGRAM_MEASUREMENT_ID` on the stream worker) |
| iOS | `16254847545` | `com.whoaped.app` |
| Android | `16254819895` | `com.whoaped.app` |

The mobile app logs tab `screen_view` events and manual wallet add/remove successes and failures, without addresses, transaction hashes or wallet names. Firebase automatically collects app lifecycle events when Analytics is enabled. The project link and app streams are now present. The Firebase SDK config API still returns the older `IS_ANALYTICS_ENABLED=false` field for the iOS app; leave that generated file untouched. `Info.plist` explicitly sets the documented `FIREBASE_ANALYTICS_COLLECTION_ENABLED=true` override. Do not claim mobile analytics is live until a build is installed and test events are observed. Update App Store / Play privacy disclosures as appropriate before release.

For the bot stream and exact-count caveats, see [telegram-analytics.md](telegram-analytics.md). Verify an opt-in landing page view, one mobile `wallet_added`, and one bot `telegram_wallet_added` in GA4 Realtime/DebugView before relying on reports. Custom event parameters such as `command_name` may need custom dimensions registered in GA4 to appear in standard reports.
