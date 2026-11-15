import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TypeScript errors are checked during build
  typescript: {
    ignoreBuildErrors: false,
  },

  // Samodzielny serwer (.next/standalone/server.js) z minimalnym node_modules —
  // to uruchamia obraz Dockera na Cloud Run (Dockerfile, etap `runner`).
  // Do C4 standalone włącza WYŁĄCZNIE Dockerfile (BUILD_STANDALONE=1 w etapie
  // `builder`); Vercel i CI budują bez zmian. Warunek znika w C4 razem z
  // vercel.json. Strażnik: __tests__/lib/container-config.test.ts (G-C1).
  // Rozwinięcie zamiast `output: … : undefined` — exactOptionalPropertyTypes
  // nie pozwala przypisać jawnego undefined do pola opcjonalnego NextConfig.
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),

  // Prevent bundling of native Node.js modules (sharp) — on Vercel and in the
  // standalone container alike. Without this, Next.js tries to bundle sharp but
  // cannot include native binaries, causing image generation/enhancement to
  // silently fail in production.
  serverExternalPackages: ["sharp"],

  // Image optimization configuration
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      // Zasobnik GCS (brief C, C2) — tylko gdy GCS_BUCKET jest ustawiony przy
      // budowie (Dockerfile, build-arg). Wpis Vercel Blob wyżej zostaje do C4:
      // stare adresy w bazie mają się ładować do końca kroku D.
      ...(process.env.GCS_BUCKET
        ? [
            {
              protocol: "https" as const,
              hostname: "storage.googleapis.com",
              pathname: `/${process.env.GCS_BUCKET}/**`,
            },
          ]
        : []),
    ],
  },

  // Enable compression
  compress: true,

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // CSP is set in middleware.ts with per-request nonce
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
