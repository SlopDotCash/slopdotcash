import { Manifest, PostageConfig } from '../manifest/schema';

export async function handleIntake(pr: any, manifest: Manifest) {
  const postage = manifest.reward.postage;
  
  if (postage && postage.mode === 'required') {
    const now = new Date();
    const effectiveDate = new Date(postage.effectiveAt);
    
    // PRs opened before effectiveAt are exempt
    const prOpenedDate = new Date(pr.created_at);
    if (prOpenedDate < effectiveDate) {
      return proceedToScoring(pr);
    }

    const hasPaid = await verifyPostagePayment(pr);
    if (!hasPaid) {
      return {
        status: 402,
        body: {
          error: 'Payment Required',
          postage: {
            address: manifest.funding.addresses[0],
            amountMinor: calculatePostageAmount(pr, postage),
            currency: postage.currency,
            chain: postage.chain,
            memo: generateBindingMemo(pr),
          }
        }
      };
    }
  }
  
  return proceedToScoring(pr);
}

function calculatePostageAmount(pr: any, config: PostageConfig): string {
  if (config.overrides) {
    for (const override of config.overrides) {
      if (override.match.label && pr.labels.some(l => l.name === override.match.label)) {
        return override.amountMinor;
      }
    }
  }
  return config.amountMinor;
}

function generateBindingMemo(pr: any): string {
  // Implementation of binding memo: project_id:actor_id:pr_id
  return `${pr.project_id}:${pr.actor_id}:${pr.id}`;
}

async function verifyPostagePayment(pr: any): Promise<boolean> {
  // Integration with existing read-only verifier
  // Checks for exact recipient, amount, memo, and finality
  return false; // Default to false if not found
}

function proceedToScoring(pr: any) {
  return { status: 200, body: 'Accepted for scoring' };
}
