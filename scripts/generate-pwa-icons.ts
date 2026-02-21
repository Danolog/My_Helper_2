/**
 * Generate PWA icons from the SVG source.
 * Usage: npx tsx scripts/generate-pwa-icons.ts
 */
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Use fileURLToPath for tsx compatibility (import.meta.dirname may be undefined in tsx)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const SVG_SOURCE = path.join(PUBLIC_DIR, "icon.svg");

async function generate() {
  // Standard icons
  for (const size of [192, 512]) {
    await sharp(SVG_SOURCE)
      .resize(size, size)
      .png()
      .toFile(path.join(PUBLIC_DIR, `icon-${size}.png`));
    console.log(`Generated icon-${size}.png`);
  }

  // Maskable icons (with 10% safe zone padding = 20% total inset)
  for (const size of [192, 512]) {
    const padding = Math.round(size * 0.1);
    const innerSize = size - padding * 2;

    const inner = await sharp(SVG_SOURCE)
      .resize(innerSize, innerSize)
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite([{ input: inner, left: padding, top: padding }])
      .png()
      .toFile(path.join(PUBLIC_DIR, `icon-maskable-${size}.png`));

    console.log(`Generated icon-maskable-${size}.png`);
  }

  // Apple touch icon (180x180)
  await sharp(SVG_SOURCE)
    .resize(180, 180)
    .png()
    .toFile(path.join(PUBLIC_DIR, "apple-touch-icon.png"));
  console.log("Generated apple-touch-icon.png");

  console.log("All PWA icons generated successfully!");
}

generate().catch((err) => {
  console.error("Failed to generate icons:", err);
  process.exit(1);
});
