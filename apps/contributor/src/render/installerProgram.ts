// spec/contributor/installation.md, "Installation tracks verification, activation, and readback separately"; spec/contributor/skillAuthority.md, "Only the exact GitHub API authority receives the optional credential"; spec/contributor/skillAuthority.md, "Retry transient transport failures up to three attempts"
import { templatePaths } from "./fields.ts";

export type InstallerAuthority =
  | { readonly kind: "production" }
  | {
      readonly kind: "test";
      readonly apiOrigin: string;
      readonly rawOrigin: string;
      readonly registryOrigin?: string;
      readonly requestTimeoutSeconds?: number;
    };

export interface InstallCommandInput {
  readonly artifactOrigin: string;
  readonly skillsRoot: string;
  readonly skillName: string;
  readonly skillRepositoryPath: string;
  readonly authority: InstallerAuthority;
}

export type InstallerText = { readonly kind: "text"; readonly text: string } | { readonly kind: "refused"; readonly message: string };

interface Origins {
  readonly apiOrigin: string;
  readonly rawOrigin: string;
  readonly registryOrigin: string;
}

type Checked<T> = { readonly kind: "valid"; readonly value: T } | { readonly kind: "refused"; readonly message: string };

export const productionAuthority = { kind: "production" } as const satisfies InstallerAuthority;

