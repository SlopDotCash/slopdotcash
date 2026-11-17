// spec/operations/release.md, "Served bytes are verified against the deployment's own source"
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { connect } from "node:tls";

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

export interface TlsObservation {
  readonly authorized: boolean;
  readonly authorizationError: string | undefined;
  readonly protocol: string | undefined;
  readonly cipher: string | undefined;
  readonly issuer: string | undefined;
  readonly subject: string | undefined;
  readonly subjectAltName: string | undefined;
  readonly validFrom: string | undefined;
  readonly validTo: string | undefined;
}

/** @throws {never} */
export function ipFamily(address: string): number {
  return isIP(address);
}

export function resolvedAddresses(hostname: string): Promise<ReadonlyArray<ResolvedAddress>> {
  return lookup(hostname, { all: true, verbatim: true });
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function observedTls(hostname: string, signal: AbortSignal): Promise<TlsObservation> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = connect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: true });
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abandon);
      socket.destroy();
      outcome();
    };
    const abandon = () => finish(() => reject(new Error("the TLS observation exceeded its deadline")));
    signal.addEventListener("abort", abandon, { once: true });
    socket.on("error", (error) => finish(() => reject(error)));
    socket.once("close", () => finish(() => reject(new Error("the TLS connection closed before a verified handshake"))));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      const observation: TlsObservation = {
        authorized: socket.authorized,
        authorizationError: socket.authorizationError === undefined ? undefined : String(socket.authorizationError),
        protocol: socket.getProtocol() ?? undefined,
        cipher: text(socket.getCipher()?.name),
        issuer: text(certificate.issuer?.CN),
        subject: text(certificate.subject?.CN),
        subjectAltName: text(certificate.subjectaltname),
        validFrom: text(certificate.valid_from),
        validTo: text(certificate.valid_to),
      };
      finish(() => resolve(observation));
    });
    if (signal.aborted) abandon();
  });
}
