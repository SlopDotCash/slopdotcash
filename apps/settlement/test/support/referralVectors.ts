// spec/settlement/referralPublication.md, "The next immutable filed tree supplies every root entry"
export const ONE = 10n ** 18n;

export const ALICE = "0x1111111111111111111111111111111111111111";
export const BOB = "0x2222222222222222222222222222222222222222";
export const CAROL = "0x3333333333333333333333333333333333333333";

export const distributorVectors = {
  alice: { address: ALICE, cumulativeBase: 100n * ONE },
  bob: { address: BOB, cumulativeBase: 250n * ONE },
  carol: { address: CAROL, cumulativeBase: 7n * ONE },
  aliceLeaf: "0x923a571f712ff2d205bc7da76152ab30459ae47d04647ff145ba9ad746468fc6",
  bobLeaf: "0x961b65b12221d8db52e43da798be51b873abf56862b42a2bc18e831faf7fbbd8",
  twoLeafRoot: "0x03f9627eb9aef1752099688f5bdd8bc3326fb0dfcafef85aab3c1482acfcdf9d",
  threeLeafRoot: "0x026d73c7c26605e67a53ae9cdc94e997f7828802e7947676fd52c3f1463877c9",
} as const;

export const reviewedVars = {
  REFERRAL_ACCRUAL_MODE: "DryRun",
  REFERRAL_FIRST_PERIOD: "2026-11",
  REFERRAL_RATE_BASE_PER_MICRO: "3000000000000",
  REFERRAL_TOKEN_DECIMALS: "18",
  REFERRAL_POOL_BASE: "2000000000000000000000000",
  REFERRAL_PROJECT_CAP_BASE: "250000000000000000000000",
  REFERRAL_WINDOW_MONTHS: "12",
  REFERRAL_EXCLUDED_GITHUB_IDS: "202660855",
} as const;
