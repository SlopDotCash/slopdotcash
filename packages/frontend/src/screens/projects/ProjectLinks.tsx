// spec/frontend/projectLinks.md, "The project page names each vault network once, with its asset only when every vault on it agrees, and shows the website and X account only when present"
import { ExternalLink } from "@repo/ui";
import { Result, Schema } from "effect";
import { Fragment, type ReactNode } from "react";
import { showsWebsite, showsXAccount } from "../../../gen/frontend__projectLinks.ts";
import { type ProjectChain, projectChains, websiteLabel, xHandle } from "../../kernels/projectLinks.ts";

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

const Deployments = Schema.Array(Schema.Struct({ network: Schema.String, asset: Schema.String }));

const LinkedRecord = Schema.Struct({
  links: Schema.optional(Schema.Struct({ website: Schema.optional(Schema.String), x: Schema.optional(Schema.String) })),
  escrow: Schema.optional(Schema.Struct({ deployments: Deployments })),
  securityBounty: Schema.optional(Schema.Struct({ settlement: Schema.optional(Schema.Struct({ deployments: Deployments })) })),
  rewardAsset: Schema.optional(Schema.Struct({ network: Schema.String, address: Schema.String, symbol: Schema.String })),
});

const decodeLinked = Schema.decodeUnknownResult(LinkedRecord);

export interface ProjectLinksProps {
  /** The project's registry record as the project read served it. */
  record: unknown;
}

const chainText = (chains: ReadonlyArray<ProjectChain>) => `Chain: ${chains.map((chain) => (chain.symbol ? `${chain.name} (${chain.symbol})` : chain.name)).join(", ")}`;

function linkParts(record: unknown): ReadonlyArray<{ key: string; node: ReactNode }> {
  const decoded = decodeLinked(record);
  if (!Result.isSuccess(decoded)) return [];
  const linked = decoded.success;
  const chains = projectChains(linked);
  const website = linked.links?.website ?? "";
  const x = linked.links?.x ?? "";
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
