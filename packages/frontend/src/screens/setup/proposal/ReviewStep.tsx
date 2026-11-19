// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"; spec/backend/referralCodes.md, "A current reservation resolves through current open membership"
import { Avatar, Button, Card, NetworkMark, StatusIcon } from "@repo/ui";
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { ArrowRight, BookMarked, Bot, Check, GitBranch, Lock, Minus, Scale, UserPlus, X } from "lucide-react";
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
import { slopbotInstallUrl } from "../fields/slopbot.ts";
import { Chip } from "../../admin/parts.tsx";
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

function Fact({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="flex items-center gap-1 text-sm text-muted-foreground">{term}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-foreground">{children}</dd>
    </div>
  );
}

function MonthlyFunding({ proposal: p, pool }: { proposal: Proposal; pool: MonthlyPoolValue }) {
  if (!pool.valid) return "Invalid";
  const kind = rewardKindOf(p);
  const chain = chainOf(p);
  const symbol = rewardSymbol({ network: chain ?? "base", assetKind: kind, tokenSymbol: p.rewardAssetSymbol });
  const amount = kind === "stablecoin" ? `${formatBaseUnits({ value: BigInt(pool.minor), decimals: 6 })} ${assetSymbol({ kind, symbol }) ?? symbol}` : formatRewardCapDisplay(pool.display, { kind, symbol });
  return (
    <>
      {amount}/mo
      {chain === undefined ? p.settlementChain : <NetworkMark network={CHAIN_NAMES[chain]} showName={false} size="sm" role="img" aria-label={CHAIN_NAMES[chain]} title={CHAIN_NAMES[chain]} />}
      <Chip tone="Caution">Pledge</Chip>
    </>
  );
}

/** The listing as it will be created: identity, Slopbot, rewards, referral and the repository facts it rests on. */
export function ListingPreview({ proposal: p, pool, bounty, licenseKnown, referrer, onClearReferrer }: ListingPreviewProps) {
  const shares = bounty?.kind === "terms" ? bountyAmountPreview(bounty.terms.amount, p.monthlyPool) : undefined;
  const image = projectImage(p.image, ownerAvatar(p.stewardLogin));
  const autoClose = p.automaticClosure === "true";
  return (
    <Card asChild className="gap-6">
      <article aria-label="Listing preview">
        <div className="flex items-center gap-4">
          {image !== "" ? <Avatar name={p.stewardLogin || p.name || "Project"} src={image} size="lg" /> : <GitBranch aria-hidden className="size-7 text-muted-foreground" />}
          <h3 className="text-xl font-semibold text-foreground">{p.name || "Unnamed project"}</h3>
        </div>
        <p>{p.headline || "No short description yet."}</p>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact
            term={
              <>
                <Bot aria-hidden className="size-4" /> Slopbot
              </>
            }
          >
            <Button asChild variant="outline" size="sm">
              <a href={slopbotInstallUrl} target="_blank" rel="noreferrer" title={p.repository ? `Select only ${p.repository} on GitHub` : undefined}>
                Install Slopbot
              </a>
            </Button>
          </Fact>
          {p.fundingMode === "bounty" ? null : (
            <Fact term="Auto-close">
              <Chip tone={autoClose ? "Positive" : "Neutral"} icon={autoClose ? <Check aria-hidden /> : <Minus aria-hidden />}>
                {autoClose ? "On" : "Off"}
              </Chip>
            </Fact>
          )}
          {shares ? (
            <>
              <Fact term="Private bounty">
                {shares.gross} / finding <Chip tone="Caution">Pledge</Chip>
              </Fact>
              <Fact term="Split">
                <Chip>Researcher {shares.researcher}</Chip>
                <Chip>Slop {shares.slop}</Chip>
              </Fact>
            </>
          ) : p.fundingMode === "monthly" ? (
            <Fact term="Monthly funding">
              <MonthlyFunding proposal={p} pool={pool} />
            </Fact>
          ) : p.fundingMode === "bounty" ? (
            <Fact term="Private bounty">None</Fact>
          ) : null}
          {p.fundingMode === "monthly" ? <Fact term="Fee">2%</Fact> : null}
          {referrer ? (
            <Fact term="Referred by">
              <Chip icon={<UserPlus aria-hidden />}>@{referrer}</Chip>
              <Button variant="ghost" size="icon" aria-label="Clear referral" title="Clear referral" onClick={onClearReferrer}>
                <X aria-hidden className="size-4" />
              </Button>
            </Fact>
          ) : null}
        </dl>
        <p className="flex flex-wrap gap-2">
          <Chip icon={<BookMarked aria-hidden />} title="Repository">
            {p.repository || "Not set"}
          </Chip>
          <Chip icon={<GitBranch aria-hidden />} title="Branch">
            {p.integrationBranch}
          </Chip>
          <Chip title="Steward">{p.stewardLogin ? `@${p.stewardLogin}` : "No steward"}</Chip>
          <Chip icon={<Scale aria-hidden />} title="License">
            {licenseKnown ? p.licenseSpdx : "Unknown"}
          </Chip>
          {p.copyrightModel === "unknown" ? null : <Chip title="Copyright">© {p.copyrightModel.replaceAll("-", " ")}</Chip>}
          {shares ? <Chip icon={<Lock aria-hidden />}>Private reports</Chip> : null}
        </p>
        <p>{p.goal}</p>
        {shares ? (
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
