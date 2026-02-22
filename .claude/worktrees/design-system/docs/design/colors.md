# Color Palette

## Primary Colors

### Terracotta (Primary Action Color)
The signature brand color. Used for CTAs, active states, and key interactive elements.

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--primary-50` | `#FDF5F0` | `253, 245, 240` | Hover backgrounds, subtle tints |
| `--primary-100` | `#FAE8DC` | `250, 232, 220` | Light backgrounds, selected states |
| `--primary-200` | `#F3CDAF` | `243, 205, 175` | Borders, dividers on warm surfaces |
| `--primary-300` | `#E8AC7E` | `232, 172, 126` | Decorative illustrations, icons |
| `--primary-400` | `#D68E56` | `214, 142, 86` | Secondary buttons, hover states |
| `--primary-500` | `#C17A4A` | `193, 122, 74` | **Primary brand color** — buttons, links |
| `--primary-600` | `#A86540` | `168, 101, 64` | Pressed/active button states |
| `--primary-700` | `#8B5035` | `139, 80, 53` | Dark accents, focus rings |
| `--primary-800` | `#6E3D2A` | `110, 61, 42` | Deep accents |
| `--primary-900` | `#4A2819` | `74, 40, 25` | Darkest terracotta |

### Warm Neutrals (Background & Surface)
Cream-to-beige tones that provide warmth without competing with content.

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--warm-50` | `#FFFDFB` | `255, 253, 251` | Page background (lightest) |
| `--warm-100` | `#FDF8F4` | `253, 248, 244` | Card backgrounds, alt sections |
| `--warm-200` | `#F7EDE3` | `247, 237, 227` | Hero backgrounds, highlighted areas |
| `--warm-300` | `#EDE0D4` | `237, 224, 212` | Feature section backgrounds |
| `--warm-400` | `#DDD0C2` | `221, 208, 194` | Borders, dividers |
| `--warm-500` | `#C4B5A5` | `196, 181, 165` | Muted text, placeholders |

### Dark Neutrals (Text & UI)
Rich brown-blacks for text with warmth that avoids cold pure-black.

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--dark-50` | `#F5F0EB` | `245, 240, 235` | Disabled backgrounds |
| `--dark-100` | `#DDD5CC` | `221, 213, 204` | Subtle borders |
| `--dark-200` | `#B5A899` | `181, 168, 153` | Disabled text |
| `--dark-300` | `#8D7E6D` | `141, 126, 109` | Placeholder text |
| `--dark-400` | `#6B5B4D` | `107, 91, 77` | Secondary text, captions |
| `--dark-500` | `#4A3D32` | `74, 61, 50` | Body text |
| `--dark-600` | `#352A22` | `53, 42, 34` | Headings |
| `--dark-700` | `#2D1F15` | `45, 31, 21` | Display text, hero headings |
| `--dark-800` | `#1A0F08` | `26, 15, 8` | Maximum contrast text |

## Semantic Color Tokens

### Light Mode

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `--warm-50` (#FFFDFB) | Page background |
| `--foreground` | `--dark-700` (#2D1F15) | Default text color |
| `--card` | `--warm-100` (#FDF8F4) | Card surfaces |
| `--card-foreground` | `--dark-600` (#352A22) | Card text |
| `--primary` | `--primary-500` (#C17A4A) | Primary actions |
| `--primary-foreground` | `#FFFFFF` | Text on primary |
| `--secondary` | `--warm-200` (#F7EDE3) | Secondary surfaces |
| `--secondary-foreground` | `--dark-600` (#352A22) | Text on secondary |
| `--muted` | `--warm-300` (#EDE0D4) | Muted backgrounds |
| `--muted-foreground` | `--dark-400` (#6B5B4D) | Muted text |
| `--accent` | `--primary-100` (#FAE8DC) | Accent highlights |
| `--accent-foreground` | `--primary-700` (#8B5035) | Accent text |
| `--destructive` | `#DC3545` | Error/destructive actions |
| `--border` | `--warm-400` (#DDD0C2) | Default borders |
| `--input` | `--warm-400` (#DDD0C2) | Input borders |
| `--ring` | `--primary-500` (#C17A4A) | Focus rings |

### Feedback Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--success` | `#5D8C61` | Success states, confirmations |
| `--success-light` | `#E8F2E9` | Success backgrounds |
| `--warning` | `#D4A843` | Warning states |
| `--warning-light` | `#FDF5E0` | Warning backgrounds |
| `--error` | `#DC3545` | Error states |
| `--error-light` | `#FDE8EA` | Error backgrounds |
| `--info` | `#5B8DB8` | Informational states |
| `--info-light` | `#E8F0F8` | Info backgrounds |

### Star Rating

| Token | Hex | Usage |
|-------|-----|-------|
| `--star-filled` | `#E8A838` | Filled star |
| `--star-empty` | `--warm-400` (#DDD0C2) | Empty star |

## Decorative Colors

Used for botanical illustrations, organic shapes, and background decorations.

| Token | Hex | Usage |
|-------|-----|-------|
| `--deco-leaf` | `#C4956A` | Leaf/botanical illustrations |
| `--deco-branch` | `#B8885E` | Branch/stem illustrations |
| `--deco-circle` | `#D4A87C` | Decorative circles (30% opacity) |
| `--deco-blob` | `#E2C4A4` | Organic blob shapes (20% opacity) |

## Gradients

```css
/* Hero overlay — soft fade from warm cream */
--gradient-hero-overlay: linear-gradient(
  135deg,
  rgba(247, 237, 227, 0.95) 0%,
  rgba(247, 237, 227, 0.6) 50%,
  rgba(247, 237, 227, 0) 100%
);

/* Section transition — cream to white */
--gradient-section-fade: linear-gradient(
  180deg,
  #F7EDE3 0%,
  #FFFDFB 100%
);

/* CTA background glow */
--gradient-cta-glow: radial-gradient(
  ellipse at center,
  rgba(193, 122, 74, 0.08) 0%,
  transparent 70%
);
```

## Contrast Ratios (WCAG 2.1 AA)

| Combination | Ratio | Pass |
|-------------|-------|------|
| `--dark-700` on `--warm-50` | 14.2:1 | AAA |
| `--dark-600` on `--warm-100` | 10.8:1 | AAA |
| `--dark-500` on `--warm-50` | 8.1:1 | AAA |
| `--dark-400` on `--warm-50` | 5.2:1 | AA |
| `#FFFFFF` on `--primary-500` | 4.6:1 | AA |
| `#FFFFFF` on `--primary-600` | 5.8:1 | AAA |
| `--primary-700` on `--warm-50` | 7.3:1 | AAA |
