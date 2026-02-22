/**
 * MyHelper Design System — Tailwind CSS Configuration
 *
 * This extends the default shadcn/ui Tailwind setup with the
 * design system's warm terracotta palette, custom fonts, and
 * component-specific utilities.
 *
 * Usage in globals.css with Tailwind v4:
 *   Add the @theme inline block with these custom values.
 *
 * Usage in tailwind.config.ts (if using Tailwind v3):
 *   Import and spread into your config's `theme.extend`.
 */

// ============================================================
// FONT CONFIGURATION (for layout.tsx)
// ============================================================
//
// import { Cormorant_Garamond, DM_Sans } from "next/font/google";
//
// const cormorant = Cormorant_Garamond({
//   variable: "--font-heading",
//   subsets: ["latin", "latin-ext"],
//   weight: ["300", "400", "500", "600", "700"],
//   display: "swap",
// });
//
// const dmSans = DM_Sans({
//   variable: "--font-body",
//   subsets: ["latin", "latin-ext"],
//   weight: ["400", "500", "600", "700"],
//   display: "swap",
// });
//
// Apply to <body>:
//   className={`${cormorant.variable} ${dmSans.variable} antialiased`}

// ============================================================
// TAILWIND v4 — @theme inline block (for globals.css)
// ============================================================
//
// Add this INSIDE the existing @theme inline { } block in globals.css:
//
//   /* Design System: Fonts */
//   --font-heading: var(--font-heading), "Cormorant Garamond", Georgia, serif;
//   --font-body: var(--font-body), "DM Sans", system-ui, sans-serif;
//
//   /* Design System: Custom Colors (non-semantic) */
//   --color-primary-50: var(--primary-50);
//   --color-primary-100: var(--primary-100);
//   --color-primary-200: var(--primary-200);
//   --color-primary-300: var(--primary-300);
//   --color-primary-400: var(--primary-400);
//   --color-primary-500: var(--primary-500);
//   --color-primary-600: var(--primary-600);
//   --color-primary-700: var(--primary-700);
//   --color-primary-800: var(--primary-800);
//   --color-primary-900: var(--primary-900);
//
//   --color-warm-50: var(--warm-50);
//   --color-warm-100: var(--warm-100);
//   --color-warm-200: var(--warm-200);
//   --color-warm-300: var(--warm-300);
//   --color-warm-400: var(--warm-400);
//   --color-warm-500: var(--warm-500);
//
//   --color-dark-50: var(--dark-50);
//   --color-dark-100: var(--dark-100);
//   --color-dark-200: var(--dark-200);
//   --color-dark-300: var(--dark-300);
//   --color-dark-400: var(--dark-400);
//   --color-dark-500: var(--dark-500);
//   --color-dark-600: var(--dark-600);
//   --color-dark-700: var(--dark-700);
//   --color-dark-800: var(--dark-800);
//
//   --color-success: var(--success);
//   --color-success-light: var(--success-light);
//   --color-warning: var(--warning);
//   --color-warning-light: var(--warning-light);
//   --color-error: var(--error);
//   --color-error-light: var(--error-light);
//   --color-info: var(--info);
//   --color-info-light: var(--info-light);
//
//   --color-star-filled: var(--star-filled);
//   --color-star-empty: var(--star-empty);
//
//   --color-deco-leaf: var(--deco-leaf);
//   --color-deco-branch: var(--deco-branch);
//   --color-deco-circle: var(--deco-circle);
//   --color-deco-blob: var(--deco-blob);

// ============================================================
// TAILWIND v3 CONFIG (alternative, if not using v4)
// ============================================================

export const designSystemExtension = {
  fontFamily: {
    heading: [
      "var(--font-heading)",
      "Cormorant Garamond",
      "Georgia",
      "serif",
    ],
    body: ["var(--font-body)", "DM Sans", "system-ui", "sans-serif"],
  },
  colors: {
    primary: {
      50: "var(--primary-50)",
      100: "var(--primary-100)",
      200: "var(--primary-200)",
      300: "var(--primary-300)",
      400: "var(--primary-400)",
      500: "var(--primary-500)",
      600: "var(--primary-600)",
      700: "var(--primary-700)",
      800: "var(--primary-800)",
      900: "var(--primary-900)",
      DEFAULT: "var(--primary)",
      foreground: "var(--primary-foreground)",
    },
    warm: {
      50: "var(--warm-50)",
      100: "var(--warm-100)",
      200: "var(--warm-200)",
      300: "var(--warm-300)",
      400: "var(--warm-400)",
      500: "var(--warm-500)",
    },
    dark: {
      50: "var(--dark-50)",
      100: "var(--dark-100)",
      200: "var(--dark-200)",
      300: "var(--dark-300)",
      400: "var(--dark-400)",
      500: "var(--dark-500)",
      600: "var(--dark-600)",
      700: "var(--dark-700)",
      800: "var(--dark-800)",
    },
    success: {
      DEFAULT: "var(--success)",
      light: "var(--success-light)",
    },
    warning: {
      DEFAULT: "var(--warning)",
      light: "var(--warning-light)",
    },
    error: {
      DEFAULT: "var(--error)",
      light: "var(--error-light)",
    },
    info: {
      DEFAULT: "var(--info)",
      light: "var(--info-light)",
    },
    star: {
      filled: "var(--star-filled)",
      empty: "var(--star-empty)",
    },
    deco: {
      leaf: "var(--deco-leaf)",
      branch: "var(--deco-branch)",
      circle: "var(--deco-circle)",
      blob: "var(--deco-blob)",
    },
  },
  borderRadius: {
    sm: "6px",
    md: "8px",
    lg: "12px",
    xl: "16px",
    "2xl": "24px",
    full: "9999px",
  },
  boxShadow: {
    sm: "0 1px 2px rgba(45, 31, 21, 0.05)",
    md: "0 4px 12px rgba(45, 31, 21, 0.08)",
    lg: "0 8px 24px rgba(45, 31, 21, 0.10)",
    xl: "0 16px 48px rgba(45, 31, 21, 0.12)",
    inner: "inset 0 2px 4px rgba(45, 31, 21, 0.05)",
  },
  letterSpacing: {
    tightest: "-0.04em",
    tighter: "-0.03em",
    tight: "-0.02em",
    snug: "-0.01em",
    normal: "0",
    wide: "0.01em",
    wider: "0.02em",
    widest: "0.15em",
  },
  animation: {
    marquee: "marquee 30s linear infinite",
    "marquee-reverse": "marquee-reverse 30s linear infinite",
    "fade-in": "fadeIn 500ms ease forwards",
    "slide-up": "slideUp 500ms ease forwards",
    "slide-down": "slideDown 250ms ease forwards",
  },
  keyframes: {
    marquee: {
      "0%": { transform: "translateX(0)" },
      "100%": { transform: "translateX(-50%)" },
    },
    "marquee-reverse": {
      "0%": { transform: "translateX(-50%)" },
      "100%": { transform: "translateX(0)" },
    },
    fadeIn: {
      from: { opacity: "0" },
      to: { opacity: "1" },
    },
    slideUp: {
      from: { opacity: "0", transform: "translateY(20px)" },
      to: { opacity: "1", transform: "translateY(0)" },
    },
    slideDown: {
      from: { opacity: "0", maxHeight: "0" },
      to: { opacity: "1", maxHeight: "500px" },
    },
  },
} as const;
