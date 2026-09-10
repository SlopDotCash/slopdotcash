/** Writes an unsigned external handoff to stdout. Never signs or broadcasts. */
import { prepareSquadsBatchHandoff } from "../src/lib/squads-batch-handoff";
import { readBoundedExecutionFile } from "./verify-squads-execution";

export function parseBatchHandoffArguments(argv: string[]) {
  const names = [
    "allocation",
    "plan",
    "multisig",
    "vault-index",
    "transaction-index",
    "member",
  ];
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].slice(2),
      value = argv[i + 1];
    if (
      !argv[i].startsWith("--") ||
      !names.includes(name) ||
      Object.hasOwn(args, name) ||
      !value ||
      value.startsWith("--")
    )
      throw new TypeError("Invalid Batch handoff arguments");
    args[name] = value;
  }
  if (
    names.some((name) => !args[name]) ||
    !/^(0|[1-9][0-9]{0,2})$/u.test(args["vault-index"])
  )
    throw new TypeError(
      "Require --allocation --plan --multisig --vault-index --transaction-index --member (public key)",
    );
  return args;
}
if (import.meta.main) {
  try {
    const args = parseBatchHandoffArguments(process.argv.slice(2));
    const [allocationBytes, planBytes] = await Promise.all([
      readBoundedExecutionFile(args.allocation),
      readBoundedExecutionFile(args.plan),
    ]);
    const handoff = await prepareSquadsBatchHandoff({
      allocationBytes,
      planBytes,
      multisig: args.multisig,
      vaultIndex: Number(args["vault-index"]),
      transactionIndex: args["transaction-index"],
      member: args.member,
    });
    process.stdout.write(`${JSON.stringify(handoff, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `Batch handoff refused: ${error instanceof Error ? error.message : "invalid input"}\n`,
    );
    process.exitCode = 1;
  }
}
