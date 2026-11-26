// spec/frontend/projectLinks.md, "The project page names each vault network once, with its asset only when every vault on it agrees, and shows the website and X account only when present"
import { ExternalLink } from "@repo/ui";
import { Result, Schema } from "effect";
import { Fragment, type ReactNode } from "react";
import { showsWebsite, showsXAccount } from "../../../gen/frontend__projectLinks.ts";
import { type ProjectChain, projectChains, websiteLabel, xHandle } from "../../kernels/projectLinks.ts";

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

const Deployments = Schema.Array(Schema.Struct({ network: Schema.String, asset: Schema.optional(Schema.NullOr(Schema.String)) }));
const LinksField = Schema.Struct({ website: Schema.optional(Schema.NullOr(Schema.String)), x: Schema.optional(Schema.NullOr(Schema.String)) });
const EscrowField = Schema.Struct({ deployments: Deployments });
const BountyField = Schema.Struct({ settlement: Schema.optional(Schema.NullOr(EscrowField)) });
const AssetField = Schema.Struct({ network: Schema.String, address: Schema.String, symbol: Schema.String });

const decodeLinks = Schema.decodeUnknownResult(LinksField);
const decodeEscrow = Schema.decodeUnknownResult(EscrowField);
const decodeBounty = Schema.decodeUnknownResult(BountyField);
const decodeAsset = Schema.decodeUnknownResult(AssetField);

function decodedOf<T>(result: Result.Result<T, unknown>): T | undefined {
  return Result.isSuccess(result) ? result.success : undefined;
}

function deploymentsOf(entries: ReadonlyArray<{ readonly network: string; readonly asset?: string | null }>): ReadonlyArray<{ readonly network: string; readonly asset?: string }> {
  return entries.map(({ network, asset }) => (typeof asset === "string" ? { network, asset } : { network }));
}

function safeWebsite(url: string | null | undefined): string {
  if (!url) return "";
  return URL.parse(url)?.protocol === "https:" ? url : "";
}

export interface ProjectLinksProps {
  /** The project's registry record as the project read served it. */
  record: unknown;
}

const chainText = (chains: ReadonlyArray<ProjectChain>) => `Chain: ${chains.map((chain) => (chain.symbol ? `${chain.name} (${chain.symbol})` : chain.name)).join(", ")}`;

function linkParts(record: unknown): ReadonlyArray<{ key: string; node: ReactNode }> {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return [];
  const raw = record as Readonly<Record<string, unknown>>;
  const links = decodedOf(decodeLinks(raw.links));
  const escrow = decodedOf(decodeEscrow(raw.escrow));
  const settlement = decodedOf(decodeBounty(raw.securityBounty))?.settlement;
  const rewardAsset = decodedOf(decodeAsset(raw.rewardAsset));
  const chains = projectChains({
    ...(escrow ? { escrow: { deployments: deploymentsOf(escrow.deployments) } } : {}),
    ...(settlement ? { securityBounty: { settlement: { deployments: deploymentsOf(settlement.deployments) } } } : {}),
    ...(rewardAsset ? { rewardAsset } : {}),
  });
  const website = safeWebsite(links?.website);
  const x = links?.x ?? "";
  const handle = xHandle(x) ?? "";
  const shown = { website, xAccount: handle };
  return [
    ...(chains.length > 0 ? [{ key: "chain", node: chainText(chains) }] : []),
    ...(showsWebsite(shown)
      ? [
          {
            key: "website",
            node: (
              <>
                Website:{" "}
                <ExternalLink className={linkClass} href={website}>
                  {websiteLabel(website)}
                </ExternalLink>
              </>
            ),
          },
        ]
      : []),
    ...(showsXAccount(shown)
      ? [
          {
            key: "x",
            node: (
              <>
                X:{" "}
                <ExternalLink className={linkClass} href={x}>
                  @{handle}
                </ExternalLink>
              </>
            ),
          },
        ]
      : []),
  ];
}

/** The project's vault networks, website and X account on one line, each only when present; nothing when none is. */
export function ProjectLinks({ record }: ProjectLinksProps) {
  const parts = linkParts(record);
  if (parts.length === 0) return null;
  return (
    <p className="text-foreground">
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index > 0 ? " · " : null}
          {part.node}
        </Fragment>
      ))}
    </p>
  );
}
