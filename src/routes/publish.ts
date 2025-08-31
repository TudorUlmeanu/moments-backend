import "dotenv/config";
import { Router } from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { deployFromBucketPrefix } from "../services/amplify";

export const router = Router();

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

async function collectTemplateFiles(
  templateName: string
): Promise<Array<{ Key: string; Body: Buffer; ContentType?: string }>> {
  const root = path.resolve(
    process.cwd(),
    "templates",
    templateName.toLowerCase(),
    "dist"
  );

  const out: Array<{ Key: string; Body: Buffer; ContentType?: string }> = [];

  async function walk(absDir: string, relBase = "") {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(absDir, e.name);
      const rel = path.posix.join(relBase, e.name);
      if (e.isDirectory()) await walk(abs, rel);
      else if (e.isFile()) {
        const buf = await fs.readFile(abs);
        out.push({ Key: rel, Body: buf, ContentType: mimeFor(rel) });
      }
    }
  }

  await walk(root);
  if (!out.some((f) => f.Key === "index.html")) {
    throw new Error(`Template missing index.html at: ${root}`);
  }
  return out;
}

router.post("/publish", async (req, res) => {
  try {
    const { albumId, template } = (req.body || {}) as {
      albumId?: string;
      template?: string;
    };

    if (!albumId || !String(albumId).trim()) {
      return res.status(400).json({ error: "albumId is required" });
    }

    const templateName = (template || "minimal").trim();

    // Load built files from templates/<name>/dist
    const files = await collectTemplateFiles(templateName);

    // Deploy with in-flight replacement ONLY for upload
    const { url, branchName } = await deployFromBucketPrefix({
      albumId,
      files,
      replaceDuringUpload: {
        placeholder: "PLACEHOLDER_ALBUM_ID",
        exactJs: "index-CqQ4ARnn.js",
      },
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
