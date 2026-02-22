# Spacing & Layout

## Spacing Scale

Based on a 4px base unit. All spacing values are multiples of 4.

| Token | Value | px | Usage |
|-------|-------|-----|-------|
| `--space-0` | 0 | 0 | Reset |
| `--space-0.5` | 0.125rem | 2 | Micro adjustments |
| `--space-1` | 0.25rem | 4 | Tight inline spacing |
| `--space-1.5` | 0.375rem | 6 | Small icon gaps |
| `--space-2` | 0.5rem | 8 | Compact padding, badge padding |
| `--space-3` | 0.75rem | 12 | Button padding (vertical) |
| `--space-4` | 1rem | 16 | Default gap, input padding |
| `--space-5` | 1.25rem | 20 | Card content padding |
| `--space-6` | 1.5rem | 24 | Card padding, group spacing |
| `--space-8` | 2rem | 32 | Section component gap |
| `--space-10` | 2.5rem | 40 | Large component gap |
| `--space-12` | 3rem | 48 | Section padding (mobile) |
| `--space-16` | 4rem | 64 | Section padding (tablet) |
| `--space-20` | 5rem | 80 | Section padding (desktop) |
| `--space-24` | 6rem | 96 | Major section dividers |
| `--space-32` | 8rem | 128 | Hero vertical padding |

## Layout Grid

### Container Widths

| Token | Value | Usage |
|-------|-------|-------|
| `--container-sm` | 640px | Narrow content (FAQ, forms) |
| `--container-md` | 768px | Article content, testimonials |
| `--container-lg` | 1024px | Standard content areas |
| `--container-xl` | 1280px | **Default max-width** |
| `--container-2xl` | 1440px | Wide layouts, image galleries |
| `--container-full` | 100% | Full-bleed sections |

### Content Grid
```css
.content-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-6);
  padding-inline: var(--space-4);
  max-width: var(--container-xl);
  margin-inline: auto;
}

@media (min-width: 640px) {
  .content-grid {
    grid-template-columns: repeat(2, 1fr);
    padding-inline: var(--space-6);
  }
}

@media (min-width: 1024px) {
  .content-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-8);
    padding-inline: var(--space-8);
  }
}
```

**Tailwind:** `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto`

### Two-Column Split
For image + text alternating sections.
```css
.split-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-8);
  align-items: center;
  max-width: var(--container-xl);
  margin-inline: auto;
  padding-inline: var(--space-4);
}

@media (min-width: 768px) {
  .split-layout {
    grid-template-columns: 1fr 1fr;
    gap: var(--space-12);
    padding-inline: var(--space-8);
  }
}

/* Reversed variant (image right) */
.split-layout--reversed .split-layout__image {
  order: 2;
}
```

**Tailwind:** `grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center max-w-7xl mx-auto px-4 md:px-8`

## Breakpoints

| Name | Min Width | Tailwind Prefix | Target |
|------|-----------|-----------------|--------|
| `sm` | 640px | `sm:` | Large phones (landscape) |
| `md` | 768px | `md:` | Tablets |
| `lg` | 1024px | `lg:` | Small desktops |
| `xl` | 1280px | `xl:` | Standard desktops |
| `2xl` | 1440px | `2xl:` | Large desktops |

## Section Spacing

Consistent vertical rhythm between page sections.

| Context | Mobile | Tablet | Desktop | Tailwind |
|---------|--------|--------|---------|----------|
| Page top (below header) | 48px | 64px | 80px | `pt-12 md:pt-16 lg:pt-20` |
| Between sections | 64px | 80px | 96px | `py-16 md:py-20 lg:py-24` |
| Hero section height | auto | auto | min 90vh | `min-h-0 lg:min-h-[90vh]` |
| Section heading → content | 32px | 40px | 48px | `mb-8 md:mb-10 lg:mb-12` |
| Card internal padding | 20px | 24px | 24px | `p-5 md:p-6` |
| Footer top padding | 48px | 64px | 80px | `pt-12 md:pt-16 lg:pt-20` |

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Small elements, badges, tags |
| `--radius-md` | 8px | Inputs, small cards |
| `--radius-lg` | 12px | Cards, dialogs |
| `--radius-xl` | 16px | Large cards, image containers |
| `--radius-2xl` | 24px | Hero images, feature sections |
| `--radius-full` | 9999px | Buttons (pill), avatars, circles |

## Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(45, 31, 21, 0.05)` | Subtle elevation (cards at rest) |
| `--shadow-md` | `0 4px 12px rgba(45, 31, 21, 0.08)` | Cards on hover, dropdowns |
| `--shadow-lg` | `0 8px 24px rgba(45, 31, 21, 0.10)` | Modals, popovers |
| `--shadow-xl` | `0 16px 48px rgba(45, 31, 21, 0.12)` | Hero floating elements |
| `--shadow-inner` | `inset 0 2px 4px rgba(45, 31, 21, 0.05)` | Inset inputs, pressed states |

All shadows use warm brown tones (`rgba(45, 31, 21, ...)`) instead of pure black for cohesion with the warm palette.

## Z-Index Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--z-base` | 0 | Default stacking |
| `--z-raised` | 10 | Sticky elements within content |
| `--z-dropdown` | 20 | Dropdowns, popovers |
| `--z-sticky` | 30 | Sticky header |
| `--z-overlay` | 40 | Overlays, backdrops |
| `--z-modal` | 50 | Modals, dialogs |
| `--z-toast` | 60 | Toast notifications |
| `--z-tooltip` | 70 | Tooltips |
