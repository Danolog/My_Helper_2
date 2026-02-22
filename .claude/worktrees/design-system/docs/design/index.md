# MyHelper Design System

A warm, elegant design system inspired by luxury beauty & wellness aesthetics. Combines organic terracotta tones with refined serif typography to create a professional yet approachable experience for salon owners and their clients.

## Design Philosophy

- **Warm & Organic**: Earthy terracotta palette evokes trust and natural beauty
- **Elegant Simplicity**: Clean layouts with generous whitespace
- **Professional Polish**: Serif headings convey expertise; sans-serif body ensures readability
- **Mobile-First**: Every component designed for touch interactions first
- **Accessible**: WCAG 2.1 AA compliant contrast ratios throughout

## System Files

| File | Description |
|------|-------------|
| [colors.md](./colors.md) | Complete color palette with semantic tokens |
| [typography.md](./typography.md) | Font families, type scale, and text styles |
| [spacing.md](./spacing.md) | Spacing scale, layout grid, and breakpoints |
| [components.md](./components.md) | Component specifications and variants |
| [patterns.md](./patterns.md) | Page layout patterns and section templates |
| [tokens.css](./tokens.css) | CSS custom properties (copy into globals.css) |
| [tailwind-preset.ts](./tailwind-preset.ts) | Tailwind CSS configuration preset |
| [dark-mode.md](./dark-mode.md) | Dark mode adaptation guidelines |

## Quick Start

1. Copy `tokens.css` variables into your `globals.css` `:root` block
2. Import fonts in `layout.tsx` (Cormorant Garamond + DM Sans)
3. Apply the Tailwind preset from `tailwind-preset.ts`
4. Follow component specs in `components.md` when building UI

## Brand Keywords

Luxurious · Approachable · Natural · Confident · Professional · Warm · Refined
