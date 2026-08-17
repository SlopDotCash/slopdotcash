import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const validator = join(
  root,
  "scripts",
  "skill-validation",
  "quick_validate.py",
);
const packager = join(root, "scripts", "skill-validation", "package_skill.py");
const normalizer = join(root, "scripts", "normalize-skill-archive.py");
const temporaryRoots: string[] = [];

function temporarySkill(frontmatter: string): string {
  const skill = mkdtempSync(join(tmpdir(), "slop-skill-validation-"));
  temporaryRoots.push(skill);
  writeFileSync(join(skill, "SKILL.md"), `---\n${frontmatter}\n---\nBody\n`);
  return skill;
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

describe("skill validation utilities", () => {
  it("rejects empty required frontmatter values", () => {
    const skill = temporarySkill('name: ""\ndescription: ""');
    const result = spawnSync("python3", [validator, skill], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Name must not be empty");
  });

  it("refuses to package a symlinked file", () => {
    const skill = temporarySkill("name: safe-skill\ndescription: Safe skill");
    const outside = join(skill, "..", `slop-outside-${process.pid}.txt`);
    writeFileSync(outside, "must not be packaged\n");
    symlinkSync(outside, join(skill, "secret.txt"));
    temporaryRoots.push(outside);
    const output = mkdtempSync(join(tmpdir(), "slop-skill-output-"));
    temporaryRoots.push(output);
    const result = spawnSync("python3", [packager, skill, output], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("may not contain symlinks");
  });

  it("refuses a symlinked skill root", () => {
    const skill = temporarySkill("name: safe-skill\ndescription: Safe skill");
    const linkedSkill = `${skill}-link`;
    const output = mkdtempSync(join(tmpdir(), "slop-skill-output-"));
    symlinkSync(skill, linkedSkill);
    temporaryRoots.push(linkedSkill, output);

    const result = spawnSync("python3", [packager, linkedSkill, output], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("may not be a symlink");
  });

  it("atomically replaces an archive symlink without following it", () => {
    const skill = temporarySkill("name: safe-skill\ndescription: Safe skill");
    const output = mkdtempSync(join(tmpdir(), "slop-skill-output-"));
    const victim = join(output, "victim.txt");
    writeFileSync(victim, "do not overwrite\n");
    symlinkSync(victim, join(output, `${skill.split("/").at(-1)}.skill`));
    temporaryRoots.push(output);

    const result = spawnSync("python3", [packager, skill, output], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(readFileSync(victim, "utf8")).toBe("do not overwrite\n");
    expect(
      existsSync(join(root, "scripts", "skill-validation", "__pycache__")),
    ).toBe(false);
  });

  it("rejects extra command-line arguments", () => {
    const result = spawnSync("python3", [packager, "a", "b", "c"], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  it("refuses to normalize an archive through a symlink", () => {
    const output = mkdtempSync(join(tmpdir(), "slop-skill-normalize-"));
    const archive = join(output, "source.skill");
    const linkedArchive = join(output, "linked.skill");
    temporaryRoots.push(output);
    const created = spawnSync(
      "python3",
      [
        "-c",
        "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('safe/SKILL.md','safe'); z.close()",
        archive,
      ],
      { encoding: "utf8" },
    );
    expect(created.status).toBe(0);
    const before = readFileSync(archive);
    symlinkSync(archive, linkedArchive);

    const result = spawnSync("python3", [normalizer, linkedArchive], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "must not be a symlink",
    );
    expect(readFileSync(archive)).toEqual(before);
  });
});
