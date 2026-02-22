# Component Specifications

## Buttons

### Primary Button (CTA)
Pill-shaped, solid terracotta. The primary call-to-action.

```
Background:  var(--primary-500) #C17A4A
Text:        #FFFFFF
Font:        DM Sans, 14px, SemiBold (600), tracking 0.02em
Padding:     12px 28px
Radius:      9999px (full pill)
Height:      44px (minimum touch target)
Shadow:      none at rest
Transition:  background 200ms ease, transform 150ms ease
```

**States:**
| State | Background | Transform | Other |
|-------|-----------|-----------|-------|
| Rest | `#C17A4A` | none | — |
| Hover | `#A86540` | `translateY(-1px)` | `shadow-md` |
| Active/Pressed | `#8B5035` | `translateY(0)` | — |
| Focus | `#C17A4A` | none | 2px ring `#C17A4A` offset 2px |
| Disabled | `#DDD0C2` | none | text `#8D7E6D`, cursor not-allowed |

**Tailwind:**
```
bg-primary text-white font-body text-sm font-semibold tracking-wide
px-7 py-3 rounded-full
hover:bg-primary-600 hover:-translate-y-0.5 hover:shadow-md
active:bg-primary-700 active:translate-y-0
focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed
transition-all duration-200
```

### Secondary Button (Outline)
Pill-shaped outline variant for secondary actions.

```
Background:  transparent
Border:      1.5px solid var(--dark-600) #352A22
Text:        var(--dark-600) #352A22
Font:        DM Sans, 14px, SemiBold (600), tracking 0.02em
Padding:     12px 28px
Radius:      9999px
```

**States:**
| State | Background | Border | Text |
|-------|-----------|--------|------|
| Rest | transparent | `#352A22` | `#352A22` |
| Hover | `#352A22` | `#352A22` | `#FFFFFF` |
| Active | `#1A0F08` | `#1A0F08` | `#FFFFFF` |
| Focus | transparent | `#352A22` | `#352A22` + ring |

**Tailwind:**
```
bg-transparent border-[1.5px] border-dark-600 text-dark-600
font-body text-sm font-semibold tracking-wide
px-7 py-3 rounded-full
hover:bg-dark-600 hover:text-white
active:bg-dark-800
focus-visible:ring-2 focus-visible:ring-dark-600 focus-visible:ring-offset-2
transition-all duration-200
```

### Ghost Button (Text + Arrow)
Minimal text button with arrow icon, used for "Learn More", "View All" links.

```
Background:  none
Text:        var(--primary-500) #C17A4A
Font:        DM Sans, 14px, SemiBold (600)
Padding:     4px 0
Arrow:       → (right arrow icon, 16px)
Gap:         8px between text and arrow
```

**Hover:** Arrow translates 4px right, underline appears.

**Tailwind:**
```
text-primary font-body text-sm font-semibold
inline-flex items-center gap-2
hover:underline group
[&_svg]:transition-transform [&_svg]:group-hover:translate-x-1
```

### Icon Button
Square button containing only an icon (e.g., close, menu).

```
Size:    40px × 40px (minimum)
Radius:  var(--radius-md) 8px
Icon:    20px
```

## Cards

### Service Card
Three-column service cards with image, title, description, and link.

```
Structure:
┌──────────────────────┐
│                      │
│      [Image]         │  aspect-ratio: 4/3
│                      │
├──────────────────────┤
│  Card Title          │  Cormorant, 20px, SemiBold
│                      │
│  Description text    │  DM Sans, 14px, Regular
│  goes here...        │  color: --dark-400
│                      │
│  EXAMPLE →           │  DM Sans, 12px, SemiBold, uppercase
│                      │  tracking 0.1em, color: --primary-500
└──────────────────────┘

Background:  #FFFFFF or var(--warm-100)
Radius:      var(--radius-xl) 16px
Shadow:      var(--shadow-sm)
Padding:     0 (image) / 20px (content area)
Hover:       shadow-md, translateY(-4px)
Transition:  all 300ms ease
```

**Tailwind:**
```
group bg-card rounded-xl shadow-sm overflow-hidden
hover:shadow-md hover:-translate-y-1 transition-all duration-300

/* Image */
aspect-[4/3] w-full object-cover

/* Content */
p-5 space-y-3

/* Title */
font-heading text-xl font-semibold text-card-foreground

/* Description */
font-body text-sm text-muted-foreground leading-relaxed

/* Link */
text-xs font-semibold uppercase tracking-widest text-primary
```

### Feature Card
For "Professionalism", "Personalized approach" type value props.

```
Structure:
┌──────────────────────┐
│  Feature Title       │  Cormorant, 20px, SemiBold
│                      │
│  Description text    │  DM Sans, 14px, Regular
│  explaining the      │  color: --dark-400
│  feature value...    │
└──────────────────────┘

Background:  transparent or var(--warm-100)
Border:      none
Padding:     24px
Text-align:  center
```

### Testimonial Card
Customer reviews with star rating and attribution.

```
Structure:
┌──────────────────────┐
│  ★★★★★              │  Star rating (gold)
│                      │
│  "Quote text here    │  Cormorant, 16px, Italic
│   from the client"   │  color: --dark-500
│                      │
│  av Client Name      │  DM Sans, 14px, SemiBold
│     Title            │  DM Sans, 12px, Regular, --dark-400
└──────────────────────┘

Background:  #FFFFFF
Radius:      var(--radius-lg) 12px
Shadow:      var(--shadow-sm)
Padding:     24px
Star size:   16px
Star color:  var(--star-filled) #E8A838
Star gap:    2px
```

