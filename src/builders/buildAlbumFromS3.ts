import fs from "fs-extra";
import path from "path";
import { cfg } from "../config";
import { AlbumMeta } from "../types";
import {
  getJson,
  putBufferToPrefix,
  copyFileToPrefix,
  s3,
} from "../services/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function buildAlbumToS3Prefix(params: {
  albumId: string;
  template: string; // "Minimal" | ...
  ownerIdentityId: string;
  destPrefix: string; // e.g. branches/album-<id>
}) {
  const { albumId, template, ownerIdentityId, destPrefix } = params;

  // 1) Read album meta from Amplify Storage (private/<identityId>/albums/<id>/album.json)
  const metaKey = `private/${ownerIdentityId}/${cfg.albumsPrefix}/${albumId}/album.json`;
  const meta = await getJson<AlbumMeta>(cfg.storageBucket, metaKey);

  // 2) Copy template dist to S3 (index.html, assets, etc.)
  const templateDir = path.resolve(
    process.cwd(),
    "templates",
    template.toLowerCase(),
    "dist"
  );
  if (!(await fs.pathExists(templateDir))) {
    throw new Error(`Template dist not found: ${templateDir}`);
  }
  // walk template and upload
  const files = await fs.readdir(templateDir, { withFileTypes: true });
  await uploadDirRecursive(templateDir, destPrefix);

  // 3) Write album.json
  const albumJson = Buffer.from(JSON.stringify(meta, null, 2), "utf-8");
  await putBufferToPrefix(
    albumJson,
    destPrefix,
    "album.json",
    "application/json"
  );

  // 4) Copy photos referenced in meta to /photos/
  for (const p of meta.photos) {
    // User editor saved keys without the "private/<identityId>/" prefix.
    // Actual object in Storage is: private/<identityId>/<p.key>
    const storageKey = `private/${ownerIdentityId}/${p.key}`;
    const r = await s3.send(
      new GetObjectCommand({ Bucket: cfg.storageBucket, Key: storageKey })
    );
    const buf = await streamToBuffer(r.Body as Readable);
    await putBufferToPrefix(
      buf,
      destPrefix,
      `photos/${path.basename(p.key)}`,
      r.ContentType || "image/webp"
    );
  }
}

async function uploadDirRecursive(
  localDir: string,
  destPrefix: string,
  rel = ""
): Promise<void> {
  const entries = await fs.readdir(path.join(localDir, rel), {
    withFileTypes: true,
  });
  await Promise.all(
    entries.map(async (e) => {
      const relPath = path.posix.join(rel, e.name);
      const full = path.join(localDir, relPath);
      if (e.isDirectory())
        return uploadDirRecursive(localDir, destPrefix, relPath);
      return copyFileToPrefix(full, destPrefix, relPath);
    })
  );
}
