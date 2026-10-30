import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";

/** Existing local data stays in place; new checkouts keep it outside Vite's root. */
export function devDataDirectory(root: string, override?: string) {
  if (override) {
    const path = resolve(root, override);
    const repo = resolve(root);
    const legacy = resolve(root, ".slop-dev");
    if (
      path === repo ||
      repo.startsWith(`${path}${sep}`) ||
      (path.startsWith(`${repo}${sep}`) &&
        path !== legacy &&
        !path.startsWith(`${legacy}${sep}`))
    )
      throw new Error(
        "SLOP_DEV_DATA_DIR must be a dedicated private directory outside the repository or under .slop-dev",
      );
    return path;
  }
  const legacy = resolve(root, ".slop-dev");
  if (existsSync(resolve(legacy, "slop.sqlite"))) return legacy;
  const id = createHash("sha256")
    .update(resolve(root))
    .digest("hex")
    .slice(0, 16);
  return resolve(homedir(), ".local/share/slop-dev", id);
}

/** Block direct, encoded and /@fs requests before Vite can serve private data. */
export function privateDevRequest(
  path: string,
  root: string,
  directory: string,
) {
  let decoded: string;
  try {
    decoded = new URL(path, "http://localhost").pathname;
    for (let n = 0; n < 3; n++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return true;
  }
  decoded = decoded.replaceAll("\\", "/");
  if (
    /(?:^|\/)(?:\.slop-dev|\.wrangler|\.git|\.dev\.vars[^/]*|\.env[^/]*)(?:\/|$)/iu.test(
      decoded,
    )
  )
    return true;
  const fsPath = decoded.slice("/@fs/".length);
  const file = decoded.startsWith("/@fs/")
    ? resolve(/^[A-Za-z]:\//u.test(fsPath) ? fsPath : `/${fsPath}`)
    : resolve(root, `.${decoded}`);
  const physical = (path: string) => {
    try {
      return realpathSync.native(path);
    } catch {
      return resolve(path);
    }
  };
  const candidates = [file, physical(file)];
  const privateRoots = [directory, resolve(root, ".slop-dev")].flatMap(
    (path) => [resolve(path), physical(path)],
  );
  return candidates.some((candidate) => {
    if (
      /(?:^|[\\/])(?:\.slop-dev|\.wrangler|\.git|\.dev\.vars[^\\/]*|\.env[^\\/]*)(?:[\\/]|$)/iu.test(
        candidate,
      )
    )
      return true;
    return privateRoots.some((privateRoot) => {
      const base = privateRoot.toLowerCase(),
        value = candidate.toLowerCase();
      return value === base || value.startsWith(`${base}${sep}`);
    });
  });
}
