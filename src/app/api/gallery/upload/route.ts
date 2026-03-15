import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// POST /api/gallery/upload - Upload a photo file
export async function POST(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: "File too large. Maximum size: 10MB" },
        { status: 400 }
      );
    }

    // Generate unique filename
    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${randomUUID()}.${ext}`;

    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), "public", "uploads", "gallery");
    await mkdir(uploadDir, { recursive: true });

    // Write file to disk
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);

    // Generate thumbnail (simple copy for now, could use sharp for real thumbnails)
    const thumbDir = path.join(uploadDir, "thumbs");
    await mkdir(thumbDir, { recursive: true });
    const thumbPath = path.join(thumbDir, filename);
    await writeFile(thumbPath, buffer);

    const url = `/uploads/gallery/${filename}`;
    const thumbnailUrl = `/uploads/gallery/thumbs/${filename}`;

    console.log(`[Gallery Upload] File uploaded: ${filename} (${file.size} bytes)`);

    return NextResponse.json({
      success: true,
      data: {
        url,
        thumbnailUrl,
        filename,
        size: file.size,
        type: file.type,
      },
    });
  } catch (error) {
    console.error("[Gallery Upload] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to upload file" },
      { status: 500 }
    );
  }
}
