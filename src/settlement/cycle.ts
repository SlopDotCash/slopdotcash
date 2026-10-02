export interface SettlementLine {
  sharedPool: string;
  reviewBudget: string;
  postageRefund: string; // New line for postage refunds
}

export function calculateCycleSettlement(mergedPRs: any[], manifest: Manifest) {
  let totalPostageRefund = "0";
  const postage = manifest.reward.postage;

  if (postage && postage.refund === 'on-merge-at-settlement') {
    mergedPRs.forEach(pr => {
      if (pr.hasVerifiedPostage) {
        const amount = calculatePostageAmount(pr, postage);
        totalPostageRefund = addMinorUnits(totalPostageRefund, amount);
      }
    });
  }

  return {
    lines: {
      sharedPool: "...",
      reviewBudget: "...",
      postageRefund: totalPostageRefund
    }
  };
}

function addMinorUnits(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

function calculatePostageAmount(pr: any, config: any): string {
  // Same logic as in intake/handler.ts
  return config.amountMinor;
}
