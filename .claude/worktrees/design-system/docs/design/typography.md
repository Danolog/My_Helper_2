# Typography

## Font Families

### Display & Headings — Cormorant Garamond
An elegant, high-contrast serif with organic, flowing characteristics. Conveys luxury, sophistication, and expertise.

```
Font: Cormorant Garamond
Weights: 300 (Light), 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold)
Source: Google Fonts
CSS Variable: --font-heading
```

**Next.js Import:**
```tsx
import { Cormorant_Garamond } from "next/font/google";

const cormorant = Cormorant_Garamond({
  variable: "--font-heading",
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});
```

### Body & UI — DM Sans
A clean, geometric sans-serif with excellent readability. Professional and modern without being cold.

```
Font: DM Sans
Weights: 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold)
Source: Google Fonts
CSS Variable: --font-body
```

**Next.js Import:**
```tsx
import { DM_Sans } from "next/font/google";

const dmSans = DM_Sans({
  variable: "--font-body",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
```

### Monospace (Code/Technical) — Geist Mono
Retained from existing codebase for technical contexts (admin dashboards, code snippets).

```
Font: Geist Mono
Variable: --font-geist-mono (existing)
```

## Type Scale

Based on a 1.250 (Major Third) modular scale with a 16px base.

| Token | Size | Line Height | Letter Spacing | Weight | Font |
|-------|------|-------------|----------------|--------|------|
| `--text-xs` | 12px / 0.75rem | 1.5 (18px) | 0.02em | 400 | DM Sans |
| `--text-sm` | 14px / 0.875rem | 1.5 (21px) | 0.01em | 400 | DM Sans |
| `--text-base` | 16px / 1rem | 1.6 (25.6px) | 0 | 400 | DM Sans |
| `--text-lg` | 18px / 1.125rem | 1.6 (28.8px) | 0 | 400 | DM Sans |
| `--text-xl` | 20px / 1.25rem | 1.5 (30px) | -0.01em | 400 | DM Sans |
| `--text-2xl` | 24px / 1.5rem | 1.4 (33.6px) | -0.01em | 500 | Cormorant |
| `--text-3xl` | 30px / 1.875rem | 1.3 (39px) | -0.02em | 500 | Cormorant |
| `--text-4xl` | 36px / 2.25rem | 1.2 (43.2px) | -0.02em | 600 | Cormorant |
| `--text-5xl` | 48px / 3rem | 1.15 (55.2px) | -0.03em | 600 | Cormorant |
| `--text-6xl` | 60px / 3.75rem | 1.1 (66px) | -0.03em | 600 | Cormorant |
| `--text-7xl` | 72px / 4.5rem | 1.05 (75.6px) | -0.04em | 700 | Cormorant |

## Text Styles

### Hero Heading
The main hero headline — large, elegant, serif.
```css
.text-hero {
  font-family: var(--font-heading);
  font-size: clamp(2.5rem, 5vw + 1rem, 4.5rem); /* 40px → 72px */
  font-weight: 600;
  line-height: 1.08;
  letter-spacing: -0.03em;
  color: var(--dark-700);
}
```
**Tailwind:** `font-heading text-5xl md:text-6xl lg:text-7xl font-semibold leading-[1.08] tracking-tight`

### Section Heading
For section titles like "Our Services", "Sculpting beauty, one face at a time".
```css
.text-section-heading {
  font-family: var(--font-heading);
  font-size: clamp(1.875rem, 3vw + 0.5rem, 3rem); /* 30px → 48px */
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--dark-700);
}
```
**Tailwind:** `font-heading text-3xl md:text-4xl lg:text-5xl font-medium leading-tight tracking-tight`

### Card Title
For service cards and feature cards.
```css
.text-card-title {
  font-family: var(--font-heading);
  font-size: 1.25rem; /* 20px */
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: var(--dark-600);
}
```
**Tailwind:** `font-heading text-xl font-semibold leading-snug`

### Section Label (Overline)
Small uppercase label above section headings — "OUR SERVICES", "BEAUTY SALON".
```css
.text-section-label {
  font-family: var(--font-body);
  font-size: 0.75rem; /* 12px */
  font-weight: 600;
  line-height: 1.5;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--primary-500);
}
```
**Tailwind:** `font-body text-xs font-semibold uppercase tracking-[0.15em] text-primary`

### Body Text
Default paragraph text.
```css
.text-body {
  font-family: var(--font-body);
  font-size: 1rem; /* 16px */
  font-weight: 400;
  line-height: 1.6;
  color: var(--dark-500);
}
```
**Tailwind:** `font-body text-base leading-relaxed text-muted-foreground`

### Body Large
For introductory paragraphs and prominent descriptions.
```css
.text-body-lg {
  font-family: var(--font-body);
  font-size: 1.125rem; /* 18px */
  font-weight: 400;
  line-height: 1.6;
  color: var(--dark-400);
}
```
**Tailwind:** `font-body text-lg leading-relaxed text-muted-foreground`

### Caption / Small Text
For image captions, timestamps, metadata.
```css
.text-caption {
  font-family: var(--font-body);
  font-size: 0.875rem; /* 14px */
  font-weight: 400;
  line-height: 1.5;
  color: var(--dark-400);
}
```
**Tailwind:** `font-body text-sm text-muted-foreground`

### Button Text
```css
.text-button {
  font-family: var(--font-body);
  font-size: 0.875rem; /* 14px */
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.02em;
}
```
**Tailwind:** `font-body text-sm font-semibold tracking-wide`

### Navigation Link
```css
.text-nav {
  font-family: var(--font-body);
  font-size: 0.9375rem; /* 15px */
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.01em;
  color: var(--dark-500);
}
```
**Tailwind:** `font-body text-[15px] font-medium`

### Blockquote / Testimonial
For customer quotes and testimonial text.
```css
.text-quote {
  font-family: var(--font-heading);
  font-size: 1.125rem; /* 18px */
  font-weight: 400;
  line-height: 1.6;
  font-style: italic;
  color: var(--dark-500);
}
```
**Tailwind:** `font-heading text-lg italic leading-relaxed`

## Responsive Behavior

All heading sizes use `clamp()` for fluid scaling between breakpoints:

| Breakpoint | Hero | Section | Card Title | Body |
|------------|------|---------|------------|------|
| Mobile (<640px) | 40px | 30px | 20px | 16px |
| Tablet (640–1024px) | 56px | 40px | 20px | 16px |
| Desktop (>1024px) | 72px | 48px | 20px | 16px |

## Special Typography Treatments

### Decorative Quote Mark
Large ornamental quotation mark used before testimonial blocks.
```css
.quote-mark::before {
  content: "\201C"; /* " */
  font-family: var(--font-heading);
  font-size: 5rem;
  font-weight: 700;
  color: var(--primary-300);
  line-height: 0.8;
  display: block;
}
```

### Brand Ticker Text
For the scrolling brand/partner logos section — various decorative/script fonts.
Use each brand's own logotype or a stylized rendering.

### Numbered List / Steps
```css
.step-number {
  font-family: var(--font-heading);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--primary-500);
}
```
