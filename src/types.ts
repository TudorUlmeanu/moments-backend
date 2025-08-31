export type TemplateName = "Minimal" | "Grid";

export type S3PhotoRef = { id: string; key: string };

export type AlbumMeta = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  passcode?: string;
  template: TemplateName;
  coverId: string | null;
  photos: S3PhotoRef[];
  published?: boolean;
  publishedUrl?: string;
  createdAt: string;
  updatedAt?: string;
  ownerIdentityId: string; // <-- add this in your editor on save
};
