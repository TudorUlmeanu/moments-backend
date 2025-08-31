import { Router } from "express";
import { z } from "zod";
import { cfg } from "../config";
import {
  ensureBranch,
  ensureDomainAssociation,
  startDeploymentFromS3Prefix,
  upsertSubdomain,
} from "../services/amplify";
import { buildAlbumToS3Prefix } from "../builders/buildAlbumFromS3";

const router = Router();

const PublishBody = z.object({
  albumId: z.string().min(1),
  template: z.string().min(1), // "Minimal" | "Grid"
  ownerIdentityId: z.string().min(1), // provided by frontend
});

router.post("/", async (req, res) => {
  const parse = PublishBody.safeParse(req.body);
  if (!parse.success)
    return res.status(400).json({ error: parse.error.issues });
  const { albumId, template, ownerIdentityId } = parse.data;

  const branchName = `album-${albumId}`;
  const deployPrefix = `branches/${branchName}`;

  try {
    // 1) Ensure branch
    await ensureBranch(branchName);

    // 2) Build to S3 prefix
    await buildAlbumToS3Prefix({
      albumId,
      template,
      ownerIdentityId,
      destPrefix: deployPrefix,
    });

    // 3) Start deployment from S3 prefix
    await startDeploymentFromS3Prefix(branchName, deployPrefix);

    // 4) Map subdomain → branch
    await ensureDomainAssociation(cfg.rootDomain);
    const subPrefix = branchName; // album-<id>
    await upsertSubdomain(cfg.rootDomain, subPrefix, branchName);

    const url = `https://${subPrefix}.${cfg.rootDomain}/`;
    res.json({ url });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message ?? "publish failed" });
  }
});

const UnpublishBody = z.object({
  albumId: z.string().min(1),
});

router.post("/unpublish", async (req, res) => {
  // optional: remove mapping (read domain association & filter out prefix → UpdateDomainAssociation)
  // left as an exercise, same pattern as upsertSubdomain but removing the entry.
  res.json({ ok: true });
});

export default router;
