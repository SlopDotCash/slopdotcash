import { expect, test } from "bun:test";
import { fixture, policy, repository } from "../../tests/value-binary-fixture";
import { collectValueEvidence } from "./value-evidence";
import { prepareWorkUnitEvidence } from "./value-work-unit";
import { verifyCurrentWorkUnitSource } from "./value-work-unit-publication";

for (const change of ["none", "comment", "policy"] as const) {
  test(`canonical source reuse ${change === "none" ? "keeps identical source" : `refuses changed ${change}`}`, async () => {
    const f = fixture({ direct: true, textOnly: true });
    f.pull.comments = 1;
    const comment = {
      node_id: "IC_test",
      html_url: `${f.pull.html_url}#issuecomment-1`,
      body: "Original review context",
      user: { node_id: "U_comment", login: "reader", type: "User" },
      created_at: "2026-10-15T17:00:00Z",
      updated_at: "2026-10-15T17:00:00Z",
    };
    const client = {
      ...f.client,
      async get<T>(path: string): Promise<T | null> {
        return path.includes("/issues/1/comments?")
          ? ([structuredClone(comment)] as T)
          : f.client.get<T>(path);
      },
    };
    const evidence = await collectValueEvidence(
      client,
      repository.id,
      1,
      repository,
    );
    const group = await prepareWorkUnitEvidence(
      [{ evidence, policy }],
      [repository],
    );
    const current = {
      ...client,
      async get<T>(path: string): Promise<T | null> {
        const result = await client.get<T>(path);
        if (change === "comment" && path.includes("/issues/1/comments?"))
          (result as { body: string }[])[0].body = "Edited review context";
        return result;
      },
      async fileText(owner: string, repo: string, path: string, _ref: string) {
        const file = await f.client.fileText(owner, repo, path);
        return file && change === "policy"
          ? { ...file, text: "Different pinned policy bytes" }
          : file;
      },
    };
    if (change === "none") {
      const verified = await verifyCurrentWorkUnitSource(
        current,
        group,
        { sourceDigest: group.sourceDigest },
        [repository],
      );
      expect(verified.sourceDigest).toBe(group.sourceDigest);
      expect(verified.sources[0].evidence).toBe(evidence);
    } else
      await expect(
        verifyCurrentWorkUnitSource(
          current,
          group,
          { sourceDigest: group.sourceDigest },
          [repository],
        ),
      ).rejects.toThrow();
  });
}
