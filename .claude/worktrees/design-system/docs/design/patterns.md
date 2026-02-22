# Layout Patterns

Page section templates derived from the reference design. Each pattern is a reusable section that can be composed into full pages.

---

## 1. Hero Section

Full-width hero with overlapping imagery, heading, body text, and dual CTAs.

```
┌─────────────────────────────────────────────────────────────────┐
│ [Botanical decoration]                                          │
│                                                                 │
│   ┌─────────────────────┐                ┌──────────────────┐   │
│   │  Section Label       │                │                  │   │
│   │                      │                │   Hero Image     │   │
│   │  Unlock your         │                │   (portrait)     │   │
│   │  true beauty         │                │                  │   │
│   │                      │                │                  │   │
│   │  Subtitle text...    │                └──────────────────┘   │
│   │                      │                                      │
│   │  [CTA Primary] [CTA Secondary]                              │
│   │                      │                                      │
│   │  "Quote text"        │                                      │
│   └─────────────────────┘                                       │
│                                                                 │
│ [Botanical decoration]                                          │
└─────────────────────────────────────────────────────────────────┘

Background: var(--warm-200) #F7EDE3
Layout:     CSS Grid, 2 columns (content 5fr / image 7fr) on desktop
            Single column on mobile (image below text)
Min-height: 90vh on desktop
Padding:    80px top, 48px bottom
```

**Key details:**
- Hero image slightly overlaps the bottom of the section
- Botanical SVG decorations positioned absolutely in corners
- Small circular avatar + quote positioned below CTAs
- Content is vertically centered on desktop

---

## 2. Brand Ticker / Logo Marquee

Infinite horizontal scroll of partner brand logos.

```
┌─────────────────────────────────────────────────────────────────┐
│  MELISA    REGEENT    Nature    NAOMI    limage    King villa   │
└─────────────────────────────────────────────────────────────────┘

Background: var(--dark-700) #2D1F15  (or var(--warm-200) for light variant)
Height:     60-80px
Text/Logo:  white (on dark), var(--dark-400) (on light)
Animation:  CSS marquee, infinite, ~30s, linear
```

---

## 3. Three-Column Service Cards

Section with overline label, heading, and a 3-column card grid.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                      OUR SERVICES                               │
│         With our cutting-edge techniques and advanced           │
│     cosmetic procedures, we strive to bring out your            │
│          unique beauty and help you shine.                       │
│                                                                 │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐                 │
│   │  [Image] │    │  [Image] │    │  [Image] │                 │
│   │          │    │          │    │          │                 │
│   │  Title   │    │  Title   │    │  Title   │                 │
│   │  Desc... │    │  Desc... │    │  Desc... │                 │
│   │  LINK →  │    │  LINK →  │    │  LINK →  │                 │
│   └──────────┘    └──────────┘    └──────────┘                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Background: var(--warm-50) #FFFDFB
Layout:     Max-width 1280px, centered
Grid:       1 col (mobile) → 2 col (tablet) → 3 col (desktop)
Gap:        24px (mobile) → 32px (desktop)
Text-align: center for section header
```

---

## 4. Image + Text Split (Alternating)

Two-column section with image on one side and text content on the other. Alternates direction per section.

### Variant A: Image Left, Text Right

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌──────────────────┐    ┌──────────────────────┐             │
│   │                  │    │  BEAUTY SALON          │             │
│   │                  │    │                        │             │
│   │   Full Image     │    │  Sculpting beauty,     │             │
│   │   (portrait      │    │  one face at a time    │             │
│   │    or scene)     │    │                        │             │
│   │                  │    │  Body text...           │             │
│   │                  │    │                        │             │
│   └──────────────────┘    └──────────────────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Variant B: Text Left, Image Right (with checklist)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌──────────────────────┐    ┌──────────────────┐             │
│   │  COSMETIC PLASTIC     │    │                  │             │
│   │                       │    │   Image collage  │             │
│   │  Discover the power   │    │   (multiple      │             │
│   │  of non-surgical      │    │    images in     │             │
│   │  techniques           │    │    mosaic)       │             │
│   │                       │    │                  │             │
│   │  ✓ Cheek fillers      │    │                  │             │
│   │  ✓ Jawline contouring │    └──────────────────┘             │
│   │  ✓ Lip augmentation   │                                    │
│   │  ✓ Non-surgical rhino │                                    │
│   │  ✓ Temple fillers     │                                    │
│   └──────────────────────┘                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Background:  var(--warm-200) #F7EDE3 or var(--warm-50)
Grid:        50/50 split on desktop, stacked on mobile
Alignment:   Vertically centered
Image:       rounded-2xl, object-cover
Checklist:   Icon (check circle) + text, gap 12px, vertical gap 8px
Check icon:  var(--primary-500) #C17A4A, 20px
```

---

## 5. Three-Column Value Props

