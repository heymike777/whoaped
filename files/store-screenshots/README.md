# WhoAped store screenshots

The English compositions use WhoAped’s paper and ink palette, Space Grotesk, and the current app icon. Each device mockup contains a genuine screenshot from the native app. Test watchlists use public Solana addresses.

## Store assets

| Series | Files | Dimensions | Capture device |
| --- | ---: | --- | --- |
| App Store · iPhone | 8 | 1206 × 2622 | WhoAped Store iPhone, iOS 27.0 |
| App Store · iPhone large | 8 | 1320 × 2868 | Adaptation of the iPhone captures |
| App Store · iPad 13″ | 4 | 2064 × 2752 | WhoAped Store iPad, iPadOS 27.0 |
| Solana Mobile dApp Store | 8 | 1080 × 1920 | WhoAped API 36 Android emulator |

The iPhone series shows activity, swaps, multi-step routes, Solscan, the watchlist, adding an address, notification settings and dark mode. Android features watchlist search and failed-transaction preferences alongside activity, Solscan, the watchlist, wallet setup, notification settings and dark mode. The iPad series shows activity in light and dark appearances, wallet setup and notification settings.

- [Full set of JPEGs](exports/WhoAped-Store-Screenshots.zip)
- [Solana Mobile JPEGs](exports/WhoAped-Solana-dApp-Store.zip)
- [Preview](exports/preview.jpg)
- [Export dimensions and file sizes](exports/validation.json)
- [Editable Figma artwork](https://www.figma.com/design/fisuvajEDXx8uP2A8lcyCi?node-id=21-32)
- [Local Figma import package](exports/WhoAped-Figma-Import.zip)

The artwork uses a phone class defined by Apple’s medium Dynamic Island specification, includes the large Dynamic Island class, and uses a native 13-inch iPad canvas. Apple scales assets for smaller device classes. The eight Solana Mobile JPEGs use a uniform 9:16 aspect ratio and are each under 3 MB.

- [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [Solana Mobile listing guidelines](https://docs.solanamobile.com/dapp-store/listing-page-guidelines)

## Rebuild

The raw simulator screenshots are under `captures/`. Run `python3 render_exports.py --partial` and `python3 build_figma_plugin.py --partial` with Pillow installed to regenerate the present selection. The scripts also support all eight storyboard slots per platform if corresponding captures are added. The Figma plugin uses editable titles, vector device shells and replaceable screenshot fills. Import `figma-plugin/manifest.json` through Figma Desktop’s development menu and run **WhoAped · Store screenshots** in the targeted design file.
