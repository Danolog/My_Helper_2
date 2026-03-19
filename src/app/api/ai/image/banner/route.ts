import { generateText } from "ai";
import sharp from "sharp";
import { z } from "zod";
import {
  generateImage,
  IMAGE_SIZES,
} from "@/lib/ai/google-imagen";
import {
  createAIClient,
  getAIModel,
  requireProAI,
  isProAIError,
  getSalonContext,
} from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";
import { upload } from "@/lib/storage";

// ────────────────────────────────────────────────────────────
// Request validation
// ────────────────────────────────────────────────────────────

const requestSchema = z.object({
  title: z.string().min(1, "Tytul promocji jest wymagany").max(100),
  subtitle: z.string().max(200).optional(),
  style: z
    .enum(["modern", "vintage", "minimal", "luxurious", "natural", "vibrant"])
    .default("modern"),
  size: z
    .enum([
      "instagram-square",
      "instagram-story",
      "facebook-post",
      "facebook-cover",
    ])
    .default("instagram-square"),
  overlayColor: z.enum(["dark", "light", "primary"]).default("dark"),
});

// ────────────────────────────────────────────────────────────
// SVG text overlay helpers
// ────────────────────────────────────────────────────────────

/** Escape XML/HTML entities for safe SVG embedding */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Overlay colour presets mapping name to background and text fill */
const OVERLAY_COLORS = {
  dark: { bg: "rgba(0,0,0,0.6)", text: "#ffffff" },
  light: { bg: "rgba(255,255,255,0.8)", text: "#1a1a1a" },
  primary: { bg: "rgba(124,58,237,0.75)", text: "#ffffff" },
} as const;

/**
 * Build an SVG buffer for the text overlay that gets composited on top of
 * the AI-generated background image.
 *
 * The overlay is a semi-transparent rectangle pinned to the bottom of the
 * banner, with the title (and optional subtitle) rendered as SVG <text>.
 */
function buildOverlaySvg(
  width: number,
  height: number,
  title: string,
  subtitle: string | undefined,
  overlayColor: keyof typeof OVERLAY_COLORS,
): Buffer {
  const colors = OVERLAY_COLORS[overlayColor];

  // Scale font sizes relative to the banner width
  const titleSize = Math.round(width * 0.06);
  const subtitleSize = Math.round(width * 0.035);
  const padding = Math.round(width * 0.08);

  // Overlay rectangle height depends on whether we have a subtitle
  const overlayHeight = subtitle
    ? Math.round(height * 0.35)
    : Math.round(height * 0.25);
  const overlayY = height - overlayHeight;

  // Vertical positioning of text lines within the overlay
  const titleY = overlayY + Math.round(overlayHeight * 0.45);
  const subtitleY = titleY + Math.round(titleSize * 1.5);

  const parts: string[] = [
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect x="0" y="${overlayY}" width="${width}" height="${overlayHeight}" fill="${colors.bg}" />`,
    `<text x="${padding}" y="${titleY}" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="bold" fill="${colors.text}">${escapeXml(title)}</text>`,
  ];

  if (subtitle) {
    parts.push(
      `<text x="${padding}" y="${subtitleY}" font-family="Arial, Helvetica, sans-serif" font-size="${subtitleSize}" fill="${colors.text}" opacity="0.9">${escapeXml(subtitle)}</text>`,
    );
  }

  parts.push(`</svg>`);

  return Buffer.from(parts.join(""));
}

// ────────────────────────────────────────────────────────────
// POST /api/ai/image/banner
// ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Auth + Pro plan check
  const proResult = await requireProAI();
  if (isProAIError(proResult)) return proResult;
  const { salonId } = proResult;

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Nieprawidlowe dane wejsciowe",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { title, subtitle, style, size, overlayColor } = parsed.data;

  // Fetch salon context for prompt enrichment
  const { salonName, industryLabel } = await getSalonContext(salonId);

  // ── Step 1: Generate an optimised background prompt using AI ──
  // The LLM converts the Polish promotion text into an English prompt
  // suitable for Imagen, avoiding text/people/faces in the background.
  let bgPrompt: string;
  try {
    const openrouter = createAIClient();
    const promptResult = await generateText({
      model: openrouter(getAIModel()),
      system: [
        `You create short image generation prompts for promotional banners of a ${industryLabel} called "${salonName}".`,
        "The background should be abstract/decorative (no text, no people, no faces).",
        "Return ONLY the English prompt, nothing else.",
      ].join(" "),
      prompt: `Create a banner background for promotion: "${title}"${subtitle ? ` - ${subtitle}` : ""}`,
      maxOutputTokens: 100,
    });
    bgPrompt =
      promptResult.text.trim() ||
      `elegant ${industryLabel} promotional background`;
  } catch {
    // Fallback prompt when the LLM call fails (e.g. rate limit or timeout)
    bgPrompt =
      "elegant beauty salon promotional banner background, bokeh, soft lighting";
  }

  // ── Step 2: Resolve exact pixel dimensions from the size preset ──
  const sizePreset = IMAGE_SIZES[size];
  const dims = {
    w: sizePreset?.width ?? 1080,
    h: sizePreset?.height ?? 1080,
    ar: sizePreset?.aspectRatio ?? "1:1",
  };

  try {
    // ── Step 3: Generate background image with Google Imagen ──
    const bgResult = await generateImage(bgPrompt, {
      style,
      aspectRatio: dims.ar,
    });

    // ── Step 4: Resize background to exact target dimensions ──
    const background = await sharp(bgResult.imageData)
      .resize(dims.w, dims.h, { fit: "cover" })
      .toBuffer();

    // ── Step 5: Composite background + SVG text overlay ──
    const svgOverlay = buildOverlaySvg(
      dims.w,
      dims.h,
      title,
      subtitle,
      overlayColor,
    );

    const banner = await sharp(background)
      .composite([{ input: svgOverlay, top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();

    // ── Step 6: Upload to storage (or return data URI in local dev) ──
    const filename = `banner-${salonId}-${Date.now()}.jpg`;
    const hasVercelBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

    let bannerUrl: string;
    if (hasVercelBlob) {
      const stored = await upload(banner, filename, "banners");
      bannerUrl = stored.url;
    } else {
      // In local dev without Vercel Blob, return the image as a data URI
      // so the browser can display it without relying on static file serving,
      // which doesn't pick up files written to public/ during server runtime.
      bannerUrl = `data:image/jpeg;base64,${banner.toString("base64")}`;
    }

    logger.info("[AI Image] Banner generated", {
      salonId,
      style,
      size,
      bannerSize: banner.length,
    });

    return Response.json({
      success: true,
      bannerUrl,
      prompt: bgPrompt,
      size,
      style,
    });
  } catch (error) {
    logger.error("[AI Image] Banner generation error", { error });
    return Response.json(
      { error: "Blad podczas generowania baneru. Sprobuj ponownie." },
      { status: 500 },
    );
  }
}
