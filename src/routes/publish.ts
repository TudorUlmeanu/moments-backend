import "dotenv/config";

import { Router } from "express";
import path from "node:path";
import { promises as fs } from "node:fs";

import { deployFromBucketPrefix, s3 } from "../services/amplify";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export const router = Router();

/**
 * Required env:
 *  - STORAGE_BUCKET (Amplify Storage bucket)
 *  - ALBUMS_PREFIX (default "albums")
 *  - Plus the ones read by services/amplify (AWS_REGION, AMPLIFY_APP_ID, PUBLISH_BUCKET)
 */
const STORAGE_BUCKET = process.env.STORAGE_BUCKET!;
const ALBUMS_PREFIX = process.env.ALBUMS_PREFIX || "albums";

/** Minimal content-type mapper */
function mimeFor(file: string): string | undefined {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return undefined;
  }
}

/** Recursively collect files under dir, returning [{Key, Body, ContentType}] */
async function collectTemplateFiles(
  root: string
): Promise<Array<{ Key: string; Body: Buffer; ContentType?: string }>> {
  const out: Array<{ Key: string; Body: Buffer; ContentType?: string }> = [];

  async function walk(absDir: string, relBase = "") {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(absDir, e.name);
      const rel = path.posix.join(relBase, e.name);
      if (e.isDirectory()) {
        await walk(abs, rel);
      } else if (e.isFile()) {
        const buf = await fs.readFile(abs);
        out.push({ Key: rel, Body: buf, ContentType: mimeFor(rel) });
      }
    }
  }

  await walk(root, "");
  if (!out.some((f) => f.Key === "index.html")) {
    throw new Error(`Template missing index.html at: ${root}`);
  }
  return out;
}

/** Robustly convert various AWS SDK v3 Body shapes to Buffer */
async function bodyToBuffer(body: any): Promise<Buffer> {
  if (!body) throw new Error("Empty S3 body");
  // Some runtimes expose transformToByteArray / arrayBuffer
  if (typeof body.transformToByteArray === "function") {
    const arr = await body.transformToByteArray();
    return Buffer.from(arr);
  }
  if (typeof body.arrayBuffer === "function") {
    const ab = await body.arrayBuffer();
    return Buffer.from(ab);
  }
  // Node Readable implements AsyncIterable
  if (Symbol.asyncIterator in Object(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<any>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  // Already a Buffer/string/Uint8Array?
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  throw new Error("Unsupported S3 Body type");
}

/** Fetch album.json; returns a file entry or null (non-fatal) */
async function fetchAlbumJson(params: {
  ownerIdentityId: string;
  albumId: string;
}): Promise<{ Key: string; Body: Buffer; ContentType: string } | null> {
  if (!STORAGE_BUCKET) return null;

  const key = path.posix.join(
    "private",
    params.ownerIdentityId,
    ALBUMS_PREFIX,
    params.albumId,
    "album.json"
  );

  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: STORAGE_BUCKET, Key: key })
    );
    const buf = await bodyToBuffer(res.Body as any);
    if (!buf?.length) throw new Error("album.json empty");
    return { Key: "album.json", Body: buf, ContentType: "application/json" };
  } catch (err: any) {
    console.warn("fetchAlbumJson: unable to load album.json:", err?.message);
    return null; // non-fatal
  }
}

/**
 * POST /api/publish
 * Body: { albumId: string, template?: string, ownerIdentityId: string }
 */
router.post("/publish", async (req, res) => {
  try {
    const { albumId, template, ownerIdentityId } = (req.body || {}) as {
      albumId?: string;
      template?: string;
      ownerIdentityId?: string;
    };

    console.log(req.body);

    if (!albumId || !String(albumId).trim()) {
      return res.status(400).json({ error: "albumId is required" });
    }
    if (!ownerIdentityId || !String(ownerIdentityId).trim()) {
      return res.status(400).json({ error: "ownerIdentityId is required" });
    }

    // e.g., templates/minimal/dist
    const templateName = (template || "Minimal").trim();
    const templateDir = path.resolve(
      process.cwd(),
      "templates",
      templateName.toLowerCase(),
      "dist"
    );

    // 1) Collect template files
    const templateFiles = await collectTemplateFiles(templateDir);

    // 2) Include album.json if present
    const albumJsonFile = await fetchAlbumJson({ ownerIdentityId, albumId });
    const files = albumJsonFile
      ? [albumJsonFile, ...templateFiles]
      : templateFiles;

    // 3) Deploy via Amplify (helpers ensure branchName + trailing slash)
    const { url, branchName } = await deployFromBucketPrefix({
      albumId,
      files,
    });

    return res.status(200).json({ url, branch: branchName });
  } catch (e: any) {
    console.error("publish failed:", e);
    return res
      .status(400)
      .json({ error: e?.message || "Publish failed. Check server logs." });
  }
});

export default router;