Centered text-only feature cards (no images).

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌────────────┐   ┌────────────┐   ┌────────────┐            │
│   │             │   │             │   │             │            │
│   │  Title      │   │  Title      │   │  Title      │            │
│   │             │   │             │   │             │            │
│   │  Body text  │   │  Body text  │   │  Body text  │            │
│   │  centered   │   │  centered   │   │  centered   │            │
│   │             │   │             │   │             │            │
│   └────────────┘   └────────────┘   └────────────┘            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Background:  var(--warm-50) or var(--warm-100)
Text-align:  center
Card padding: 24px
Title:       Cormorant, 20px, SemiBold
Body:        DM Sans, 14px, Regular, --dark-400
```

---

## 6. CTA Banner

Full-width call-to-action section with background and centered text.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│              Trust your skin to                                 │
│                the experts                                      │
│                                                                 │
│         Step into our world and experience the power            │
│         of transformation...                                    │
│                                                                 │
│                   [BOOK A VISIT]                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Background:  var(--warm-300) #EDE0D4 or subtle image with overlay
Text-align:  center
Heading:     Cormorant, clamp(30px, 5vw, 48px), SemiBold
Body:        DM Sans, 16px, Regular, --dark-400
Button:      Primary CTA (terracotta pill)
Padding:     96px vertical (desktop), 64px (mobile)
Max-width:   640px for text content
```

---

## 7. Image Mosaic / Gallery Strip

Full-width strip of images in various sizes, creating an organic collage feel.

```
┌───────┬──────────────┬─────────┬──────────┬────────┐
│       │              │         │          │        │
│ [img] │   [img]      │  [img]  │  [img]   │ [img]  │
│       │              │         │          │        │
└───────┴──────────────┴─────────┴──────────┴────────┘

Layout:     CSS Grid with varying column spans
Gap:        8px
Height:     300px (desktop), 200px (mobile)
Radius:     var(--radius-xl) 16px on each image
Overflow:   hidden
Object-fit: cover
```

---

## 8. Testimonials Section

Horizontal scrolling testimonial cards with star ratings.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐   │
│  │  ★★★★★         │  │  ★★★★★         │  │  ★★★★★         │   │
│  │                 │  │                 │  │                 │   │
│  │  "Quote text    │  │  "Quote text    │  │  "Quote text    │   │
│  │   from client"  │  │   from client"  │  │   from client"  │   │
│  │                 │  │                 │  │                 │   │
│  │  av Name        │  │  av Name        │  │  av Name        │   │
│  │     Title       │  │     Title       │  │     Title       │   │
│  └────────────────┘  └────────────────┘  └────────────────┘   │
│                                                                 │
│                        ● ○ ○                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Background:  var(--warm-200) #F7EDE3
Layout:      Horizontal scroll (carousel) or 3-column grid
Card bg:     #FFFFFF
Card radius: var(--radius-lg) 12px
Card shadow: var(--shadow-sm)
Card padding: 24px
Pagination:  Dot indicators centered below
```

---

## 9. FAQ Accordion Section

Centered FAQ with expandable accordion items.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                  Find answers here                              │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ▸  How can I book an appointment?                       │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  ▸  Are the products used in your services safe?         │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  ▸  How long will the results of my treatment last?      │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  ▸  What services do you offer?                          │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  ▸  What should I expect during a treatment?             │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │  ▸  Can I get personalized beauty advice?                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Background:  var(--warm-50) #FFFDFB
Max-width:   768px centered
Heading:     Cormorant, 36px, SemiBold, centered
Dividers:    1px solid var(--warm-400) #DDD0C2
Padding:     16px vertical per item
```

---

## 10. Anti-Aging Feature Section (Text + Image Overlap)

Image extends beyond its container/overlaps with text content.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌────────────────────────┐                                   │
│   │  ANTI-AGE COSMETOLOGY   │                                   │
│   │                         │        ┌──────────────────┐       │
│   │  Customized solutions   │        │                  │       │
│   │  for anti-aging         │        │  Image that      │       │
│   │  concerns               │        │  overlaps into   │       │
│   │                         │        │  the text area   │       │
│   │  Body text...           │        │                  │       │
│   │                         │        └──────────────────┘       │
│   │  [BOOK NOW]             │                                   │
│   └────────────────────────┘                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Background:  var(--warm-100) #FDF8F4
Image:       positioned with negative margin or absolute positioning
             to create overlap effect
Overlap:     ~60px overlap into adjacent column
```

---

## Page Composition Example

A typical landing page composes these patterns in this order:

1. **Hero Section** — warm cream background
2. **Brand Ticker** — dark strip
3. **Services Cards** — white background
4. **Image + Text Split** (image left) — white
5. **Value Props** — cream background
6. **Image Mosaic** — full-bleed
7. **Image + Text Split** (text left, with checklist) — cream
8. **Anti-Aging Feature** — light cream
9. **FAQ Accordion** — white
10. **Testimonials** — cream
11. **CTA Banner** — warm beige
12. **Footer** — dark

### Background Alternation Pattern

Sections alternate between warm cream (`--warm-200`) and near-white (`--warm-50`) to create visual rhythm without hard dividers. Dark sections (ticker, footer) provide contrast anchors.

```
cream → dark → white → white → cream → full-bleed → cream → light → white → cream → beige → dark
```
