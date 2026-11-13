import type { EventEmitter } from "node:events";

interface EvidenceTlsSocket extends EventEmitter {
  authorized: boolean;
  authorizationError?: unknown;
  getProtocol(): string | null;
  getCipher(): { name: string };
  getPeerCertificate(): {
    issuer?: unknown;
    subject?: unknown;
    subjectaltname?: string;
    valid_from?: string;
    valid_to?: string;
  };
  end(): unknown;
  destroy(): unknown;
}
export function probeProductionTls(
  connectTls: (options: {
    host: string;
    port: number;
    rejectUnauthorized: boolean;
    servername: string;
  }) => EvidenceTlsSocket,
  timeoutMs?: number,
): Promise<{
  protocol: string;
  authorized: true;
  cipher: string;
  issuer: unknown;
  subject: unknown;
  subjectAltName: unknown;
  validFrom: unknown;
  validTo: unknown;
}>;
export function withEvidenceResponse<T>(
  response: Response,
  operation: () => T | Promise<T>,
): Promise<T>;
export function readEvidenceResponseBytes(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Buffer>;
export function verifyRemoteArtifacts(options: {
  artifacts: { path: string; contents: Buffer }[];
  cacheKey: string;
  fetchImpl?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
}): Promise<{ path: string; bytes: number; sha256: string }[]>;
