import "dotenv/config";

export const cfg = {
  port: Number(process.env.PORT ?? 8080),
  region: process.env.AWS_REGION!,
  amplifyAppId: process.env.AMPLIFY_APP_ID!,
  rootDomain: process.env.ROOT_DOMAIN!,
  publishBucket: process.env.PUBLISH_BUCKET!,
  storageBucket: process.env.STORAGE_BUCKET!,
  albumsPrefix: process.env.ALBUMS_PREFIX ?? "albums",
};
