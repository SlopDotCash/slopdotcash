# Submission fee settings

A project owner may ask outside contributors for a refundable submission fee
before Slopbot reviews their pull requests (operator decision, 18 November
2026; PRD section 5, "Submission fee"). The setting is
`project.slopbot.submissionFee` of the project manifest, validated by the
registry (Slop development `8008b4617`, `src/lib/submission-fee-setting.mjs`,
`src/lib/submission-fee-setting.test.ts`, `src/lib/project-schema.mjs`,
`tests/e2e/submission-fee.spec.ts`, "the owner turns the submission fee on,
sets its amount and turns it off"). This library is the one model of the
setting: its shape, its bounds and what it means once stored. What Slopbot
does with it is the [submission fee gate](../slopbot/submissionFeeGate.md),
which reads the effective setting from here; the amounts and limits are the
published [terms](./submissionFeeTerms.md). `slopbot` is a presentation field
of the revision classifier, so the owner turns it on, changes the amount or
turns it off by an owner revision that publishes at once
([project registration](./projects.md), "Owner revisions publish at once
against the expected revision"); a change applies to pull requests first
asked after it.

## Story: Owners turn the submission fee on within fixed bounds

> As a project owner, I want to ask a refundable fee of an amount I choose
> within Slop's limits, and to turn it off again, without any stored value
> ever asking contributors for an amount I did not set.

### Submission fee settings are exact, bounded and off unless enabled with a valid amount

When present, `submissionFee` is exactly `{ enabled }` or
`{ enabled, amountMinor }` ("has unexpected or missing fields"); `enabled` is
a boolean ("must be a boolean") and `amountMinor` a base-unit decimal string
of the six-decimal stablecoin amount, `[1-9][0-9]{0,15}`, from 1,000,000 to
10,000,000 ("project.slopbot.submissionFee.amountMinor must be a base-unit
amount from 1000000 to 10000000"); the registry refuses an owner revision
otherwise. The shell parses the text and supplies `exactShape` (exactly
those keys, `enabled` a boolean), `amountWellFormed` (a string of that digit
pattern) and the amount; a digit string beyond the safe integer range is not
well formed. Absent means off. The effective setting is
on only while `enabled` is true and the amount, `amountMinor` or else the
default 2,000,000, is inside the limits; otherwise it is off, so a stored
amount outside the current range reads as off, never as another amount
(`submissionFeeSetting`). The settings form takes an amount of at most four
whole digits and two decimals, empty meaning the default, and says "Enter an
amount from 1 to 10, with at most two decimal places." otherwise
(`submissionFeeAmountDraft`).

```quint
import submissionFeeTerms as T from "./submissionFeeTerms"
type StoredFeeSetting = { present: bool, exactShape: bool, enabled: bool, amountGiven: bool, amountWellFormed: bool,
  amountMinor: int }
pure val feeSettingAbsent: StoredFeeSetting = { present: false, exactShape: true, enabled: false, amountGiven: false,
  amountWellFormed: false, amountMinor: 0 }
pure def amountUsable(feeSetting: StoredFeeSetting): bool =
  if (feeSetting.amountGiven) feeSetting.amountWellFormed and T::stableFeeInRange(feeSetting.amountMinor) else T::stableFeeInRange(T::defaultMinor)
pure def feeSettingValid(feeSetting: StoredFeeSetting): bool =
  not(feeSetting.present) or (feeSetting.exactShape and (feeSetting.amountGiven implies amountUsable(feeSetting)))
pure def feeSettingAmount(feeSetting: StoredFeeSetting): int =
  if (feeSetting.present and feeSetting.enabled and amountUsable(feeSetting))
    (if (feeSetting.amountGiven) feeSetting.amountMinor else T::defaultMinor)
  else 0
pure def feeSettingOn(feeSetting: StoredFeeSetting): bool = feeSettingAmount(feeSetting) > 0
pure def lawAbsentOrDisabledIsOff(feeSetting: StoredFeeSetting): bool =
  (not(feeSetting.present) or not(feeSetting.enabled)) implies not(feeSettingOn(feeSetting))
pure def lawStoredOutOfRangeReadsOff(feeSetting: StoredFeeSetting): bool =
  (feeSetting.amountGiven and not(feeSetting.amountWellFormed and T::stableFeeInRange(feeSetting.amountMinor))) implies not(feeSettingOn(feeSetting))
pure def lawOnAsksTheSetAmountOrTheDefault(feeSetting: StoredFeeSetting): bool =
  feeSettingOn(feeSetting) implies (T::stableFeeInRange(feeSettingAmount(feeSetting)) and
    feeSettingAmount(feeSetting) == (if (feeSetting.amountGiven) feeSetting.amountMinor else T::defaultMinor))
pure def lawValidEnabledSettingIsOn(feeSetting: StoredFeeSetting): bool =
  (feeSetting.present and feeSettingValid(feeSetting) and feeSetting.enabled) implies feeSettingOn(feeSetting)
pure val enabledDefault: StoredFeeSetting = { present: true, exactShape: true, enabled: true, amountGiven: false,
  amountWellFormed: false, amountMinor: 0 }
pure val feeSettingValues = Set(feeSettingAbsent, enabledDefault, { ...enabledDefault, enabled: false },
  { ...enabledDefault, amountGiven: true, amountWellFormed: true, amountMinor: 2500000 },
  { ...enabledDefault, amountGiven: true, amountWellFormed: true, amountMinor: 999999 },
  { ...enabledDefault, amountGiven: true, amountWellFormed: true, amountMinor: 10000001 },
  { ...enabledDefault, amountGiven: true, amountWellFormed: false, amountMinor: 2000000 },
  { ...enabledDefault, exactShape: false },
  { ...enabledDefault, enabled: false, amountGiven: true, amountWellFormed: true, amountMinor: 10000000 })
```
