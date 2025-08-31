import "dotenv/config";

import {
  AmplifyClient,
  GetBranchCommand,
  CreateBranchCommand,
  StartDeploymentCommand,
} from "@aws-sdk/client-amplify";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-west-2";

const APP_ID = process.env.AMPLIFY_APP_ID!;
const PUBLISH_BUCKET = process.env.PUBLISH_BUCKET!;

if (!APP_ID) throw new Error("AMPLIFY_APP_ID not set");
if (!PUBLISH_BUCKET) throw new Error("PUBLISH_BUCKET not set");

export const amplify = new AmplifyClient({ region: REGION });
export const s3 = new S3Client({ region: REGION });

const ensureSlash = (s: string) => (s.endsWith("/") ? s : s + "/");
export const toBranchName = (albumId: string) => {
  const cleaned = String(albumId).trim();
  if (!cleaned) throw new Error("albumId empty → cannot derive branchName");
  // keep Amplify-friendly chars
  const safe = cleaned.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 255);
  return safe.startsWith("album-") ? safe : `album-${safe}`;
};
export const branchPrefix = (branchName: string) => `branches/${branchName}/`; // NOTE trailing slash

export async function ensureBranch(appId: string, branchName: string) {
  if (!branchName) throw new Error("branchName missing for ensureBranch");
  try {
    await amplify.send(new GetBranchCommand({ appId, branchName }));
  } catch (e: any) {
    if (e?.name !== "NotFoundException") throw e;
    await amplify.send(
      new CreateBranchCommand({ appId, branchName, stage: "PRODUCTION" })
    );
  }
}

export async function deployFromBucketPrefix(params: {
  albumId: string;
  files: Array<{
    Key: string;
    Body: Buffer | Uint8Array | string;
    ContentType?: string;
  }>;
}) {
  // 1) derive +
  const branchName = toBranchName(params.albumId);
  const prefix = branchPrefix(branchName); // ends with '/'

  // 2) ensure branch exists
  await ensureBranch(APP_ID, branchName);

  // 3) upload artifacts into s3://bucket/branches/<branchName>/...
  for (const f of params.files) {
    await s3.send(
      new PutObjectCommand({
        Bucket: PUBLISH_BUCKET,
        Key: prefix + f.Key,
        Body: f.Body,
        ContentType: f.ContentType,
      })
    );
  }

  // 4) trigger deployment (sourceUrl MUST end with '/')
  await amplify.send(
    new StartDeploymentCommand({
      appId: APP_ID,
      branchName,
      sourceUrlType: "BUCKET_PREFIX",
      sourceUrl: `s3://${PUBLISH_BUCKET}/${ensureSlash(prefix)}`,
    })
  );

  const defaultDomain = process.env.AMPLIFY_DEFAULT_DOMAIN; // optional
  const url = defaultDomain
    ? `https://${branchName}.${defaultDomain}/`
    : undefined;

  return { branchName, url };
}
