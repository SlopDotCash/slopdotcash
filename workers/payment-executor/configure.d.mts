export interface PaymentStackInput {
  stack?: "test" | "production";
  /** `staging` serves the staging site from slop-staging; test stacks only. */
  environment?: "isolated" | "staging";
  /** `keeper`: scheduled attester bindings and no dispatcher schedule. */
  topology?: "relayer" | "keeper";
  /** Staging EVM qualification only; production and other topologies refuse it. */
  singleNonceBindings?: boolean;
  scope?: "ordinary" | "security-bounty";
  network: string;
  databaseId?: string;
  databaseName?: string;
  /** Omitted for a staging stack, which pins its registry deployments. */
  deployments?: unknown;
  registry: unknown;
  registryDatabase: { database_name: string; database_id: string };
  /** The Pages `MONTHLY_PAYMENT_SCHEDULE` for the ordinary dispatcher. */
  monthlySchedule?: string;
}
export interface PaymentStackConfig {
  name: string;
  vars: Record<string, string>;
  services?: { binding: string; service: string }[];
  d1_databases: {
    binding: string;
    database_name: string;
    database_id: string;
    migrations_dir?: string;
  }[];
  triggers?: { crons: string[] };
}
export interface PaymentStack<Role extends string> {
  names: Record<Role, string>;
  configs: Record<Role, PaymentStackConfig>;
  secret: string;
}
/** A production stack has the identity attester only (PRD PAY-04, PAY-05). */
export declare function paymentStack(
  input: PaymentStackInput & { stack: "production" },
): PaymentStack<"attester">;
export declare function paymentStack(
  input: PaymentStackInput & { stack?: "test" },
): PaymentStack<"attester" | "relayer" | "dispatcher">;
