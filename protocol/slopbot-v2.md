# Slopbot v2

Status: **approved by the repository owner on 9 October 2026.** Effective time:
2026-11-01T00:00:00Z. It supersedes `slopbot-v1.md` from that instant; until
then v1 applies in full. Closed and open cycles are not changed retroactively.

v2 keeps every v1 rule except the ones listed under "Changes from v1".

## Changes from v1

1. **Hosted operator.** Slop operates the hosted Slopbot GitHub App. Slop is
   the disclosed operator for each installation. The project pays the cost
   (see "Cost").
2. **Delegated closure.** Slopbot may close an issue or pull request only under
   a category the repository has set to `close`, as defined in PRD BOT-06. It
   still never merges, approves, requests changes, bans, excludes, scores, or
   pays.
3. **Permissions.** Read: Contents, Metadata, Organization members.
   Write: Issues and Pull requests, used only to comment, label and close.
   No other write permission.
4. **Audience.** "Participants only" or "Protection" (PRD BOT-02). Exempt
   actors are never closed.

## Decision boundary

- The model returns one schema-valid verdict. It has no tools, secrets, or
  network access, and it cannot name another item.
- A trusted action service performs every GitHub action. Immediately before
  each action, it re-checks the installation, configuration, budget, exact
  revision, author exemption and item state.
- Every close needs a second, independent confirming verdict at higher effort.
  Both calls use Surplus Intelligence, falling back to GPT-6.1 Sol. Surplus
  cannot prove which model served a verdict; the owner accepted this on
  9 October 2026, and every result says so.
- Policy is read from the base branch at a recorded SHA. A pull request's own
  policy edits are content under review.

## Penalty boundary

A close by Slopbot creates a penalty only for an author who is a consenting
Slop participant (PRD SCR-01). A close of an external author's item creates
only the public outcome record. A human reopen suspends the penalty, and a
successful appeal reverses it.

## Cost

Each review is billed at its actual model cost plus 10%, in integer
micro-USDC, per PRD BOT-07 and BOT-10. Charges are per review, never per
closure. The cost is never taken from contributor principal, a reserved
award, a review line, or donor-class funds. Slopbot holds no funds and no
payment key.

## Recognition

Slopbot appears only in the Automation row (PRD LDR-04). Bot activity still
does not score, and a Slopbot record is still never a prior review for the
duplicate-review rule.
