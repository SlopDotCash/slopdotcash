// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"; spec/backend/referralCodes.md, "A current reservation resolves through current open membership"
import { Avatar, Button, Card, StatusIcon } from "@repo/ui";
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { ArrowRight, GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { projectImage } from "../../../../gen/frontend__presentation.ts";
import type { PageRuntime } from "../../../app/runtime.vibe";
import type { MonthlyPoolValue, Proposal } from "../../../flows/projects/proposal.ts";
import { type BountyTerms, bountyAmountPreview, privateBountyDisclosure, privateBountyTesting } from "../../../flows/security/program.vibe";
import { assetSymbol, CHAIN_NAMES, formatRewardCapDisplay } from "../../../kernels/assetText.ts";
import type { SessionView } from "../../../session/session.vibe";
import { ownerAvatar } from "../fields/ProjectImageField.tsx";
import { type SkillProvenance, SkillPreview } from "../fields/SkillPreview.tsx";
import { draftRegistry } from "../fields/skills.vibe";
import { rewardSymbol } from "../fields/rewardAsset.ts";
import { slopbotInstallScopeNote } from "../fields/slopbot.ts";
import { chainOf, rewardKindOf } from "./form.ts";
import { useRun } from "./run.ts";

export type ListingPreviewProps = {
  proposal: Proposal;
  pool: MonthlyPoolValue;
  bounty: BountyTerms | undefined;
  licenseKnown: boolean;
  referrer: string | null;
  onClearReferrer: () => void;
};

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}

function monthlyFunding(p: Proposal, pool: MonthlyPoolValue): string {
  if (p.fundingMode !== "monthly") return "None";
  if (!pool.valid) return "Invalid";
  const kind = rewardKindOf(p);
  const chain = chainOf(p);
  const symbol = rewardSymbol({ network: chain ?? "base", assetKind: kind, tokenSymbol: p.rewardAssetSymbol });
  const amount = kind === "stablecoin" ? `${formatBaseUnits({ value: BigInt(pool.minor), decimals: 6 })} ${assetSymbol({ kind, symbol }) ?? symbol}` : formatRewardCapDisplay(pool.display, { kind, symbol });
  return `${amount} on ${chain === undefined ? p.settlementChain : CHAIN_NAMES[chain]} · pledge`;
}

/** The listing as it will be created: identity, Slopbot, rewards, referral and the repository facts it rests on. */
export function ListingPreview({ proposal: p, pool, bounty, licenseKnown, referrer, onClearReferrer }: ListingPreviewProps) {
  const shares = bounty?.kind === "terms" ? bountyAmountPreview(bounty.terms.amount, p.monthlyPool) : undefined;
  const image = projectImage(p.image, ownerAvatar(p.stewardLogin));
  return (
    <Card asChild className="gap-6">
      <article aria-label="Listing preview">
      <div className="flex items-center gap-4">
        {image !== "" ? <Avatar name={p.stewardLogin || p.name || "Project"} src={image} size="lg" /> : <GitBranch aria-hidden className="size-7 text-muted-foreground" />}
        <h3 className="text-xl font-semibold text-foreground">{p.name || "Unnamed project"}</h3>
      </div>
      <p>{p.headline || "No short description yet."}</p>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact term="Before you create">
          Install Slopbot on {p.repository || "the repository"}. {slopbotInstallScopeNote(p.repository || "that repository")}
        </Fact>
        {p.fundingMode === "bounty" ? null : <Fact term="Slopbot automatic closure">{p.automaticClosure === "true" ? "Allowed" : "Not allowed"}</Fact>}
        <Fact term={shares ? "Private bounty" : "Monthly funding"}>{shares ? `${shares.gross} per accepted finding · pledge` : monthlyFunding(p, pool)}</Fact>
        {shares ? (
          <Fact term="Researcher / Slop">
            {shares.researcher} / {shares.slop}
          </Fact>
        ) : null}
        {p.fundingMode === "monthly" ? <Fact term="Fees">2% of ordinary awards and unused-fund withdrawals.</Fact> : null}
        {referrer ? (
          <Fact term="Referred by">
            <span className="flex flex-wrap items-center gap-2">
              @{referrer}
              <Button variant="link" onClick={onClearReferrer}>
                Clear referral
              </Button>
            </span>
          </Fact>
        ) : null}
      </dl>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact term="Repository">
          {p.repository || "Not set"} · {p.integrationBranch}
        </Fact>
        <Fact term="Steward">{p.stewardLogin ? `@${p.stewardLogin}` : "Not set"}</Fact>
        <Fact term="License">{licenseKnown ? p.licenseSpdx : "Unknown"}</Fact>
        <Fact term="Copyright">{p.copyrightModel.replaceAll("-", " ")}</Fact>
      </dl>
      <p>{p.goal || "No goal yet."}</p>
      {bounty?.kind === "terms" ? (
        <>
          <p>{p.criteria}</p>
          <p>{p.requiredTests || privateBountyTesting}</p>
          <p>{privateBountyDisclosure}</p>
        </>
      ) : null}
      </article>
    </Card>
  );
}

/** Both generated skills for the draft manifest, bound to its digest as revision 1. */
export function DraftSkills({ runtime, manifest }: { runtime: PageRuntime; manifest: unknown }) {
  const text = JSON.stringify(manifest);
  const read = useRun(runtime, `skills:${text}`, () => draftRegistry(text), "Could not prepare the skill preview. Reload and try again.");
  const provenance: SkillProvenance = read === undefined || read.status === "running" ? { status: "preparing" } : read.status === "failed" ? { status: "failed" } : { status: "ready", registry: read.value };
  return <SkillPreview manifest={manifest} provenance={provenance} draft compact />;
}

export type SubmitProjectProps = {
  session: SessionView;
  loginHref: string;
  submitting: boolean;
  onSubmit: () => void;
};

/** Create with the signed-in account; the server checks authority again. */
export function SubmitProject({ session, loginHref, submitting, onSubmit }: SubmitProjectProps) {
  if (session.status === "checking")
    return (
      <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
        <StatusIcon icon="Spinner" />
        Checking sign-in…
      </p>
    );
  if (session.status !== "signedIn")
    return (
      <Button asChild>
        <a href={loginHref}>Sign in with GitHub</a>
      </Button>
    );
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button loading={submitting} onClick={onSubmit}>
        {submitting ? "Creating…" : "Create project"}
        <ArrowRight aria-hidden className="size-4" />
      </Button>
      <span className="text-sm text-muted-foreground">@{session.session.githubLogin}</span>
    </div>
  );
}
