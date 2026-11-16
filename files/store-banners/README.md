# WhoAped store banners

Prepared 7 November 2026. English artwork in the existing **The Live Ledger** brand, using the exact Detected logo and checked-in Space Grotesk fonts.

| File | Placement | Dimensions |
| --- | --- | --- |
| `01-apple-header` | Apple product page header | 3840 × 1646 |
| `02-apple-search` | Apple search results | 3840 × 2560 |
| `03-solana-listing-banner` | Solana dApp Store listing banner | 1200 × 600 |
| `04-solana-feature-graphic` | Solana editorial feature graphic | 1200 × 1200 |

Each banner has SVG, RGB PNG and RGB JPG exports. Use the JPG files for submission: they have no alpha channel. The two `SAFE-AREA.svg` files are reference guides only and must not be submitted.

The final JPGs were exported directly from the verified Figma frames at 1× into `figma-exports/`, then copied to the numbered delivery filenames. The PNGs and contact sheet use those final native exports. SVG files remain the original vector source compositions.

Apple art-safe-area bounds were read directly from the `Art Safe Area` layers in the official PSD templates:

- Header: x1097, y493, width1646, height661.
- Search: x836, y765, width2168, height1030.

Solana's `featureGraphic` is the square editorial asset. No award or Editor's Choice badge is claimed in the artwork. Final editorial placement remains the store's decision.

Sources:

- https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications
- https://developer.apple.com/app-store/asset-best-practices/
- https://devimages-cdn.apple.com/design/resources/download/app-store/creative_assets-product_page_header_template-static.psd
- https://devimages-cdn.apple.com/design/resources/download/app-store/creative_assets-search_results_template-static.psd
- https://docs.solanamobile.com/dapp-store/listing-page-guidelines
- https://github.com/solana-mobile/dapp-publishing/blob/main/publishing-spec/SPEC.md

The editable Figma file is in Personal: https://www.figma.com/design/fisuvajEDXx8uP2A8lcyCi?node-id=7-2

The four final frames are on **Store banners · EN**. Text is native and editable; the logo uses vector component instances. Guide copies and linked source notes are separate from the export frames. The prior imported guide on Page 1 was preserved.

`build_artwork.py` recreates the graphics and contact sheet with Pillow and resvg-py. The native Figma source builder under `figma-plugin/` has no network access. It was imported and run on 8 November 2026 with the user's explicit approval. The final native composition passed visual review, font checks, frame-size checks, and Apple text-safe-area checks. See `figma-validation.json` for the observed frame IDs and validation results.
