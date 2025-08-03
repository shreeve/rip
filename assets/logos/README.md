<img src="/assets/logos/rip-icon-512wa.png" style="width:50px" /> <br>

# Rip Logo Assets

This directory contains the official logo files for the Rip multilanguage universal runtime.

## Logo Files

### Primary Logo
- **`rip-logo.svg`** - Main logo with ⟨R⟩ symbol and "Rip" wordmark (light backgrounds)
- **`rip-logo-dark.svg`** - White version for dark backgrounds

### Icon Only
- **`rip-icon.svg`** - Icon-only version ⟨R⟩ (square format, perfect for favicons)

## Usage Guidelines

### When to Use Each Version
- **Full Logo**: Use in headers, documentation, presentations, and marketing materials
- **Icon Only**: Use for favicons, app icons, social media profile pictures, or when space is limited
- **Dark Version**: Use on dark backgrounds, terminals, or dark-themed interfaces

### Color Specifications
- **Primary Red**: #FF4444 (RGB: 255, 68, 68)
- **Text Gray**: #333333 (RGB: 51, 51, 51)
- **White**: #FFFFFF (RGB: 255, 255, 255)

### Minimum Sizes
- **Full Logo**: 80px width minimum
- **Icon**: 16px minimum (favicon size)

### Font
- Primary: Inter (Google Fonts)
- Fallback: SF Pro Display, system-ui, sans-serif

## Creating Additional Formats

### PNG Export (using Inkscape or similar)
```bash
# Export PNG at different sizes
inkscape rip-logo.svg --export-png=rip-logo-256.png --export-width=256
inkscape rip-logo.svg --export-png=rip-logo-128.png --export-width=128
inkscape rip-icon.svg --export-png=rip-icon-32.png --export-width=32
inkscape rip-icon.svg --export-png=rip-icon-16.png --export-width=16
```

### Favicon Creation
The `rip-icon.svg` can be converted to favicon formats:
- 16x16 PNG for `favicon-16x16.png`
- 32x32 PNG for `favicon-32x32.png`
- ICO format for `favicon.ico`

## Logo Meaning

The **⟨R⟩** logo represents:
- **Angle Brackets**: Universal parsing notation, familiar to developers
- **R**: Rip, the multilanguage universal runtime
- **Connection**: The brackets embrace and connect all programming languages
- **Simplicity**: Clean, minimal design that works at any size

## License

These logo files are part of the Rip project and should be used in accordance with the project's licensing terms.