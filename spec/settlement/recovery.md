# Private-award destination recovery

PRD sections 3, 6, 8 and 10 require a successor request and renewed reporter
consent after a wallet change. The [direct standard award journal](./directBounty.md)
is the single model of this recovery: its `recover` transition changes only
an unpaid leg after exact retirement and renewed consent, an old request that
finalizes first ends recovery without a successor payment, and every prior
generation stays retained with its retirement evidence.
