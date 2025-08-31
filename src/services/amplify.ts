import "dotenv/config";
import {
  AmplifyClient,
  GetBranchCommand,
  CreateBranchCommand,
  StartDeploymentCommand,
} from "@aws-sdk/client-amplify";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

/** Read + validate env only when needed */
function getEnv() {
  const REGION =
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-west-2";
  const APP_ID = process.env.AMPLIFY_APP_ID;
  const PUBLISH_BUCKET = process.env.PUBLISH_BUCKET;
  const DEFAULT_DOMAIN = process.env.AMPLIFY_DEFAULT_DOMAIN || ""; // optional (e.g., dXXXX.amplifyapp.com)

  if (!APP_ID) throw new Error("AMPLIFY_APP_ID not set");
  if (!PUBLISH_BUCKET) throw new Error("PUBLISH_BUCKET not set");

  return { REGION, APP_ID, PUBLISH_BUCKET, DEFAULT_DOMAIN };
}

export function makeClients() {
  const { REGION } = getEnv();
  return {
    amplify: new AmplifyClient({ region: REGION }),
    s3: new S3Client({ region: REGION }),
  };
}

const ensureSlash = (s: string) => (s.endsWith("/") ? s : s + "/");

export const toBranchName = (albumId: string) => {
  const cleaned = String(albumId ?? "").trim();
  if (!cleaned) throw new Error("albumId empty → cannot derive branchName");
  const safe = cleaned.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 255);
  return safe.startsWith("album-") ? safe : `album-${safe}`;
};

export const branchPrefix = (branchName: string) => `branches/${branchName}/`;

export async function ensureBranch(appId: string, branchName: string) {
  if (!branchName) throw new Error("branchName missing for ensureBranch");
  const { amplify } = makeClients();
  try {
    await amplify.send(new GetBranchCommand({ appId, branchName }));
  } catch (e: any) {
    if (e?.name !== "NotFoundException") throw e;
    await amplify.send(
      new CreateBranchCommand({ appId, branchName, stage: "PRODUCTION" })
    );
  }
}

/** Helpers for in-flight replacement (upload payload only) */
const bodyToUtf8 = (b: Buffer | Uint8Array | string) =>
  Buffer.isBuffer(b)
    ? b.toString("utf-8")
    : typeof b === "string"
    ? b
    : Buffer.from(b).toString("utf-8");

// NEW: basename helper
const baseName = (p: string) => {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
};

/**
 * If fileKey matches, replace all occurrences of placeholder with albumId in the upload payload.
 * - If exactJs is set, we compare by BASENAME and also allow any path that ends with that name.
 * - Otherwise, any ".js" file is scanned.
 */
function maybeReplaceAlbumId(opts: {
  fileKey: string;
  body: Buffer | Uint8Array | string;
  placeholder: string;
  albumId: string;
  exactJs?: string; // e.g., "index-CqQ4ARnn.js"
}): Buffer | Uint8Array | string {
  const { fileKey, body, placeholder, albumId, exactJs } = opts;

  const keyLower = fileKey.toLowerCase();
  const targetByExt = keyLower.endsWith(".js");
  const targetByExact =
    !!exactJs &&
    (fileKey === exactJs ||
      keyLower.endsWith("/" + exactJs.toLowerCase()) ||
      baseName(fileKey).toLowerCase() === exactJs.toLowerCase());

  const isTarget = exactJs ? targetByExact : targetByExt;
  if (!isTarget) return body;

  const text = bodyToUtf8(body);
  if (!text.includes(placeholder)) return body;

  const patched = text.split(placeholder).join(albumId);

  // Optional: log once so you can verify
  console.log(`[publish] replaced "${placeholder}" in ${fileKey}`);

  return Buffer.from(patched, "utf-8");
}

/** Main deploy helper */
export async function deployFromBucketPrefix(params: {
  albumId: string;
  files: Array<{
    Key: string;
    Body: Buffer | Uint8Array | string;
    ContentType?: string;
  }>;
  replaceDuringUpload?: { placeholder: string; exactJs?: string };
}) {
  const { APP_ID, PUBLISH_BUCKET, DEFAULT_DOMAIN } = getEnv();
  const { amplify, s3 } = makeClients();

  const branchName = toBranchName(params.albumId);
  const prefix = branchPrefix(branchName); // ends with '/'

  await ensureBranch(APP_ID, branchName);

  for (const f of params.files) {
    const bodyForUpload = params.replaceDuringUpload
      ? maybeReplaceAlbumId({
          fileKey: f.Key,
          body: f.Body,
          placeholder: params.replaceDuringUpload.placeholder,
          albumId: params.albumId,
          exactJs: params.replaceDuringUpload.exactJs,
        })
      : f.Body;

    await s3.send(
      new PutObjectCommand({
        Bucket: PUBLISH_BUCKET,
        Key: prefix + f.Key,
        Body: bodyForUpload,
        ContentType: f.ContentType,
      })
    );
  }

  await amplify.send(
    new StartDeploymentCommand({
      appId: APP_ID,
      branchName,
      sourceUrlType: "BUCKET_PREFIX",
      sourceUrl: `s3://${PUBLISH_BUCKET}/${ensureSlash(prefix)}`, // must end with '/'
    })
  );

  const url = DEFAULT_DOMAIN
    ? `https://${branchName}.${DEFAULT_DOMAIN}/`
    : undefined;
  return { branchName, url };
}
