// spec/settlement/keeperLifecycle.md, "Native fee liability and nonce become durable with the exact signed bytes"

/** @throws {never} */
export function processVariable(name: "KEEPER_EVM_PRIVATE_KEY"): string | undefined {
  return process.env[name];
}
