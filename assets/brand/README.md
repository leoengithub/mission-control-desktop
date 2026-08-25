# Captain Brand Assets

The visual identity is built around a professional pirate-captain tricorn. A subtle Git pull-request branch insignia replaces the traditional skull, using near-black graphite on warm ivory with restrained review green. The silhouette stays legible at small sizes without borrowing semantic warning or failure colors.

## Files

- `app-icon-source.png`: 1254px master used by `corepack pnpm tauri icon`
- `raster/onboarding-hero.png`: first-run and GitHub authorization artwork
- `raster/empty-attention.png`: inbox-clear empty state
- `raster/social-hero.png`: wide README and social-preview background
- `vector/tray-template.svg`: monochrome macOS menu-bar template
- `vector/status-*.svg`: semantic status glyphs with shape and color redundancy
- `palette.json`: initial sRGB approximations for asset production

The Tauri-generated platform bundle is committed under `src-tauri/icons`. The macOS menu-bar template is a monochrome silhouette and must not carry brand color. Semantic `status-*.svg` assets are preserved because they communicate state rather than product identity. UI colors should continue using the documented OKLCH system rather than importing the asset palette as application tokens.
