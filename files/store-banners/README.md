# WhoAped store banners

Prepared 7 November 2026. English artwork in the existing **The Live Ledger** brand, using the exact Detected logo and checked-in Space Grotesk fonts.

| File | Placement | Dimensions |
| --- | --- | --- |
| `01-apple-header` | Apple product page header | 3840 × 1646 |
| `02-apple-search` | Apple search results | 3840 × 2560 |
| `03-solana-listing-banner` | Solana dApp Store listing banner | 1200 × 600 |
| `04-solana-feature-graphic` | Solana editorial feature graphic | 1200 × 1200 |

Each banner has SVG, RGB PNG and RGB JPG exports. Use the JPG files for submission: they have no alpha channel. The two `SAFE-AREA.svg` files are reference guides only and must not be submitted.

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

`build_artwork.py` recreates the graphics and contact sheet with Pillow and resvg-py. The native Figma source builder under `figma-plugin/` has no network access and has not been installed or run; installation requires explicit user approval. Normal SVG import does not run this builder.
