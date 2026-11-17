//@ backend dafny
// spec/security/program.md, "A program revision needs current owner authority and exact split rules"; spec/security/program.md, "Funding state comes only from a fresh finalized bounty-vault snapshot"

export interface OwnerChange {
  hadProgram: boolean;
  hasProgram: boolean;
  splitChanged: boolean;
  splitApprover: boolean;
  canManageContacts: boolean;
  contactsChanged: boolean;
  namesOthers: boolean;
  settlementChanged: boolean;
  boundVault: boolean;
  namesSettlement: boolean;
  assetChanged: boolean;
  opening: boolean;
  afterApproval: boolean;
  fundsAvailable: boolean;
}

export type OwnerVerdict = "Allowed" | "ProgramRequired" | "SplitRestricted" | "ContactsChanged" | "ContactsNamed" | "VaultRestricted" | "AssetRestricted" | "FundingUnavailable";

/** @throws {never} */
export function ownerVerdict(c: OwnerChange): OwnerVerdict {
  //@ ensures !c.hasProgram ==> (\result === "Allowed" <==> !c.hadProgram)
  //@ ensures !c.hasProgram && c.hadProgram ==> \result === "ProgramRequired"
  //@ ensures \result === "Allowed" && c.hasProgram ==> c.splitApprover || !c.splitChanged
  //@ ensures \result === "Allowed" && c.hasProgram && !c.canManageContacts && c.hadProgram ==> !c.contactsChanged
  //@ ensures \result === "Allowed" && c.hasProgram && !c.canManageContacts && !c.hadProgram ==> !c.namesOthers
  //@ ensures \result === "Allowed" && c.hasProgram && c.settlementChanged ==> !c.boundVault && !c.namesSettlement
  //@ ensures \result === "Allowed" && c.hasProgram && c.boundVault && c.hadProgram ==> !c.assetChanged
  //@ ensures \result === "Allowed" && c.hasProgram && c.opening && !c.afterApproval ==> c.fundsAvailable
  if (!c.hasProgram) return c.hadProgram ? "ProgramRequired" : "Allowed";
  if (!c.splitApprover && c.splitChanged) return "SplitRestricted";
  if (!c.canManageContacts && c.hadProgram && c.contactsChanged) return "ContactsChanged";
  if (!c.canManageContacts && !c.hadProgram && c.namesOthers) return "ContactsNamed";
  if (c.settlementChanged && (c.boundVault || c.namesSettlement)) return "VaultRestricted";
  if (c.boundVault && c.hadProgram && c.assetChanged) return "AssetRestricted";
  if (c.opening && !c.afterApproval && !c.fundsAvailable) return "FundingUnavailable";
  return "Allowed";
}
