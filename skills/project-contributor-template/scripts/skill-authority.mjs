/** Immutable GitHub source and registry verification for installation. */
export const SKILL_AUTHORITY_PYTHON = `
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
    except urllib.error.URLError as error:
        if isinstance(error.reason, (TimeoutError, socket.timeout)):
            raise RetryableDownloadError(
                f"timed out after {request_timeout_seconds}s"
            ) from error
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
    # never retried; only per-attempt timeouts and HTTP 5xx repeat, bounded.
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
branch_pattern = re.compile(r"[A-Za-z0-9._/-]{1,255}")
max_manifest_bytes = 1_048_576


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
        or not isinstance(repository_record.get("integrationBranch"), str)
        or not branch_pattern.fullmatch(repository_record["integrationBranch"])
        or not isinstance(contribution, dict)
    ):
        raise ValueError("project registry manifest cannot render this skill")
    if "SKILL.md" not in template_files or "project.json" in template_files:
        raise ValueError("canonical skill template has an invalid identity")
    text = template_files["SKILL.md"].decode("utf-8")
    for token, value in (
        ("{{SLOP_SKILL_NAME}}", skill["id"]),
        ("{{SLOP_PROJECT_ID}}", project_id),
        ("{{SLOP_REPOSITORY}}", repository_record["id"]),
        ("{{SLOP_INTEGRATION_BRANCH}}", repository_record["integrationBranch"]),
    ):
        text = text.replace(token, value)
    if "{{SLOP_" in text:
        raise ValueError("canonical skill template has an unknown placeholder")
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

/** Python 3 qualification for online installation, update and rollback. */
export function pythonRuntimeProbe(requiresHttpsTrust) {
  return requiresHttpsTrust
    ? 'import os, re, ssl, sys; d = ssl.get_default_verify_paths().capath; raise SystemExit(0 if sys.version_info.major == 3 and (ssl.create_default_context().get_ca_certs() or (d and os.path.isdir(d) and any(re.fullmatch("[0-9a-f]{8}[.][0-9]+", n) for n in os.listdir(d)))) else 1)'
    : "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)";
}
