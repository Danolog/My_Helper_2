# Dark Mode Guidelines

The dark mode adaptation preserves the warm, organic character of the brand by using deep brown tones instead of cold blue-blacks.

## Principles

1. **Warm Darks, Not Cold Blacks** — Use `#1A0F08` (warm near-black) as the base, never pure `#000000`
2. **Terracotta Remains Hero** — The primary color shifts lighter (`--primary-400` instead of `--primary-500`) for adequate contrast on dark surfaces
3. **Reduced Contrast for Comfort** — Body text uses `#DDD5CC` (not pure white) to reduce eye strain
4. **Borders Become Subtle** — Use `rgba(245, 240, 235, 0.12)` for borders instead of solid colors
5. **Decorative Elements Dim** — Botanical illustrations and decorative shapes reduce opacity by ~50%

## Color Mapping

| Light Mode Token | Light Value | Dark Value | Notes |
|-----------------|-------------|------------|-------|
| `--background` | `#FFFDFB` | `#1A0F08` | Warm near-black base |
| `--foreground` | `#2D1F15` | `#F5F0EB` | Warm off-white text |
| `--card` | `#FDF8F4` | `#2D1F15` | Elevated surface |
| `--card-foreground` | `#352A22` | `#F5F0EB` | Card text |
| `--primary` | `#C17A4A` | `#D68E56` | Lighter for dark bg contrast |
| `--primary-foreground` | `#FFFFFF` | `#1A0F08` | Dark text on bright primary |
| `--secondary` | `#F7EDE3` | `#352A22` | Muted surface |
| `--muted` | `#EDE0D4` | `#352A22` | Subdued backgrounds |
| `--muted-foreground` | `#6B5B4D` | `#B5A899` | Secondary text |
| `--accent` | `#FAE8DC` | `#4A2819` | Deep terracotta accent bg |
| `--border` | `#DDD0C2` | `rgba(245,240,235,0.12)` | Translucent borders |

## Surface Hierarchy (Dark)

```
Level 0 (Page):     #1A0F08  — deepest background
Level 1 (Card):     #2D1F15  — primary surface
Level 2 (Elevated): #352A22  — popovers, modals
Level 3 (Raised):   #4A3D32  — tooltips, active items
```

Each level adds warmth and lightness, creating depth without cold gray tones.

## Component Adaptations

### Buttons
- **Primary:** Background shifts to `#D68E56`, text to `#1A0F08`
- **Secondary/Outline:** Border `rgba(245,240,235,0.3)`, text `#F5F0EB`, hover fill `#352A22`
- **Ghost:** Text `#D68E56`, hover underline

### Cards
- Background: `#2D1F15`
- Border: `rgba(245,240,235,0.08)` (very subtle)
- Shadow: Replaced with subtle border or removed entirely
- Hover: Border brightens to `rgba(245,240,235,0.15)`

### Images
- Add a subtle vignette overlay (`rgba(26, 15, 8, 0.1)`) to blend into dark surfaces
- Reduce decorative element opacity to 15-25%

### Star Ratings
- Filled stars keep `#E8A838` (gold reads well on dark)
- Empty stars use `#352A22`

### Form Inputs
- Background: `#2D1F15`
- Border: `rgba(245,240,235,0.15)`
- Text: `#F5F0EB`
- Placeholder: `#8D7E6D`
- Focus ring: `#D68E56`

### Botanical Decorations
- Reduce opacity from 20-40% to 8-15%
- Use `#D68E56` tint instead of `#C4956A`

## Implementation

The dark mode tokens are defined in `tokens.css` under the `.dark` selector. The app uses `next-themes` with `attribute="class"` to toggle the `.dark` class on `<html>`.

```tsx
// Already configured in layout.tsx:
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
```

No additional setup needed — just ensure all components use the semantic CSS variables (`bg-background`, `text-foreground`, `bg-card`, etc.) rather than hardcoded colors.

## Testing Checklist

- [ ] All text maintains 4.5:1 contrast ratio minimum
- [ ] Primary buttons are clearly visible and legible
- [ ] Card boundaries are distinguishable from background
- [ ] Form inputs have visible borders in both states
- [ ] Star ratings remain gold and clearly visible
- [ ] Images don't appear jarring against dark surfaces
- [ ] Decorative elements are subtle, not distracting
- [ ] Transitions between light/dark are smooth (no flash)