## Navigation

### Header Navigation
Fixed/sticky top bar with logo, links, and CTA button.

```
Height:      72px (desktop), 64px (mobile)
Background:  transparent → var(--warm-50)/95% (on scroll, with backdrop-blur)
Padding:     0 32px (desktop), 0 16px (mobile)
Border:      none at top, 1px bottom on scroll
Z-index:     var(--z-sticky) 30
```

**Nav Links:**
```
Font:       DM Sans, 15px, Medium (500)
Color:      var(--dark-500)
Hover:      var(--primary-500)
Active:     var(--primary-500), font-weight 600
Gap:        32px between links
Transition: color 200ms ease
```

**CTA Button (in nav):**
Small variant of Primary Button:
```
Padding:  8px 20px
Height:   36px
Font:     13px
```

### Mobile Menu
Slide-in drawer from right side.

```
Width:       100% (up to 400px)
Background:  var(--warm-50)
Overlay:     rgba(26, 15, 8, 0.5)
Animation:   slideInRight 300ms ease
```

## Form Elements

### Text Input
```
Height:      48px
Padding:     12px 16px
Background:  #FFFFFF
Border:      1.5px solid var(--warm-400) #DDD0C2
Radius:      var(--radius-md) 8px
Font:        DM Sans, 16px, Regular
Color:       var(--dark-600)
Placeholder: var(--dark-300) #8D7E6D

Focus:       border-color var(--primary-500), ring 2px var(--primary-500)/20%
Error:       border-color var(--error), ring 2px var(--error)/20%
Disabled:    background var(--warm-100), color var(--dark-300)
```

### Select / Dropdown
Same as Text Input with chevron icon (16px) at right, 12px padding.

### Textarea
```
Min-height:  120px
Resize:      vertical
Other:       same as Text Input
```

## FAQ Accordion

```
Structure:
┌──────────────────────────────────────────┐
│  ▸  Question text here?                  │
└──────────────────────────────────────────┘
         ↓ (expanded)
┌──────────────────────────────────────────┐
│  ▾  Question text here?                  │
│                                          │
│  Answer text with detailed information   │
│  about the topic...                      │
└──────────────────────────────────────────┘

Question:
  Font:       DM Sans, 16px, Medium (500)
  Color:      var(--dark-600)
  Padding:    16px 0
  Border:     1px bottom var(--warm-400)
  Icon:       Chevron, 16px, right-aligned, rotates 180° on expand

Answer:
  Font:       DM Sans, 15px, Regular
  Color:      var(--dark-400)
  Padding:    0 0 16px 0
  Animation:  slideDown 250ms ease
```

## Brand Ticker / Logo Marquee

Horizontal infinite scroll of partner/brand logos.

```
Height:      60px
Background:  var(--dark-700) #2D1F15 or var(--warm-200)
Overflow:    hidden
Animation:   marquee linear infinite
Speed:       ~30s per cycle
Gap:         48px between logos
Logo color:  white (on dark bg) or var(--dark-400) (on light bg)
Opacity:     0.7 at rest, 1.0 on hover
```

## Section Backgrounds

### Cream Section
```css
background: var(--warm-200); /* #F7EDE3 */
```

### White Section
```css
background: var(--warm-50); /* #FFFDFB */
```

### Warm Beige Section
```css
background: var(--warm-300); /* #EDE0D4 */
```

### Image Split Section
Two-column with one side being a full-bleed image.
```
Image side:  overflow hidden, object-cover, rounded corners on inner edge
Content side: padding 48px (desktop), centered vertically
```

## Decorative Elements

### Botanical Illustrations
SVG illustrations of leaves, branches, and organic shapes placed as background decorations.

```
Color:      var(--deco-leaf) #C4956A at 20-40% opacity
Position:   absolute, behind content
Scale:      100-300px depending on context
Interaction: subtle parallax on scroll (optional)
```

### Decorative Circle
Semi-transparent circles used as background accents.

```
Size:       200-400px
Color:      var(--deco-circle) #D4A87C at 15-30% opacity
Border:     none or 1px solid at 10% opacity
Radius:     50%
Position:   absolute, offset from content
```

### Quote Mark
Large decorative quotation mark above testimonials.

```
Character:  " (U+201C)
Font:       Cormorant Garamond, 80px, Bold
Color:      var(--primary-300) #E8AC7E at 50% opacity
Position:   top-left of quote block
```

## Image Treatments

### Hero Image
```
Aspect:     free / auto
Radius:     var(--radius-2xl) 24px
Object-fit: cover
Treatment:  slight warm color overlay optional
```

### Service Card Image
```
Aspect:     4:3
Radius:     top-left and top-right inherit card radius
Object-fit: cover
Hover:      scale(1.05), 500ms ease
```

### Circular Portrait
```
Size:       64px / 80px / 120px variants
Radius:     50%
Border:     3px solid var(--warm-200)
Object-fit: cover
```

### Gallery Image (Mosaic)
```
Radius:     var(--radius-xl) 16px
Gap:        8px
Object-fit: cover
Hover:      subtle brightness(1.05), 300ms ease
```
