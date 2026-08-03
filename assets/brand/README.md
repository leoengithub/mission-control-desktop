# Mission Control Brand Assets

The visual identity is built around a compact mission-control operator console. The physical panel gives the application a recognizable app icon while its lamps and screen rows connect directly to pull request attention states.

## Files

- `app-icon-source.png`: transparent master used by `corepack pnpm tauri icon`
- `raster/onboarding-hero.png`: first-run and GitHub authorization artwork
- `raster/empty-attention.png`: inbox-clear empty state
- `raster/social-hero.png`: wide README and social-preview background
- `vector/tray-template.svg`: monochrome macOS menu-bar template
- `vector/status-*.svg`: semantic status glyphs with shape and color redundancy
- `palette.json`: initial sRGB approximations for asset production

The Tauri-generated platform bundle is committed under `src-tauri/icons`. UI colors should continue using the documented OKLCH system rather than importing the asset palette as application tokens.
