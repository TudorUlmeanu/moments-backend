import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import fs from "fs-extra";
import path from "path";
import { cfg } from "../config";
import { Readable } from "stream";

export const s3 = new S3Client({ region: cfg.region });

export async function getJson<T>(bucket: string, key: string): Promise<T> {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buf = await streamToBuffer(r.Body as Readable);
  return JSON.parse(buf.toString("utf-8")) as T;
}

export async function copyFileToPrefix(
  localPath: string,
  prefix: string,
  keyRel: string
) {
  const Body = await fs.readFile(localPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.publishBucket,
      Key: path.posix.join(prefix, keyRel).replace(/\\/g, "/"),
      Body,
    })
  );
}

export async function putBufferToPrefix(
  buf: Buffer,
  prefix: string,
  keyRel: string,
  contentType?: string
) {
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.publishBucket,
      Key: path.posix.join(prefix, keyRel).replace(/\\/g, "/"),
      Body: buf,
      ContentType: contentType,
    })
  );
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
