---
name: review-eliza-plugin-homonym-contributions
description: Reviews exact-head eliza-plugin-homonym contributions for functional adherence, build integrity, and x402 payment security.
---

# Reviewing eliza-plugin-homonym Contributions

This skill guides maintainers, contributors, and automated review agents evaluating pull requests submitted to `eliza-plugin-homonym`.

## Review Scope

Reviews should evaluate pull requests against the target repository:
- Repository: https://github.com/mutedjapandi/eliza-plugin-homonym
- Branch: main

## Verification Checklist

1. **Build Artifacts:** Confirm that `dist/index.js`, `dist/index.cjs`, and `dist/index.d.ts` match the compiled source of `src/index.ts`.
2. **Security & Addresses:** Verify that the Base USDC contract address (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) and recipient address (`0xa448482995061168968ff0cf1b890506ab40250f`) have not been tampered with.
3. **Execution Handling:** Ensure the `PLAY_HOMONYM` action cleanly catches network errors, insufficient funds, and session timeouts without crashing the agent runtime.
4. **License Integrity:** Confirm all incoming code is compatible with the MIT license.
