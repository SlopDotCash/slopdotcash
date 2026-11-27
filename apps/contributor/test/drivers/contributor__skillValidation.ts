// spec/contributor/skillValidation.md, "A matching runtime and a clean inspection are both required"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, ManagedRuntime } from "effect";
import type { Driver, Options } from "../../gen/contributor__skillValidation.conformance.ts";
import type { Event, SkillValidation } from "../../gen/contributor__skillValidation.ts";
import { type Runtime, decideSkill, inspectSkill, probeRuntime, validatorPath } from "../../src/site/validation.vibe";

const runtime = ManagedRuntime.make(NodeServices.layer);
const root = mkdtempSync(join(tmpdir(), "skill-validation-conformance-"));
mkdirSync(dirname(join(root, validatorPath)), { recursive: true });
copyFileSync(new URL(`../../../../${validatorPath}`, import.meta.url), join(root, validatorPath));

const pinnedYaml = "import yaml,sys;sys.exit(0 if yaml.__version__ == '6.0.3' else 1)";
const pinnedUv: Runtime = { executable: "uv", prefix: ["run", "--with", "PyYAML==6.0.3", "python"], probe: ["--version"] };
const configuredPython = process.env.SLOP_PYTHON;
const matchingRuntime: Runtime = configuredPython !== undefined && configuredPython !== ""
  ? { executable: configuredPython, prefix: [], probe: ["-c", pinnedYaml] }
  : pinnedUv;
const absent: Runtime = { executable: join(root, "no-python-here"), prefix: [], probe: ["--version"] };

const header = "---\nname: conformance-skill\ndescription: A skill the conformance driver packages.\n---\n\n# Conformance skill\n";
const brokenHeader = "---\nname: [conformance-skill\ndescription: An unclosed flow sequence.\n---\n";

interface Run {
  state: SkillValidation;
  chosen: Runtime;
}

const unchecked: SkillValidation = { tried: 0, runtime: false, realDirectory: false, bounded: false, yaml: false, inspected: false, outcome: "Unchecked" };
let generation = 0;
let made = 0;
const runs = new Map<string, Run>();

function runOf(key: string): Run {
  const known = runs.get(key);
  if (known !== undefined) return known;
  const run = { state: unchecked, chosen: absent };
  runs.set(key, run);
  return run;
}

function skillDirectory(key: string, event: Extract<Event, { type: "inspect" }>): string {
  const real = join("skills", `${key}-${generation}-${++made}`);
  mkdirSync(join(root, real), { recursive: true });
  const text = event.yaml ? header : brokenHeader;
  writeFileSync(join(root, real, "SKILL.md"), event.bounded ? text : text + "x".repeat(1024 * 1024));
  if (event.realDirectory) return real;
  const link = `${real}-link`;
  symlinkSync(join(root, real), join(root, link), "dir");
  return link;
}

function sent(run: Run, key: string, event: Event) {
  switch (event.type) {
    case "probeRuntime": {
      const tried = event.matches ? matchingRuntime : absent;
      return probeRuntime(run.state, tried, root).pipe(Effect.map((next) => {
        if (next.runtime && !run.state.runtime) run.chosen = tried;
        return next;
      }));
    }
    case "inspect":
      return inspectSkill(run.state, run.chosen, root, skillDirectory(key, event));
    case "decide":
      return decideSkill(run.state);
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    generation++;
    runs.clear();
  },
  dispatch: (key, event: Event) => {
    const run = runOf(key);
    return runtime.runPromise(sent(run, key, event).pipe(
      Effect.map((state) => {
        run.state = state;
        return "accepted" as const;
      }),
      Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), SiteRefused: () => Effect.succeed("refused" as const) }),
    ));
  },
  observe: (key) => runOf(key).state,
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    rmSync(root, { recursive: true, force: true });
  },
};

export const options: Options = {
  view: (state) => ({ ...state, yaml: state.yaml && state.realDirectory && state.bounded }),
  keys: ["first", "second"],
  walks: 10,
  steps: 8,
};
