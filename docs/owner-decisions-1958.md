# Owner Decisions — Issue #1958

## Decision 1: Third advertised paid program

Line 261 is superseded in part by line 77: any registered project may now
self-serve paid terms on Robinhood Chain using its own ERC-20, subject to the
ordinary 75/25 split and `fundingPolicy: "after-approval"` or prefunded
funding. Owner approval in principle is granted for the prospective Robinhood
Chain sponsor paying ~$3,000 per accepted finding in its staking token, with
its founder reviewing findings. The program may be published and advertised once
its terms are registered and funded per policy.

## Decision 2: Slop's 25% share

Consistent with line 332, Slop's 25% share on Robinhood Chain is retained in
the received asset (the sponsor's ERC-20) unchanged; no conversion to USDC
occurs on Robinhood Chain. On all other networks, Slop's 25% share converts to
USDC as before.

## Notes

- Umia Protocol and the slopdotcash contract bounty remain advertised programs.
- Other previously closed programs stay closed unless re-opened by owner decision.
- Payment code (ffb5fd13) already supports direct wallet payout with finalized
  evidence on Robinhood Chain.