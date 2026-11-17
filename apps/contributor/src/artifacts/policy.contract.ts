// spec/contributor/artifactTransport.md, "Each request carries a credential only at the GitHub authority"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { trustedArtifacts, trustedDownloadHosts, trustedDownloadUrl } from "./policy.ts";

const hosts = ["github.com", "user-images.githubusercontent.com", "objects.githubusercontent.com", "evil.example", "github.com.evil.example", "api.github.com"] as const;

const bodies = Arbitrary.schema(
  Schema.Struct({ host: Schema.Literals(hosts), path: Schema.String, image: Schema.Boolean, scheme: Schema.Literals(["https", "http"]), prose: Schema.String }),
).pipe(
  Arbitrary.map(({ host, path, image, scheme, prose }) => `${prose}\n${image ? "!" : ""}[evidence](${scheme}://${host}/${path.replace(/[\s)]/gu, "")})\n${prose}`),
);

const locations = Arbitrary.schema(Schema.Struct({ host: Schema.Literals(hosts), path: Schema.String, port: Schema.Boolean })).pipe(
  Arbitrary.map(({ host, path, port }) => `https://${host}${port ? ":8443" : ""}/${encodeURIComponent(path.toWellFormed())}`),
);

export const onlyGitHubUploadsAreTrusted = contract({
  input: bodies,
  run: (body: string) => trustedArtifacts(body, ["acme/widget"]),
  deterministic: true,
  invariant: (_, artifacts) =>
    artifacts.every((artifact) => {
      const url = new URL(artifact.url);
      return url.protocol === "https:" && (url.hostname === "github.com" || url.hostname === "user-images.githubusercontent.com") && artifact.extension !== ".zip";
    }),
});

export const redirectsStayOnApprovedHosts = contract({
  input: locations,
  run: (location: string) => trustedDownloadUrl(location)?.href ?? null,
  invariant: (_, href) => href === null || (trustedDownloadHosts.has(new URL(href).hostname) && new URL(href).port === ""),
});
