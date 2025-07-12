<img src="assets/logos/rip-icon-512wa.png" style="width:50px;float:left;" /><br>

# Brand Assets

**Official Rip Branding & Visual Identity**

This document provides official Rip branding assets, including logos, icons, and visual identity guidelines. Use these resources to represent Rip in your projects, articles, and community contributions.

## Design Philosophy
- **Simple**: Clean, minimal, instantly recognizable
- **Clever**: Reflects both "rip" (tear/speed) and universal connectivity
- **Fresh**: Modern, distinctive, memorable
- **Scalable**: Works at any size from favicon to billboard

## Official Logo

### The Universal Connector ⟨R⟩
```
Primary Logo:
┌─────────────────┐
│       ⟨R⟩       │  ← Main logo
│       Rip       │  ← Wordmark
└─────────────────┘

Icon Only:
┌─────┐
│ ⟨R⟩ │  ← Icon version
└─────┘

Connection Concept:
    ⟨R⟩
   ╱ │ ╲
  ╱  │  ╲
Lang Parse Runtime
```

### Visual Elements
- **Main Symbol**: ⟨R⟩ in bold, modern sans-serif
- **Angle Brackets**: Slightly wider than normal, suggesting embrace/inclusion
- **Typography**: Clean, technical font (like SF Pro or Inter)
- **Color**: Vibrant red (#FF4444) for energy and revolution

### Icon Variations
1. **Full Logo**: ⟨R⟩ with "Rip" wordmark
2. **Icon Only**: Just the ⟨R⟩ symbol
3. **Monochrome**: Black/white versions
4. **Favicon**: Simplified R in angled brackets

### Usage Guidelines
- **Primary**: Red ⟨R⟩ on white background
- **Reversed**: White ⟨R⟩ on dark background
- **Accent**: Use with tech color palette (blues, greens, purples)
- **Minimum Size**: 16px for digital, 0.5" for print

## Implementation Notes
- SVG format for scalability
- Consistent stroke width (2-3px)
- Rounded corners for friendliness
- High contrast for accessibility
- Works in single color for embossing/etching

## SVG Logo Code Template
```svg
<!-- Primary Logo: ⟨R⟩ -->
<svg width="100" height="40" viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
  <!-- Left angle bracket -->
  <path d="M10 10 L5 20 L10 30" stroke="#FF4444" stroke-width="3" fill="none"/>

  <!-- Letter R -->
  <text x="50" y="25" text-anchor="middle" font-family="Inter, sans-serif"
        font-size="20" font-weight="bold" fill="#FF4444">R</text>

  <!-- Right angle bracket -->
  <path d="M90 10 L95 20 L90 30" stroke="#FF4444" stroke-width="3" fill="none"/>
</svg>

<!-- Icon Only Version -->
<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 8 L2 16 L6 24" stroke="#FF4444" stroke-width="2" fill="none"/>
  <text x="16" y="20" text-anchor="middle" font-family="Inter, sans-serif"
        font-size="14" font-weight="bold" fill="#FF4444">R</text>
  <path d="M26 8 L30 16 L26 24" stroke="#FF4444" stroke-width="2" fill="none"/>
</svg>
```

## Logo File Generation Instructions
To create the actual logo files:

1. **SVG Files**: Use the SVG code above as a starting point
2. **PNG/JPG**: Export SVG at multiple resolutions (16px, 32px, 64px, 128px, 256px, 512px)
3. **Favicon**: Create 16x16 and 32x32 versions
4. **Vector**: Keep original SVG for infinite scalability


**Download Ready-to-Use Assets**: [Download Logo Files](assets/logos/) (coming soon)
**Download Ready-to-Use Assets**: [Download Logo Files](assets/logos/) (coming soon)

## Font Recommendations
- **Primary**: Inter (Google Fonts)
- **Alternative**: SF Pro Display (Apple)
- **Fallback**: system-ui, -apple-system, BlinkMacSystemFont, sans-serif

## Brand Colors
- **Primary Red**: #FF4444 (energy, revolution)
- **Tech Blue**: #4A90E2 (trust, technology)
- **Success Green**: #7ED321 (growth, compatibility)
- **Warning Orange**: #F5A623 (attention, innovation)
- **Neutral Gray**: #9B9B9B (balance, sophistication)

## Tagline Integration
When used with tagline, consider:
- "Rip ⟨Universal Language Platform⟩"
- "⟨R⟩ Rip - Parse Everything"
- "Rip ⟨Code Without Borders⟩"

## Quick Logo Creation Tools
For immediate logo creation, you can use:

1. **Online SVG Editors**:
   - Copy the SVG code above into any SVG editor
   - Adjust colors, fonts, and spacing as needed

2. **Design Tools**:
   - Figma: Create artboard, add text "R" and angle bracket shapes
   - Canva: Use text and line tools to recreate the design
   - Adobe Illustrator: Vector-based creation for professional results

3. **Command Line**:
   ```bash
   # Create favicon using ImageMagick (if available)
   convert -size 32x32 xc:white -font Inter-Bold -pointsize 14 \
           -fill "#FF4444" -gravity center -annotate 0 "⟨R⟩" favicon.png
   ```

## Logo Usage Examples
```
Terminal/CLI:
⟨R⟩ rip build grammar.rip

GitHub README:
# ⟨R⟩ Rip - Universal Language Platform

Website Header:
⟨R⟩ Rip | Parse Everything

Social Media:
⟨R⟩ Just released Rip v2.0! 🚀
```

## Related Docs
- [README](../README.md) - Project overview
- [Future Roadmap](./future-roadmap.md) - Long-term vision
- [Quickstart](./quickstart.md) - Getting started

---

*Official Rip Brand Assets - Use with pride!* 🚀