/**
 * File upload validation middleware.
 *
 * `validateUpload(allowedMimes, maxSizeBytes)` — call after multer to verify
 * MIME type from the magic bytes of the buffer, not just the `Content-Type`
 * header the client sends. Returns 422 if the file is not allowed.
 *
 * Supported detection:
 *   PDF     → %PDF
 *   PNG     → \x89PNG
 *   JPEG    → \xFF\xD8\xFF
 *   TIFF    → II* or MM0*
 *   WebP    → RIFF....WEBP
 *   BMP     → BM
 */

import { Request, Response, NextFunction } from "express";

const MAGIC: Array<{ mime: string; offset: number; bytes: Buffer }> = [
  { mime: "application/pdf", offset: 0, bytes: Buffer.from([0x25, 0x50, 0x44, 0x46]) },         // %PDF
  { mime: "image/png",       offset: 0, bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },         // \x89PNG
  { mime: "image/jpeg",      offset: 0, bytes: Buffer.from([0xff, 0xd8, 0xff]) },                // JFIF / EXIF
  { mime: "image/tiff",      offset: 0, bytes: Buffer.from([0x49, 0x49, 0x2a, 0x00]) },         // TIFF LE
  { mime: "image/tiff",      offset: 0, bytes: Buffer.from([0x4d, 0x4d, 0x00, 0x2a]) },         // TIFF BE
  { mime: "image/bmp",       offset: 0, bytes: Buffer.from([0x42, 0x4d]) },                     // BM
  { mime: "image/webp",      offset: 0, bytes: Buffer.from([0x52, 0x49, 0x46, 0x46]) },         // RIFF (WEBP)
];

function sniffMime(buf: Buffer): string | null {
  for (const entry of MAGIC) {
    const slice = buf.subarray(entry.offset, entry.offset + entry.bytes.length);
    if (slice.equals(entry.bytes)) {
      // Extra check for WebP: bytes 8-11 must be "WEBP"
      if (entry.mime === "image/webp") {
        const webpSig = buf.subarray(8, 12);
        if (!webpSig.equals(Buffer.from([0x57, 0x45, 0x42, 0x50]))) continue;
      }
      return entry.mime;
    }
  }
  return null;
}

const ALLOWED_MIMES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/bmp",
  "image/webp",
]);

/**
 * Express middleware — validates every file in req.files (or req.file) by
 * inspecting the raw buffer's magic bytes. Rejects with 422 on first invalid.
 *
 * @param allowed  Override the default ALLOWED_MIMES set (optional)
 * @param maxBytes Override the per-file size ceiling (optional, default 25 MB)
 */
export function validateUpload(
  allowed: ReadonlySet<string> = ALLOWED_MIMES,
  maxBytes = 25 * 1024 * 1024
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const files: Express.Multer.File[] = req.file
      ? [req.file]
      : Array.isArray(req.files)
        ? req.files
        : Object.values(req.files || {}).flat();

    if (files.length === 0) {
      next();
      return;
    }

    for (const file of files) {
      if (file.size > maxBytes) {
        res.status(422).json({
          success: false,
          error: `File "${file.originalname}" exceeds the maximum allowed size of ${Math.round(maxBytes / 1024 / 1024)} MB.`,
        });
        return;
      }

      const detectedMime = sniffMime(file.buffer);
      if (!detectedMime || !allowed.has(detectedMime)) {
        res.status(422).json({
          success: false,
          error: `File "${file.originalname}" has an unsupported or unrecognised type. Allowed: PDF, JPEG, PNG, TIFF, WebP, BMP.`,
        });
        return;
      }
    }

    next();
  };
}
