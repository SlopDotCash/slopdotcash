import type {
  KeeperConfiguration,
  KeeperResult,
} from "../scripts/payment-keeper/keeper";

interface CloudflareKeeperRuntime {
  configure(
    config: KeeperConfiguration,
    mode: string | undefined,
    now: Date,
    failAfterSign?: boolean,
  ): Promise<void>;
  tick(
    config: KeeperConfiguration,
    execute: boolean,
    now: Date,
    options?: { concurrent?: false; failAfterSign?: boolean },
  ): Promise<KeeperResult[]>;
  tick(
    config: KeeperConfiguration,
    execute: boolean,
    now: Date,
    options: { concurrent: true; failAfterSign?: boolean },
  ): Promise<KeeperResult[][]>;
  query<T>(sql: string, ...values: (string | number | null)[]): Promise<T[]>;
  request(path: string, body?: unknown): Promise<Record<string, unknown>>;
  restart(): Promise<void>;
  crashAndRestart(): Promise<{ previousPid: number; currentPid: number }>;
  close(): Promise<void>;
}
export function cloudflareKeeperRuntime(
  directory: string,
  privateKey: string,
  observer: string,
): Promise<CloudflareKeeperRuntime>;