const productionApiOrigin = "https://api.github.com";
const productionRawOrigin = "https://raw.githubusercontent.com";
const defaultRequestTimeoutSeconds = 60;
const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const skillRepositoryPathPattern = /^skills\/[a-z0-9][a-z0-9-]{0,63}$/u;
const contributorSkillPattern = /^contribute-to-[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const reviewerSkillPattern = /^review-[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?-contributions$/u;
const invalidUrl = "Invalid URL";

const skillAuthorityPython = `
import ssl

repository = "SlopDotCash/slopdotcash"
github_repository = "SlopDotCash/slopdotcash"
provenance_name = "PROVENANCE.json"
max_source_files = 32
max_source_directories = 32
max_entry_bytes = 1_048_576
max_total_bytes = 4_194_304
max_api_bytes = 2_097_152
download_attempts = 3
retry_backoff_seconds = (2.0, 4.0)
sha_pattern = re.compile(r"[0-9a-f]{40}")
digest_pattern = re.compile(r"[0-9a-f]{64}")
api_fixture = None

def configured_github_token():
    # Optional. Moves GitHub API verification from the anonymous core budget,
    # which every process behind one public IP shares, to the caller's own
    # authenticated budget. The token is sent only to the GitHub API authority,
    # never to raw or artifact origins, and is never written to disk.
    for name in ("GH_TOKEN", "GITHUB_TOKEN"):
        value = os.environ.get(name)
        if value is None:
            continue
        value = value.strip()
        if not value:
            continue
        if not re.fullmatch(r"[\\x21-\\x7e]+", value):
            raise ValueError(f"{name} contains characters that cannot be sent in an Authorization header")
        return value
    return None


github_token = configured_github_token()


def require_sha(value, context):
    if not isinstance(value, str) or not sha_pattern.fullmatch(value):
        raise ValueError(f"{context} is not a full lowercase commit SHA")
    return value


def canonical_relative_path(value, context):
    if not isinstance(value, str) or not value:
        raise ValueError(f"{context} is not a path")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError(f"{context} contains a control character")
    if len(value.encode("utf-8")) > 1024 or "\\\\" in value:
        raise ValueError(f"{context} is unsafe")
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or path.as_posix() != value
        or any(part in ("", ".", "..") for part in path.parts)
        or any(len(part.encode("utf-8")) > 255 for part in path.parts)
        or unicodedata.normalize("NFC", value) != value
    ):
        raise ValueError(f"{context} is not canonical")
    return value


def origin_identity(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme == "file":
        return (parsed.scheme, os.path.realpath(urllib.request.url2pathname(parsed.path)))
    return (parsed.scheme, parsed.hostname, parsed.port)


class RetryableDownloadError(Exception):
    """A transient transport failure eligible for one bounded retry cycle."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


class AuthorityRedirectHandler(urllib.request.HTTPRedirectHandler):
    # urllib forwards every request header, including Authorization, to a
    # redirect target on any host. Refuse to leave the issuing origin before
    # the redirected request is built, so no header can cross authorities.
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if origin_identity(newurl) != origin_identity(request.full_url):
            raise ValueError("authenticated request redirected to another authority")
        return super().redirect_request(request, fp, code, msg, headers, newurl)


opener = urllib.request.build_opener(AuthorityRedirectHandler)


def rate_limit_detail(error, authenticated):
    if error.code not in (403, 429):
        return None
    remaining = error.headers.get("X-RateLimit-Remaining")
    retry_after = error.headers.get("Retry-After")
    if remaining != "0" and retry_after is None:
        return None
    token_sent = authenticated and github_token is not None
    budget = "authenticated" if token_sent else "anonymous"
    limit = error.headers.get("X-RateLimit-Limit")
    if limit is not None and re.fullmatch(r"[0-9]+", limit):
        parts = [f"GitHub API rate limit exhausted ({budget} budget, {limit} requests per hour)"]
    else:
        parts = [f"GitHub API rate limit exhausted ({budget} budget)"]
    if not token_sent:
        parts.append("the anonymous budget is shared by every process behind this public IP")
    reset = error.headers.get("X-RateLimit-Reset")
    if reset is not None and re.fullmatch(r"[0-9]+", reset):
        reset_at = int(reset)
        reset_text = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(reset_at))
        wait_minutes = max(0, math.ceil((reset_at - time.time()) / 60))
        parts.append(f"resets at {reset_text} (about {wait_minutes} min)")
    elif retry_after is not None:
        parts.append(f"retry after {retry_after}s")
    if not token_sent:
        parts.append("set GH_TOKEN or GITHUB_TOKEN to verify with your own authenticated budget")
    return "; ".join(parts)


def fetch_bytes_once(url, limit, expected_origin, authenticated=False):
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "slop-skill-installer/1",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if authenticated and github_token is not None:
        headers["Authorization"] = f"Bearer {github_token}"
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with opener.open(request, timeout=request_timeout_seconds) as response:
            final_url = response.geturl()
            expected = urllib.parse.urlsplit(expected_origin)
            final = urllib.parse.urlsplit(final_url)
            if expected.scheme == "file":
                expected_root = os.path.realpath(urllib.request.url2pathname(expected.path))
                final_path = os.path.realpath(urllib.request.url2pathname(final.path))
                if os.path.commonpath((expected_root, final_path)) != expected_root:
                    raise ValueError("file authority escaped its injected fixture root")
            elif origin_identity(final_url) != origin_identity(expected_origin):
                raise ValueError("authenticated request redirected to another authority")
            content_length = response.headers.get("Content-Length")
            if content_length is not None:
                try:
                    declared_length = int(content_length)
                except ValueError as error:
                    raise ValueError("remote response has an invalid Content-Length") from error
                if declared_length < 0 or declared_length > limit:
                    raise ValueError("remote response exceeds its declared size limit")
            contents = response.read(limit + 1)
    except urllib.error.HTTPError as error:
        if error.code >= 500:
            raise RetryableDownloadError(f"HTTP {error.code}") from error
        detail = rate_limit_detail(error, authenticated)
        if detail is not None:
            raise ValueError(
                f"authenticated download failed: HTTP {error.code}: {url}: {detail}"
            ) from error
        raise ValueError(f"authenticated download failed: HTTP {error.code}: {url}") from error
    except (TimeoutError, socket.timeout) as error:
        raise RetryableDownloadError(
            f"timed out after {request_timeout_seconds}s"
        ) from error
    except (ConnectionResetError, ssl.SSLEOFError) as error:
        # RemoteDisconnected also derives from ConnectionResetError when the
        # server closes the connection before sending response headers.
        # Abrupt TLS EOF is retryable; certificate errors are not SSLEOFError.
        raise RetryableDownloadError(type(error).__name__) from error
    except urllib.error.URLError as error:
        if isinstance(error.reason, (TimeoutError, socket.timeout)):
            raise RetryableDownloadError(
                f"timed out after {request_timeout_seconds}s"
            ) from error
        if isinstance(error.reason, (ConnectionResetError, ssl.SSLEOFError)):
            raise RetryableDownloadError(type(error.reason).__name__) from error
        raise ValueError(
            f"authenticated download failed ({type(error.reason).__name__}): {url}"
        ) from error
    except OSError as error:
        raise ValueError(
            f"authenticated download failed ({type(error).__name__}): {url}"
        ) from error
    if len(contents) > limit:
        raise ValueError("remote response exceeds its actual size limit")
    return contents


def fetch_bytes(url, limit, expected_origin, authenticated=False):
    # Integrity, authority, and size violations above raise ValueError and are
    # never retried; only timeouts, resets, TLS EOF and HTTP 5xx repeat, bounded.
    last_reason = None
    for attempt in range(1, download_attempts + 1):
        try:
            return fetch_bytes_once(url, limit, expected_origin, authenticated)
        except RetryableDownloadError as error:
            last_reason = error.reason
            if attempt < download_attempts:
                time.sleep(retry_backoff_seconds[attempt - 1])
    raise ValueError(
        f"authenticated download failed after {download_attempts} attempts ({last_reason}): {url}"
    )


def decode_json(contents, context):
    try:
        return json.loads(contents.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{context} is not valid UTF-8 JSON") from error


def api_json(path, query=()):
    global api_fixture
    query_string = urllib.parse.urlencode(query)
    key = path if not query_string else f"{path}?{query_string}"
    parsed_origin = urllib.parse.urlsplit(api_origin)
    if parsed_origin.scheme == "file":
        if api_fixture is None:
            fixture_url = f"{api_origin}/responses.json"
            api_fixture = decode_json(
                fetch_bytes(fixture_url, max_api_bytes, api_origin),
                "injected GitHub API fixture",
            )
            if not isinstance(api_fixture, dict):
                raise ValueError("injected GitHub API fixture must be an object")
        if key not in api_fixture:
            raise ValueError(f"injected GitHub API fixture omitted {key}")
        return api_fixture[key]
    url = f"{api_origin}{path}"
    if query_string:
        url = f"{url}?{query_string}"
    return decode_json(
        fetch_bytes(url, max_api_bytes, api_origin, authenticated=True),
        f"GitHub API response for {path}",
    )


def git_blob_digest(contents):
    header = f"blob {len(contents)}\\0".encode("ascii")
    return hashlib.sha1(header + contents).hexdigest()


def list_remote_skill_files(revision):
    require_sha(revision, "source revision")
    files = {}
    seen_logical_paths = set()
    pending = [skill_repository_path]
    seen_directories = {skill_repository_path}
    while pending:
        directory = pending.pop()
        response = api_json(
            f"/repos/{github_repository}/contents/{urllib.parse.quote(directory, safe='/')}",
            (("ref", revision),),
        )
        if not isinstance(response, list) or len(response) > 1000:
            raise ValueError("GitHub Contents directory response is invalid or unbounded")
        for entry in response:
            if not isinstance(entry, dict):
                raise ValueError("GitHub Contents entry must be an object")
            name = canonical_relative_path(entry.get("name"), "GitHub Contents entry name")
            if "/" in name:
                raise ValueError("GitHub Contents entry name contains a path separator")
            expected_path = f"{directory}/{name}"
            if entry.get("path") != expected_path:
                raise ValueError("GitHub Contents entry escaped its requested directory")
            logical_path = expected_path[len(skill_repository_path) + 1 :]
            canonical_relative_path(logical_path, "canonical skill path")
            collision_key = unicodedata.normalize("NFC", logical_path).casefold()
            if collision_key in seen_logical_paths:
                raise ValueError("GitHub Contents returned duplicate or colliding paths")
            seen_logical_paths.add(collision_key)
            entry_type = entry.get("type")
            if entry_type == "dir":
                if len(seen_directories) >= max_source_directories:
                    raise ValueError("canonical skill directory count exceeds its bound")
                seen_directories.add(expected_path)
                pending.append(expected_path)
                continue
            if (
                entry_type != "file"
                or entry.get("submodule_git_url") is not None
                or not isinstance(entry.get("size"), int)
                or isinstance(entry.get("size"), bool)
                or entry.get("size") < 0
                or entry.get("size") > max_entry_bytes
            ):
                raise ValueError("canonical skill contains a non-regular or oversized entry")
            if len(files) >= max_source_files:
                raise ValueError("canonical skill file count exceeds its bound")
            files[logical_path] = entry
    if not files or "SKILL.md" not in files or provenance_name in files:
        raise ValueError("canonical skill file list has an invalid identity")
    return dict(sorted(files.items()))


def remote_skill_bytes(revision):
    require_sha(revision, "source revision")
    commit = api_json(f"/repos/{github_repository}/git/commits/{revision}")
    if not isinstance(commit, dict) or commit.get("sha") != revision:
        raise ValueError("GitHub did not resolve the requested immutable commit")
    entries = list_remote_skill_files(revision)
    result = {}
    total = 0
    for path, entry in entries.items():
        raw_url = (
            f"{raw_origin}/{github_repository}/{revision}/"
            f"{urllib.parse.quote(f'{skill_repository_path}/{path}', safe='/')}"
        )
        contents = fetch_bytes(raw_url, max_entry_bytes, raw_origin)
        if len(contents) != entry["size"]:
            raise ValueError("raw GitHub file size disagrees with the Contents API")
        blob_sha = entry.get("sha")
        if not isinstance(blob_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", blob_sha):
            raise ValueError("GitHub Contents file omitted its blob identity")
        if git_blob_digest(contents) != blob_sha:
            raise ValueError("raw GitHub bytes disagree with the Contents API blob identity")
        total += len(contents)
        if total > max_total_bytes:
            raise ValueError("canonical skill bytes exceed their aggregate bound")
        result[path] = contents
    return result


# Generated project skills (PRD SKL-03/04): the trust root is the pair
# (canonical template commit, approved D1 revision digest). This renderer is
# the byte-for-byte mirror of src/lib/project-skill.mjs; change both together.
project_skill_templates = {
    "skills/project-contributor-template": "contributor",
    "skills/project-reviewer-template": "reviewer",
}
contribution_fields = (
    "approvedScope",
    "contributionGuide",
    "supportedTasks",
    "requiredTests",
    "reviewExpectations",
    "securityContact",
    "closurePolicy",
    "maintainerNotes",
)
project_id_pattern = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?")
repository_id_pattern = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
max_manifest_bytes = 1_048_576


def valid_integration_branch(value):
    if not isinstance(value, str):
        return False
    try:
        length = len(value.encode("utf-16-le")) // 2
    except UnicodeEncodeError:
        return False
    return (
        0 < length <= 255
        and value not in ("@", "HEAD")
        and not value.startswith("-")
        and not value.endswith(".")
        and ".." not in value
        and "@{" not in value
        and not any(character in "~^:?*[" or character == chr(92) for character in value)
        and all(ord(character) > 32 and ord(character) != 127 for character in value)
        and all(part and not part.startswith(".") and not part.endswith(".lock") for part in value.split("/"))
    )


def branch_code(value):
    tick = chr(96)
    runs = re.findall(tick + "+", value)
    if not runs:
        return tick + value + tick
    fence = tick * (max(map(len, runs)) + 1)
    return f"{fence} {value} {fence}"


def generated_skill_role():
    return project_skill_templates.get(skill_repository_path)


def generated_skill_name(role, project_id):
    if role == "contributor":
        return f"contribute-to-{project_id}"
    return f"review-{project_id}-contributions"


def require_registry_binding(binding, project_id):
    if (
        not isinstance(binding, dict)
        or set(binding) != {"projectId", "revision", "manifestSha256"}
        or binding.get("projectId") != project_id
        or not isinstance(binding.get("revision"), int)
        or isinstance(binding.get("revision"), bool)
        or not 0 < binding["revision"] < 1_000_000_000
        or not isinstance(binding.get("manifestSha256"), str)
        or not digest_pattern.fullmatch(binding["manifestSha256"])
    ):
        raise ValueError("generated skill registry binding is invalid")
    return binding


def registry_manifest(binding):
    url = (
        f"{registry_origin}/api/v1/project-revisions/"
        f"{binding['projectId']}/{binding['revision']}"
    )
    record = decode_json(
        fetch_bytes(url, 2 * max_manifest_bytes, registry_origin),
        "project registry revision",
    )
    if (
        not isinstance(record, dict)
        or set(record) != {"schemaVersion", "projectId", "revision", "manifestSha256", "manifestText"}
        or record.get("schemaVersion") != "1"
        or record.get("projectId") != binding["projectId"]
        or record.get("revision") != binding["revision"]
        or record.get("manifestSha256") != binding["manifestSha256"]
        or not isinstance(record.get("manifestText"), str)
    ):
        raise ValueError("project registry revision has the wrong identity")
    text = record["manifestText"].encode("utf-8")
    if len(text) > max_manifest_bytes:
        raise ValueError("project registry revision exceeds its size bound")
    if hashlib.sha256(text).hexdigest() != binding["manifestSha256"]:
        raise ValueError("project registry revision bytes disagree with their approved digest")
    manifest = decode_json(text, "project registry manifest")
    if not isinstance(manifest, dict) or manifest.get("id") != binding["projectId"]:
        raise ValueError("project registry manifest names another project")
    return manifest


def render_project_skill(role, template_files, manifest, binding):
    skill = manifest.get("skill" if role == "contributor" else "reviewSkill")
    repositories = manifest.get("repositories")
    contribution = manifest.get("contribution")
    repository_record = repositories[0] if isinstance(repositories, list) and repositories else None
    project_id = manifest.get("id")
    if (
        not isinstance(skill, dict)
        or skill.get("sourcePath") != skill_repository_path
        or not isinstance(project_id, str)
        or not project_id_pattern.fullmatch(project_id)
        or skill.get("id") != generated_skill_name(role, project_id)
        or not isinstance(repository_record, dict)
        or not isinstance(repository_record.get("id"), str)
        or not repository_id_pattern.fullmatch(repository_record["id"])
        or not valid_integration_branch(repository_record.get("integrationBranch"))
        or not isinstance(contribution, dict)
    ):
        raise ValueError("project registry manifest cannot render this skill")
    if "SKILL.md" not in template_files or "project.json" in template_files:
        raise ValueError("canonical skill template has an invalid identity")
    text = template_files["SKILL.md"].decode("utf-8")
    values = {
        "{{SLOP_SKILL_NAME}}": skill["id"],
        "{{SLOP_PROJECT_ID}}": project_id,
        "{{SLOP_REPOSITORY}}": repository_record["id"],
        "{{SLOP_INTEGRATION_BRANCH}}": repository_record["integrationBranch"],
    }
    checked = text
    for token in values:
        checked = checked.replace(token, "")
    if "{{SLOP_" in checked:
        raise ValueError("canonical skill template has an unknown placeholder")
    branch_token = chr(96) + "{{SLOP_INTEGRATION_BRANCH}}" + chr(96)
    pattern = re.escape(branch_token) + "|" + re.escape("{{SLOP_") + "[A-Z_]+" + re.escape("}}")
    text = re.sub(pattern, lambda match: branch_code(repository_record["integrationBranch"]) if match[0] == branch_token else values[match[0]], text)
    fields = {}
    for field in contribution_fields:
        value = contribution.get(field)
        if not isinstance(value, str):
            raise ValueError(f"project contribution field {field} is invalid")
        fields[field] = value
    project = {
        "schemaVersion": "1",
        "projectId": project_id,
        "repositoryId": repository_record["id"],
        "skillName": skill["id"],
        "skillSourcePath": skill_repository_path,
        "publicOrigin": f"https://slop.cash/projects/{project_id}",
        "policyAuthority": "https://slop.cash",
        "usageAdapters": {"codex": "codex", "claude-code": "claude", "grok-build": "grok"},
        "registry": {
            "revision": binding["revision"],
            "manifestSha256": binding["manifestSha256"],
        },
        "contribution": fields,
    }
    rendered = dict(template_files)
    rendered["SKILL.md"] = text.encode("utf-8")
    rendered["project.json"] = (
        json.dumps(project, indent=2, ensure_ascii=False) + "\\n"
    ).encode("utf-8")
    return dict(sorted(rendered.items()))


def require_project_open(project_id):
    # Contributors never install or work on a project that contributor flags,
    # a security finding or a moderator paused, or whose skills or repository
    # admission are unavailable. HTTP 410 means the project is restricted.
    url = f"{registry_origin}/api/v1/projects/{project_id}"
    try:
        record = decode_json(
            fetch_bytes(url, 2 * max_manifest_bytes, registry_origin),
            "project status",
        )
    except ValueError as error:
        if "HTTP 410" in str(error):
            raise ValueError(
                "Slop paused or restricted this project (contributor flags, a security finding or moderation); do not install or work on it"
            ) from error
        if "HTTP 404" in str(error):
            raise ValueError("this project is not listed on Slop; do not install or work on it") from error
        raise
    if isinstance(record, dict) and record.get("error") == "project_restricted":
        raise ValueError(
            "Slop paused or restricted this project (contributor flags, a security finding or moderation); do not install or work on it"
        )
    project = record.get("project") if isinstance(record, dict) else None
    if not isinstance(project, dict) or project.get("id") != project_id:
        raise ValueError("project status response has the wrong identity")
    if record.get("skillsPublished") is not True:
        raise ValueError(
            "this project's skills or repository admission are unavailable; do not install or work on it"
        )
    if project.get("status") != "active":
        raise ValueError("this project is paused; do not install or work on it")


def expected_skill_bytes(revision, binding):
    """Returns (expected installed files, canonical template files)."""
    template_files = remote_skill_bytes(revision)
    role = generated_skill_role()
    if role is None:
        if binding is not None:
            raise ValueError("a committed project skill cannot carry a registry binding")
        return template_files, template_files
    if binding is None:
        raise ValueError("a generated project skill needs its registry binding")
    if role == "contributor":
        require_project_open(binding["projectId"])
    manifest = registry_manifest(binding)
    return render_project_skill(role, template_files, manifest, binding), template_files


`;

function pythonRuntimeProbe(requiresHttpsTrust: boolean): string {
  return requiresHttpsTrust
    ? 'import os, re, ssl, sys; d = ssl.get_default_verify_paths().capath; raise SystemExit(0 if sys.version_info.major == 3 and (ssl.create_default_context().get_ca_certs() or (d and os.path.isdir(d) and any(re.fullmatch("[0-9a-f]{8}[.][0-9]+", n) for n in os.listdir(d)))) else 1)'
    : "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

const refused = (message: string) => ({ kind: "refused", message }) as const;

function artifactOriginOf(origin: string): Checked<string> {
  const parsed = URL.parse(origin);
  if (parsed === null) return refused(invalidUrl);
  if (!["https:", "http:", "file:"].includes(parsed.protocol)) return refused(`[Slop] unsupported artifact origin: ${origin}`);
  if (parsed.search || parsed.hash) return refused("[Slop] artifact origin cannot contain query or fragment data");
  return { kind: "valid", value: origin.replace(/\/$/u, "") };
}

function testOriginRefusal(name: string, origin: string): string | undefined {
  const parsed = URL.parse(origin);
  if (parsed === null) return invalidUrl;
  const isFile = parsed.protocol === "file:";
  const isLoopbackHttp = parsed.protocol === "http:" && parsed.hostname === "127.0.0.1";
  return (!isFile && !isLoopbackHttp) || parsed.search || parsed.hash
    ? `[Slop] test ${name} must be an unparameterized file:// or loopback http://127.0.0.1 origin`
    : undefined;
}

function originsOf(authority: InstallerAuthority, artifactOrigin: string): Checked<Origins> {
  const site = URL.parse(artifactOrigin);
  if (site === null) return refused(invalidUrl);
  const registryOrigin = site.protocol === "file:" ? "" : site.origin;
  if (authority.kind === "production")
    return { kind: "valid", value: { apiOrigin: productionApiOrigin, rawOrigin: productionRawOrigin, registryOrigin } };
  const problem =
    testOriginRefusal("apiOrigin", authority.apiOrigin) ??
    testOriginRefusal("rawOrigin", authority.rawOrigin) ??
    (authority.registryOrigin === undefined ? undefined : testOriginRefusal("registryOrigin", authority.registryOrigin));
  if (problem !== undefined) return refused(problem);
  return {
    kind: "valid",
    value: {
      apiOrigin: authority.apiOrigin.replace(/\/$/u, ""),
      rawOrigin: authority.rawOrigin.replace(/\/$/u, ""),
      registryOrigin: (authority.registryOrigin ?? registryOrigin).replace(/\/$/u, ""),
    },
  };
}

function requestTimeoutOf(authority: InstallerAuthority): Checked<number> {
  const override = authority.kind === "test" ? authority.requestTimeoutSeconds : undefined;
  if (override === undefined) return { kind: "valid", value: defaultRequestTimeoutSeconds };
  if (!Number.isFinite(override) || override < 0.1 || override > 300)
    return refused("[Slop] test requestTimeoutSeconds must be between 0.1 and 300 seconds");
  return { kind: "valid", value: override };
}

function skillPathMatches(skillName: string, skillRepositoryPath: string): boolean {
  if (!skillRepositoryPathPattern.test(skillRepositoryPath)) return false;
  if (skillRepositoryPath === templatePaths.contributor) return contributorSkillPattern.test(skillName);
  if (skillRepositoryPath === templatePaths.reviewer) return reviewerSkillPattern.test(skillName);
  return skillRepositoryPath === `skills/${skillName}`;
}

const installerPythonProgram = `import binascii
import ctypes
import hashlib
import io
import json
import math
import os
import base64
import re
import secrets
import shutil
import socket
import stat
import struct
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib
from pathlib import Path, PurePosixPath

artifact_origin, api_origin, raw_origin, skills_root, operation, rollback_revision, skill_name, skill_repository_path, request_timeout_argument, registry_origin = sys.argv[1:]
legacy_repository = "elizaOS/slopdotcash"
source_path = f"{skill_repository_path}/SKILL.md"
target_path = os.path.join(skills_root, skill_name)
versions_name = f".{skill_name}-versions"
versions_root = os.path.join(skills_root, versions_name)
lock_path = os.path.join(skills_root, f".{skill_name}.lock")
authorization_receipt_name = ".slop-authorization.json"
skill_prefix = f"{skill_name}/"
max_archive_bytes = 10_485_760
max_archive_entries = 33
activation_revision = None
activation_verified = False
try:
    request_timeout_seconds = float(request_timeout_argument)
except ValueError as error:
    raise ValueError("request timeout argument is not a number") from error
if not math.isfinite(request_timeout_seconds) or request_timeout_seconds <= 0:
    raise ValueError("request timeout argument must be a positive finite number")
local_header = struct.Struct("<IHHHHHIIIHH")
local_signature = 0x04034B50


${skillAuthorityPython}

version_key_pattern = re.compile(r"[0-9a-f]{40}(?:-r[1-9][0-9]{0,8})?")


def expected_project_id():
    role = generated_skill_role()
    if role == "contributor":
        return skill_name[len("contribute-to-"):]
    if role == "reviewer":
        return skill_name[len("review-"):-len("-contributions")]
    return None


def version_key(revision, binding):
    # A generated skill's bytes depend on the template revision and the
    # approved registry revision, so both name its immutable version.
    return revision if binding is None else f"{revision}-r{binding['revision']}"


def require_version_key(value, context):
    if not isinstance(value, str) or not version_key_pattern.fullmatch(value):
        raise ValueError(f"{context} is not a skill version")
    return value


def provenance_binding(provenance):
    if generated_skill_role() is None:
        if isinstance(provenance, dict) and "registry" in provenance:
            raise ValueError("a committed project skill cannot carry a registry binding")
        return None
    binding = provenance.get("registry") if isinstance(provenance, dict) else None
    return require_registry_binding(binding, expected_project_id())


def validate_provenance(
    provenance, revision, canonical_files, expected_repository=repository, binding=None
):
    expected_keys = {
        "schemaVersion", "name", "repository", "revision", "revisionStatus", "source", "files"
    }
    if binding is not None:
        expected_keys.add("registry")
    if not isinstance(provenance, dict) or set(provenance) != expected_keys:
        raise ValueError("skill provenance has an invalid schema")
    if binding is not None and provenance.get("registry") != binding:
        raise ValueError("skill provenance names another registry revision")
    if (
        provenance.get("schemaVersion") != "1"
        or provenance.get("name") != skill_name
        or provenance.get("repository") != expected_repository
        or provenance.get("revisionStatus") != "committed"
        or provenance.get("revision") != revision
    ):
        raise ValueError("skill provenance is not an exact committed repository revision")
    source = provenance.get("source")
    if not isinstance(source, dict) or set(source) != {"path", "sha256"}:
        raise ValueError("skill provenance source has an invalid schema")
    if source.get("path") != source_path:
        raise ValueError("skill provenance source path has the wrong identity")
    records = provenance.get("files")
    if not isinstance(records, list) or not 0 < len(records) <= max_source_files:
        raise ValueError("skill provenance file manifest is missing or unbounded")
    manifest = {}
    for record in records:
        if not isinstance(record, dict) or set(record) != {"path", "sha256"}:
            raise ValueError("skill provenance file record has an invalid schema")
        path = canonical_relative_path(record.get("path"), "skill provenance path")
        digest = record.get("sha256")
        if not isinstance(digest, str) or not digest_pattern.fullmatch(digest):
            raise ValueError("skill provenance file digest is invalid")
        if path in manifest:
            raise ValueError("skill provenance contains a duplicate path")
        manifest[path] = digest
    if sorted(manifest) != sorted(canonical_files):
        raise ValueError("skill provenance file manifest is incomplete")
    for path, contents in canonical_files.items():
        if hashlib.sha256(contents).hexdigest() != manifest[path]:
            raise ValueError("skill provenance digest disagrees with its canonical source bytes")
    if source.get("sha256") != hashlib.sha256(canonical_files["SKILL.md"]).hexdigest():
        raise ValueError("skill source digest disagrees with its canonical source bytes")


def canonical_provenance_bytes(
    revision, canonical_files, repository_identity=repository, binding=None
):
    provenance = {
        "schemaVersion": "1",
        "name": skill_name,
        "repository": repository_identity,
        "revision": revision,
        "revisionStatus": "committed",
        "source": {
            "path": source_path,
            "sha256": hashlib.sha256(canonical_files["SKILL.md"]).hexdigest(),
        },
        "files": [
            {"path": path, "sha256": hashlib.sha256(contents).hexdigest()}
            for path, contents in sorted(canonical_files.items())
        ],
    }
    if binding is not None:
        provenance["registry"] = {
            "projectId": binding["projectId"],
            "revision": binding["revision"],
            "manifestSha256": binding["manifestSha256"],
        }
    return (json.dumps(provenance, indent=2) + "\\n").encode("utf-8")


def canonical_authorization_receipt_bytes(
    revision, authorization, repository_identity=repository
):
    kind = authorization.get("kind") if isinstance(authorization, dict) else None
    develop = authorization.get("develop") if isinstance(authorization, dict) else None
    if kind == "source":
        if set(authorization) != {"kind", "revision"} or authorization.get("revision") != revision:
            raise ValueError("source receipt has an invalid schema")
        recorded_authorization = {"kind": kind, "revision": revision}
    elif kind == "develop":
        require_sha(develop, "authorization receipt develop revision")
        if set(authorization) != {"kind", "develop"}:
            raise ValueError("develop authorization receipt has an invalid schema")
        recorded_authorization = {"kind": kind, "develop": develop}
    elif kind == "candidate":
        require_sha(develop, "authorization receipt develop revision")
        pull = authorization.get("pull")
        if (
            set(authorization) != {"kind", "develop", "pull"}
            or not isinstance(pull, int)
            or isinstance(pull, bool)
            or pull <= 0
        ):
            raise ValueError("candidate authorization receipt has an invalid schema")
        recorded_authorization = {"kind": kind, "develop": develop, "pull": pull}
    elif kind == "release":
        require_sha(develop, "authorization receipt develop revision")
        run = authorization.get("run")
        attempt = authorization.get("attempt")
        if (
            set(authorization) != {"kind", "develop", "run", "attempt"}
            or not isinstance(run, int) or isinstance(run, bool) or run <= 0
            or not isinstance(attempt, int) or isinstance(attempt, bool) or attempt <= 0
        ):
            raise ValueError("release authorization receipt has an invalid schema")
        recorded_authorization = {"kind": kind, "develop": develop, "run": run, "attempt": attempt}
    else:
        raise ValueError("authorization receipt has an invalid kind")
    receipt = {
        "schemaVersion": "1",
        "repository": repository_identity,
        "revision": revision,
        "authorization": recorded_authorization,
    }
    return (json.dumps(receipt, indent=2) + "\\n").encode("utf-8")


def checked_output(output, target, entry_bytes, total_bytes):
    allowed = min(max_entry_bytes - entry_bytes, max_total_bytes - total_bytes)
    if len(output) > allowed:
        raise ValueError("actual extracted size exceeds limit")
    target.write(output)
    return entry_bytes + len(output), total_bytes + len(output)


def extract_archive(archive_contents, extraction_root):
    raw_archive = io.BytesIO(archive_contents)
    with zipfile.ZipFile(raw_archive, "r") as archive:
        entries = archive.infolist()
        if not 0 < len(entries) <= max_archive_entries:
            raise ValueError("unsafe archive entry count")
        if archive.comment:
            raise ValueError("archive comments are not supported")
        seen_names = set()
        declared_total = 0
        expected_offset = 0
        data_offsets = {}
        for entry in entries:
            name = entry.orig_filename
            if entry.filename != name or not name or name.endswith("/"):
                raise ValueError("archive entries must be named regular files")
            if not name.startswith(skill_prefix):
                raise ValueError("archive path escapes the skill root")
            logical_name = canonical_relative_path(name, "archive path")
            canonical_name = unicodedata.normalize("NFC", logical_name).casefold()
            if canonical_name in seen_names:
                raise ValueError("duplicate archive path")
            seen_names.add(canonical_name)
            if entry.flag_bits & 0x9:
                raise ValueError("encrypted or streaming archive entry")
            if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError("unsupported archive compression")
            if entry.comment or entry.extra:
                raise ValueError("per-entry comments and extra fields are not supported")
            mode = entry.external_attr >> 16
            if mode and not stat.S_ISREG(mode):
                raise ValueError("non-regular archive entry")
            if entry.file_size > max_entry_bytes:
                raise ValueError("declared entry size exceeds limit")
            declared_total += entry.file_size
            if declared_total > max_total_bytes:
                raise ValueError("declared archive size exceeds limit")
            if entry.header_offset != expected_offset:
                raise ValueError("archive local records are not contiguous")
            raw_archive.seek(entry.header_offset)
            header = raw_archive.read(local_header.size)
            if len(header) != local_header.size:
                raise ValueError("truncated local archive header")
            (
                signature, _version, local_flags, local_compression,
                _modified_time, _modified_date, local_crc,
                local_compressed_size, local_file_size, name_length, extra_length,
            ) = local_header.unpack(header)
            encoded_name = raw_archive.read(name_length)
            local_extra = raw_archive.read(extra_length)
            if (
                signature != local_signature
                or local_flags != entry.flag_bits
                or local_compression != entry.compress_type
                or local_crc != entry.CRC
                or local_compressed_size != entry.compress_size
                or local_file_size != entry.file_size
                or local_extra
            ):
                raise ValueError("local and central archive metadata disagree")
            encoding = "utf-8" if local_flags & 0x800 else "cp437"
            if encoded_name.decode(encoding) != name:
                raise ValueError("local and central archive names disagree")
            data_offset = entry.header_offset + local_header.size + name_length
            data_end = data_offset + entry.compress_size
            if data_end > archive.start_dir:
                raise ValueError("archive payload overlaps its central directory")
            data_offsets[name] = data_offset
            expected_offset = data_end
        if expected_offset != archive.start_dir:
            raise ValueError("archive contains unaccounted bytes before its index")

        os.mkdir(extraction_root, 0o700)
        extracted_total = 0
        for entry in entries:
            name = entry.orig_filename
            destination = os.path.join(extraction_root, *PurePosixPath(name).parts)
            os.makedirs(os.path.dirname(destination), mode=0o755, exist_ok=True)
            raw_archive.seek(data_offsets[name])
            compressed_remaining = entry.compress_size
            extracted_entry = 0
            crc = 0
            decompressor = (
                zlib.decompressobj(-zlib.MAX_WBITS)
                if entry.compress_type == zipfile.ZIP_DEFLATED
                else None
            )
            with open(destination, "xb") as target:
                while compressed_remaining:
                    compressed = raw_archive.read(min(65_536, compressed_remaining))
                    if not compressed:
                        raise ValueError("truncated archive payload")
                    compressed_remaining -= len(compressed)
                    if decompressor is None:
                        output = compressed
                    else:
                        allowed = min(
                            max_entry_bytes - extracted_entry,
                            max_total_bytes - extracted_total,
                        )
                        output = decompressor.decompress(compressed, allowed + 1)
                        if decompressor.unconsumed_tail:
                            raise ValueError("actual extracted size exceeds limit")
                    extracted_entry, extracted_total = checked_output(
                        output, target, extracted_entry, extracted_total
                    )
                    crc = binascii.crc32(output, crc)
                if decompressor is not None:
                    if not decompressor.eof or decompressor.unused_data or decompressor.unconsumed_tail:
                        raise ValueError("invalid deflate stream boundary")
                    output = decompressor.flush()
                    extracted_entry, extracted_total = checked_output(
                        output, target, extracted_entry, extracted_total
                    )
                    crc = binascii.crc32(output, crc)
            if extracted_entry != entry.file_size or crc & 0xFFFFFFFF != entry.CRC:
                raise ValueError("archive size or CRC metadata does not match payload")

    staged_skill = os.path.join(extraction_root, skill_name)
    provenance_path = os.path.join(staged_skill, provenance_name)
    try:
        with open(provenance_path, "r", encoding="utf-8") as provenance_file:
            provenance = json.load(provenance_file)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("archive provenance is missing or invalid") from error
    revision = require_sha(provenance.get("revision") if isinstance(provenance, dict) else None, "archive revision")
    if not isinstance(provenance, dict) or provenance.get("revisionStatus") != "committed":
        raise ValueError("working-tree provenance cannot be installed")
    packaged_paths = sorted(
        entry.orig_filename[len(skill_prefix):]
        for entry in entries
        if entry.orig_filename != f"{skill_prefix}{provenance_name}"
    )
    if f"{skill_prefix}{provenance_name}" not in {entry.orig_filename for entry in entries}:
        raise ValueError("archive provenance is missing")
    binding = provenance_binding(provenance)
    canonical_files, template_files = expected_skill_bytes(revision, binding)
    authorization = {"kind": "source", "revision": revision}
    if packaged_paths != sorted(canonical_files):
        raise ValueError("archive files do not exactly match the canonical skill file list")
    validate_provenance(provenance, revision, canonical_files, repository, binding)
    with open(provenance_path, "rb") as provenance_file:
        if provenance_file.read() != canonical_provenance_bytes(
            revision, canonical_files, repository, binding
        ):
            raise ValueError("archive provenance bytes are not canonical")
    for path, contents in canonical_files.items():
        with open(os.path.join(staged_skill, *PurePosixPath(path).parts), "rb") as packaged_file:
            if packaged_file.read() != contents:
                raise ValueError("archive file bytes disagree with their immutable source")
    return staged_skill, revision, canonical_files, authorization, binding, template_files


def read_provenance(path):
    try:
        with open(os.path.join(path, provenance_name), "rb") as source:
            contents = source.read(max_entry_bytes + 1)
        if len(contents) > max_entry_bytes:
            raise ValueError("installed skill provenance exceeds its size bound")
        return contents, json.loads(contents.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("installed skill provenance is missing or invalid") from error


def read_authorization_receipt(path, revision, expected_repository):
    receipt_path = os.path.join(path, authorization_receipt_name)
    try:
        with open(receipt_path, "rb") as source:
            contents = source.read(4097)
        if len(contents) > 4096:
            raise ValueError("installed authorization receipt exceeds its size bound")
        receipt = json.loads(contents.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("installed authorization receipt is missing or invalid") from error
    if (
        not isinstance(receipt, dict)
        or set(receipt) != {"schemaVersion", "repository", "revision", "authorization"}
        or receipt.get("schemaVersion") != "1"
        or receipt.get("repository") != expected_repository
        or receipt.get("revision") != revision
        or not isinstance(receipt.get("authorization"), dict)
    ):
        raise ValueError("installed authorization receipt has an invalid identity")
    authorization = receipt["authorization"]
    if contents != canonical_authorization_receipt_bytes(
        revision, authorization, expected_repository
    ):
        raise ValueError("installed authorization receipt bytes are not canonical")
    return authorization


def list_local_tree(root):
    files = []
    directories = []
    for directory, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
        for name in directory_names:
            path = os.path.join(directory, name)
            if os.path.islink(path):
                raise ValueError("installed skill contains a directory symlink")
            directories.append(os.path.relpath(path, root).replace(os.sep, "/"))
        for name in file_names:
            path = os.path.join(directory, name)
            metadata = os.lstat(path)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                raise ValueError("installed skill contains a non-regular or hard-linked file")
            files.append(os.path.relpath(path, root).replace(os.sep, "/"))
    return sorted(files), sorted(directories)


def verify_local_version(path, key, canonical_files=None):
    metadata = os.lstat(path)
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise ValueError("retained skill version is not a real directory")
    revision = require_sha(require_version_key(key, "skill version")[:40], "skill version revision")
    provenance_contents, provenance = read_provenance(path)
    binding = provenance_binding(provenance)
    if version_key(revision, binding) != key:
        raise ValueError("retained skill version names another registry revision")
    if canonical_files is not None:
        files, template_files = canonical_files, None
    else:
        files, template_files = expected_skill_bytes(revision, binding)
    installed_repository = (
        provenance.get("repository") if isinstance(provenance, dict) else None
    )
    if installed_repository not in (repository, legacy_repository):
        raise ValueError("installed skill provenance has an invalid identity")
    authorization = read_authorization_receipt(
        path, revision, installed_repository
    )
    validate_provenance(
        provenance, revision, files, installed_repository, binding
    )
    expected_paths = sorted([*files, provenance_name, authorization_receipt_name])
    expected_directories = sorted({
        parent
        for relative_path in expected_paths
        for parent in [
            "/".join(relative_path.split("/")[:depth])
            for depth in range(1, len(relative_path.split("/")))
        ]
        if parent
    })
    local_files, local_directories = list_local_tree(path)
    if local_files != expected_paths or local_directories != expected_directories:
        raise ValueError("installed skill has modified, missing, or extra files")
    if provenance_contents != canonical_provenance_bytes(
        revision, files, installed_repository, binding
    ):
        raise ValueError("installed skill provenance bytes are not canonical")
    for relative_path, expected in files.items():
        with open(os.path.join(path, *PurePosixPath(relative_path).parts), "rb") as source:
            if source.read() != expected:
                raise ValueError("installed skill differs from its immutable source")
    return files, authorization, template_files


def current_install():
    if not os.path.lexists(target_path):
        return None
    if not os.path.islink(target_path):
        raise ValueError("existing skill target is not an installer-managed symlink")
    link = os.readlink(target_path)
    parts = Path(link).parts
    if len(parts) != 2 or parts[0] != versions_name:
        raise ValueError("existing skill target points outside the managed version store")
    revision = require_version_key(parts[1], "installed skill link version")
    version_path = os.path.join(versions_root, revision)
    if not os.path.exists(target_path):
        raise ValueError("existing skill target is a broken symlink")
    if os.path.realpath(target_path) != os.path.realpath(version_path):
        raise ValueError("existing skill target resolves outside its named version")
    return revision, version_path


def replace_symlink_atomically(source, destination):
    if os.name != "nt":
        os.replace(source, destination)
        return

    # os.replace cannot replace an existing directory symlink on Windows.
    # FileRenameInfoEx with replace and POSIX semantics keeps the name switch
    # atomic while preserving already-open handles to the prior link.
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = [
        ctypes.c_wchar_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_void_p,
    ]
    create_file.restype = ctypes.c_void_p
    set_information = kernel32.SetFileInformationByHandle
    set_information.argtypes = [
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_uint32,
    ]
    set_information.restype = ctypes.c_int
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = [ctypes.c_void_p]
    close_handle.restype = ctypes.c_int

    delete_access = 0x00010000
    share_read_write_delete = 0x00000001 | 0x00000002 | 0x00000004
    open_existing = 3
    open_reparse_point = 0x00200000
    backup_semantics = 0x02000000
    handle = create_file(
        source,
        delete_access,
        share_read_write_delete,
        None,
        open_existing,
        open_reparse_point | backup_semantics,
        None,
    )
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        encoded_destination = os.path.abspath(destination).encode("utf-16-le")
        root_offset = 8 if ctypes.sizeof(ctypes.c_void_p) == 8 else 4
        name_length_offset = root_offset + ctypes.sizeof(ctypes.c_void_p)
        header_size = name_length_offset + 4
        information = ctypes.create_string_buffer(
            header_size + len(encoded_destination) + 2
        )
        file_rename_replace_if_exists = 0x00000001
        file_rename_posix_semantics = 0x00000002
        struct.pack_into(
            "I",
            information,
            0,
            file_rename_replace_if_exists | file_rename_posix_semantics,
        )
        struct.pack_into("P", information, root_offset, 0)
        struct.pack_into("I", information, name_length_offset, len(encoded_destination))
        ctypes.memmove(
            ctypes.addressof(information) + header_size,
            encoded_destination,
            len(encoded_destination),
        )
        file_rename_info_ex = 22
        if not set_information(
            handle,
            file_rename_info_ex,
            information,
            len(information),
        ):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        close_handle(handle)


def cleanup_preserving_error(cleanup, description):
    primary_error = sys.exc_info()[1]
    try:
        cleanup()
    except Exception as cleanup_error:
        if primary_error is None:
            raise RuntimeError(f"{description} failed: {cleanup_error}") from cleanup_error
        print(f"Additional {description} failure: {cleanup_error}", file=sys.stderr)


def activate(revision):
    global activation_revision
    relative_target = os.path.join(versions_name, revision)
    temporary_link = os.path.join(
        skills_root,
        f".{skill_name}-link-{secrets.token_hex(8)}",
    )
    try:
        os.symlink(relative_target, temporary_link, target_is_directory=True)
    except OSError as error:
        # ERROR_PRIVILEGE_NOT_HELD: an unelevated Windows account can create a
        # directory symlink only in Developer Mode. The verified version stays
        # in the version store, and the next run verifies and activates it.
        if getattr(error, "winerror", None) == 1314:
            raise ValueError(
                "Windows refused to create the skill directory symbolic link "
                "(WinError 1314). Turn on Developer Mode in Settings > System > "
                "For developers, or run this command in an elevated terminal, "
                "then run it again. The verified version is kept and reused."
            ) from error
        raise
    try:
        replace_symlink_atomically(temporary_link, target_path)
        activation_revision = revision
    finally:
        if os.path.lexists(temporary_link):
            cleanup_preserving_error(
                lambda: os.unlink(temporary_link), "temporary activation link cleanup"
            )


def install_or_update():
    global activation_verified
    archive_url = f"{artifact_origin}/downloads/{skill_name}.skill"
    checksum_url = f"{archive_url}.sha256"
    archive_contents = fetch_bytes(archive_url, max_archive_bytes, artifact_origin)
    checksum_contents = fetch_bytes(checksum_url, 4096, artifact_origin)
    try:
        checksum_text = checksum_contents.decode("ascii")
    except UnicodeDecodeError as error:
        raise ValueError("archive checksum is not ASCII") from error
    match = re.fullmatch(rf"([0-9A-Fa-f]{{64}})  {re.escape(skill_name)}\\.skill\\n?", checksum_text)
    if not match:
        raise ValueError("archive checksum record is missing or ambiguous")
    if hashlib.sha256(archive_contents).hexdigest() != match.group(1).lower():
        raise ValueError("archive checksum does not match its bytes")

    work_root = tempfile.mkdtemp(prefix=f".{skill_name}-stage-", dir=skills_root)
    try:
        (
            staged_skill,
            revision,
            canonical_files,
            authorization,
            binding,
            template_files,
        ) = extract_archive(
            archive_contents,
            os.path.join(work_root, "extracted"),
        )
        key = version_key(revision, binding)
        installed = current_install()
        if installed is not None:
            old_key, old_path = installed
            old_files = canonical_files if old_key == key else None
            old_files, old_authorization, _ = verify_local_version(
                old_path, old_key, old_files
            )
            # Template selection has no ancestry gate. Ordinary updates still
            # cannot roll back the project's approved D1 policy revision.
            old_registry = int(old_key.split("-r")[1]) if "-r" in old_key else None
            new_registry = binding["revision"] if binding is not None else None
            if old_registry is not None and new_registry is not None and new_registry < old_registry:
                raise ValueError("refusing downgrade of the project registry revision; use explicit rollback")
            if old_key == key:
                print(f"{skill_name} is already verified at {key}; no changes made.")
                return
            if old_files == canonical_files:
                print(
                    f"{skill_name} already has the current verified canonical bytes at {old_key}; no changes made."
                )
                return
        # Source integrity is sufficient. Explicit installation may select any
        # revision, including a different branch or an older retained release.
        authorization = {"kind": "source", "revision": revision}
        with open(
            os.path.join(staged_skill, authorization_receipt_name),
            "xb",
        ) as receipt_file:
            receipt_file.write(
                canonical_authorization_receipt_bytes(revision, authorization)
            )
        version_path = os.path.join(versions_root, key)
        if os.path.lexists(version_path):
            verify_local_version(version_path, key, canonical_files)
        else:
            os.replace(staged_skill, version_path)
        activate(key)
        activated = current_install()
        if activated is None:
            raise ValueError("activated skill target is missing")
        if activated[0] != key:
            raise ValueError("activated skill target has the wrong revision")
        verify_local_version(activated[1], key, canonical_files)
        activation_verified = True
        action = "Installed" if installed is None else "Updated"
        print(f"{action} {skill_name} at verified revision {key}.")
    finally:
        cleanup_preserving_error(lambda: shutil.rmtree(work_root), "staging cleanup")


def rollback():
    global activation_verified
    revision = require_version_key(rollback_revision, "requested rollback revision")
    installed = current_install()
    if installed is None:
        raise ValueError("cannot roll back a skill that is not installed")
    current_revision, current_path = installed
    verify_local_version(current_path, current_revision)
    retained_path = os.path.join(versions_root, revision)
    if not os.path.lexists(retained_path):
        raise ValueError("requested rollback revision is not retained locally")
    retained_files, _, retained_templates = verify_local_version(retained_path, revision)
    if revision == current_revision:
        print(f"{skill_name} is already verified at {revision}; no changes made.")
        return
    activate(revision)
    activated = current_install()
    if activated is None:
        raise ValueError("activated rollback target is missing")
    if activated[0] != revision:
        raise ValueError("activated rollback target has the wrong revision")
    verify_local_version(activated[1], revision, retained_files)
    activation_verified = True
    print(f"Rolled back {skill_name} to verified retained revision {revision}.")


def acquire_lock():
    flags = os.O_CREAT | os.O_RDWR
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(lock_path, flags, 0o600)
    except OSError as error:
        raise ValueError("installer concurrency lock path is unsafe") from error
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise ValueError("installer concurrency lock is not a regular file")
        lock_file = os.fdopen(descriptor, "r+b", buffering=0)
        descriptor = None
        try:
            if os.name == "posix":
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            elif os.name == "nt":
                import msvcrt

                if os.fstat(lock_file.fileno()).st_size == 0:
                    lock_file.write(b"\\0")
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                raise ValueError("installer concurrency locking is unsupported on this platform")
        except (OSError, ImportError) as error:
            lock_file.close()
            raise ValueError(
                "another skill install, update, or rollback holds the concurrency lock"
            ) from error
        return lock_file
    finally:
        if descriptor is not None:
            os.close(descriptor)


def main():
    if operation not in ("install", "rollback"):
        raise ValueError("SLOP_SKILL_OPERATION must be install or rollback")
    if operation == "install" and rollback_revision:
        raise ValueError("SLOP_SKILL_REVISION is valid only for an explicit rollback")
    os.makedirs(skills_root, mode=0o755, exist_ok=True)
    if os.path.lexists(versions_root):
        metadata = os.lstat(versions_root)
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
            raise ValueError("managed skill version store is not a real directory")
    else:
        os.mkdir(versions_root, 0o755)
    lock_file = acquire_lock()
    try:
        if operation == "rollback":
            rollback()
        else:
            install_or_update()
    finally:
        # Kernel locks are released even after an uncatchable process exit; the
        # inert file stays in place to avoid unlink/recreate split-lock races.
        cleanup_preserving_error(lock_file.close, "installer lock cleanup")


try:
    main()
except Exception as error:  # error-policy:J1 installer process boundary
    if activation_revision is None:
        print(f"Refusing skill operation: {error}", file=sys.stderr)
    else:
        verification = (
            "Post-activation verification succeeded."
            if activation_verified else "Post-activation verification did not complete."
        )
        print(
            f"Skill activation committed at {activation_revision}. {verification} "
            f"The operation failed: {error}. The committed activation was not reverted.",
            file=sys.stderr,
        )
    sys.exit(1)`;

/** @throws {never} */
export function createInstallCommand({ artifactOrigin: origin, skillsRoot, skillName, skillRepositoryPath, authority: requested }: InstallCommandInput): InstallerText {
  const checkedOrigin = artifactOriginOf(origin);
  if (checkedOrigin.kind === "refused") return checkedOrigin;
  const artifactOrigin = checkedOrigin.value;
  const checkedAuthority = originsOf(requested, artifactOrigin);
  if (checkedAuthority.kind === "refused") return checkedAuthority;
  const authority = checkedAuthority.value;
  const checkedTimeout = requestTimeoutOf(requested);
  if (checkedTimeout.kind === "refused") return checkedTimeout;
  const requestTimeoutSeconds = checkedTimeout.value;
  const requiresHttpsTrust = [artifactOrigin, authority.apiOrigin, authority.rawOrigin].some((value) => URL.parse(value)?.protocol === "https:");
  const pythonProbe = pythonRuntimeProbe(requiresHttpsTrust);
  const pythonRequirement = requiresHttpsTrust
    ? "Python 3 with a usable HTTPS CA trust store is required for authenticated skill installation."
    : "Python 3 is required for authenticated skill installation.";
  if (!skillNamePattern.test(skillName)) return refused("[Slop] skill name must be canonical kebab-case");
  if (!skillPathMatches(skillName, skillRepositoryPath)) return refused("[Slop] skill repository path must match the canonical skill name");
  return {
    kind: "text",
    text: `(
  set -eu
  SKILLS_ROOT="${skillsRoot}"
  OPERATION="\${SLOP_SKILL_OPERATION:-install}"
  ROLLBACK_REVISION="\${SLOP_SKILL_REVISION:-}"
  PYTHON_BIN=""
  for CANDIDATE in python3 python; do
    if command -v "$CANDIDATE" >/dev/null 2>&1 && "$CANDIDATE" -c ${shellQuote(pythonProbe)} >/dev/null 2>&1; then
      PYTHON_BIN="$CANDIDATE"
      break
    fi
  done
  if [ -z "$PYTHON_BIN" ]; then
    printf '%s\\n' ${shellQuote(pythonRequirement)} >&2
    exit 1
  fi
  trap 'exit 1' HUP INT TERM
  "$PYTHON_BIN" - ${shellQuote(artifactOrigin)} ${shellQuote(authority.apiOrigin)} ${shellQuote(authority.rawOrigin)} "$SKILLS_ROOT" "$OPERATION" "$ROLLBACK_REVISION" ${shellQuote(skillName)} ${shellQuote(skillRepositoryPath)} ${shellQuote(String(requestTimeoutSeconds))} ${shellQuote(authority.registryOrigin)} <<'PY'
${installerPythonProgram}
PY
)`,
  };
}
