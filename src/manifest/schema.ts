export interface RewardConfig {
  reviewBudget?: string;
  postage?: PostageConfig;
}

export interface PostageConfig {
  mode: 'required' | 'priority';
  currency: string;
  chain: string;
  amountMinor: string;
  refund: 'on-merge-at-settlement';
  effectiveAt: string; // ISO 8601 UTC
  overrides?: PostageOverride[];
}

export interface PostageOverride {
  match: {
    label?: string;
    path?: string;
  };
  amountMinor: string;
}

export interface Manifest {
  // ... existing fields
  reward: RewardConfig;
  funding: {
    addresses: string[];
    // ... other funding fields
  };
}
