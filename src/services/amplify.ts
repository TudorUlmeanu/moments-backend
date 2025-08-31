// services/amplify.ts
import {
  AmplifyClient,
  CreateBranchCommand,
  GetBranchCommand,
  GetDomainAssociationCommand,
  CreateDomainAssociationCommand,
  UpdateDomainAssociationCommand,
  StartDeploymentCommand,
  type SubDomainSetting, // <-- import the type for clarity
} from "@aws-sdk/client-amplify";
import { cfg } from "../config";

const amplify = new AmplifyClient({ region: cfg.region });

export async function ensureBranch(branchName: string) {
  try {
    await amplify.send(
      new GetBranchCommand({ appId: cfg.amplifyAppId, branchName })
    );
  } catch {
    await amplify.send(
      new CreateBranchCommand({
        appId: cfg.amplifyAppId,
        branchName,
        enableAutoBuild: false,
        stage: "PRODUCTION",
        enablePerformanceMode: true,
      })
    );
  }
}

export async function ensureDomainAssociation(domainName: string) {
  try {
    await amplify.send(
      new GetDomainAssociationCommand({ appId: cfg.amplifyAppId, domainName })
    );
  } catch {
    await amplify.send(
      new CreateDomainAssociationCommand({
        appId: cfg.amplifyAppId,
        domainName,
        enableAutoSubDomain: false,
        subDomainSettings: [], // request field name = subDomainSettings
      })
    );
  }
}

/**
 * Add or update ONE subdomain mapping (prefix -> branch).
 * - Read existing mappings from response.field **subDomains**
 * - Convert to request.field **subDomainSettings**
 */
export async function upsertSubdomain(
  domainName: string,
  prefix: string,
  branchName: string
) {
  const current = await amplify.send(
    new GetDomainAssociationCommand({ appId: cfg.amplifyAppId, domainName })
  );

  // Response uses `subDomains` (array of { subDomainSetting, verified, dnsRecord })
  const existingSettings: SubDomainSetting[] =
    current.domainAssociation?.subDomains?.map((sd) => sd.subDomainSetting!) ??
    [];

  const nextSettings: SubDomainSetting[] = [
    ...existingSettings.filter((s) => s.prefix !== prefix),
    { prefix, branchName },
  ];

  await amplify.send(
    new UpdateDomainAssociationCommand({
      appId: cfg.amplifyAppId,
      domainName,
      subDomainSettings: nextSettings, // request uses subDomainSettings
    })
  );
}

export async function startDeploymentFromS3Prefix(
  branchName: string,
  prefix: string
) {
  await amplify.send(
    new StartDeploymentCommand({
      appId: cfg.amplifyAppId,
      branchName,
      sourceUrl: `s3://${cfg.publishBucket}/${prefix}`,
      // If your SDK types require a union literal, this string is valid:
      // "BUCKET_PREFIX" (other allowed value is "ZIP")
      sourceUrlType: "BUCKET_PREFIX",
    })
  );
}
