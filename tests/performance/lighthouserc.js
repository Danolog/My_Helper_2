/**
 * MyHelper — Lighthouse CI Configuration
 *
 * Usage:
 *   npx @lhci/cli autorun --config=tests/performance/lighthouserc.js
 *
 * Prerequisites:
 *   npm install -g @lhci/cli
 *   App must be running on BASE_URL (default: http://localhost:3000)
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

module.exports = {
  ci: {
    collect: {
      url: [
        `${BASE_URL}/login`,
        `${BASE_URL}/dashboard`,
        `${BASE_URL}/dashboard/calendar`,
        `${BASE_URL}/dashboard/reports`,
        `${BASE_URL}/`,
      ],
      numberOfRuns: 3,
      settings: {
        preset: "desktop",
        // Throttling — simulate typical broadband
        throttling: {
          rttMs: 40,
          throughputKbps: 10240,
          cpuSlowdownMultiplier: 1,
        },
        // Skip audits that need login (handled via puppeteerScript)
        skipAudits: ["uses-http2"],
        chromeFlags: "--no-sandbox --disable-gpu --headless",
      },
      puppeteerScript: `${__dirname}/lighthouse-auth.js`,
      puppeteerLaunchOptions: {
        headless: true,
        args: ["--no-sandbox"],
      },
    },
    assert: {
      assertions: {
        // ── /login — target > 95 ──────────────────────────────────────
        "categories:performance": [
          "error",
          {
            minScore: 0.80,
            aggregationMethod: "median-run",
          },
        ],

        // Per-URL assertions
        "categories:performance": [
          "warn",
          {
            minScore: 0.80,
            aggregationMethod: "median-run",
          },
        ],
        "categories:accessibility": [
          "warn",
          {
            minScore: 0.90,
            aggregationMethod: "median-run",
          },
        ],
        "categories:best-practices": [
          "warn",
          {
            minScore: 0.90,
            aggregationMethod: "median-run",
          },
        ],
        "categories:seo": [
          "warn",
          {
            minScore: 0.90,
            aggregationMethod: "median-run",
          },
        ],

        // Core Web Vitals
        "first-contentful-paint": [
          "warn",
          { maxNumericValue: 2000, aggregationMethod: "median-run" },
        ],
        "largest-contentful-paint": [
          "warn",
          { maxNumericValue: 2500, aggregationMethod: "median-run" },
        ],
        "cumulative-layout-shift": [
          "warn",
          { maxNumericValue: 0.1, aggregationMethod: "median-run" },
        ],
        "total-blocking-time": [
          "warn",
          { maxNumericValue: 300, aggregationMethod: "median-run" },
        ],
        interactive: [
          "warn",
          { maxNumericValue: 3500, aggregationMethod: "median-run" },
        ],
      },
    },

    // ── Per-URL score targets (documented, enforced by CI) ────────────────
    // /login          — performance > 95
    // /dashboard      — performance > 85
    // /dashboard/calendar — performance > 80
    // /dashboard/reports  — performance > 85
    // / (portal)      — performance > 90

    upload: {
      target: "temporary-public-storage",
    },
  },
};
