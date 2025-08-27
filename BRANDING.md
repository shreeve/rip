<img src="/assets/logo.png" style="width:50px" />

# Rip Brand

Official logo assets and visual identity in one place. Simple, consistent, and ready to use.

## Design Philosophy
- Simple: clean, minimal, instantly recognizable
- Clever: nods to “rip” (speed) and universal connectivity
- Fresh: modern, distinctive, memorable
- Scalable: works from favicon to billboard

## Logo Assets

### Files
- rip-logo.svg — Full logo (⟨R⟩ + wordmark)
- rip-logo-dark.svg — White for dark backgrounds
- rip-icon.svg — Icon-only ⟨R⟩ (favicons, avatars)

### Usage
- Full Logo: headers, docs, presentations
- Icon Only: favicons, app icons, small spaces
- Dark Version: on dark backgrounds/terminals

### Colors
- Primary Red: #FF4444
- Text Gray: #333333
- White: #FFFFFF

### Fonts
- Primary: Inter (Google Fonts)
- Fallback: SF Pro Display, system-ui, sans-serif

### Minimum Sizes
- Full Logo: ≥ 80px width
- Icon: ≥ 16px (favicon)

## SVG Templates

```svg
<!-- Primary Logo: ⟨R⟩ -->
<svg width="100" height="40" viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 10 L5 20 L10 30" stroke="#FF4444" stroke-width="3" fill="none"/>
  <text x="50" y="25" text-anchor="middle" font-family="Inter, sans-serif" font-size="20" font-weight="bold" fill="#FF4444">R</text>
  <path d="M90 10 L95 20 L90 30" stroke="#FF4444" stroke-width="3" fill="none"/>
</svg>

<!-- Icon Only -->
<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 8 L2 16 L6 24" stroke="#FF4444" stroke-width="2" fill="none"/>
  <text x="16" y="20" text-anchor="middle" font-family="Inter, sans-serif" font-size="14" font-weight="bold" fill="#FF4444">R</text>
  <path d="M26 8 L30 16 L26 24" stroke="#FF4444" stroke-width="2" fill="none"/>
</svg>
```

## Export & Formats

### PNG Export (example with Inkscape)
```bash
inkscape rip-logo.svg --export-png=rip-logo-256.png --export-width=256
inkscape rip-icon.svg  --export-png=rip-icon-32.png  --export-width=32
```

### Favicons
- 16x16 and 32x32 PNGs; optional ICO for favicon.ico

## Logo Meaning
- Angle Brackets: universal parsing notation
- R: Rip, the multilanguage universal runtime
- Connection: brackets embrace and connect languages
- Simplicity: clean design that scales

## License
MIT

## Contributing
Improvements welcome. Keep it simple and consistent.


