/** One GitHub authority implementation for installation and run/write gates. */
export const SKILL_AUTHORITY_PYTHON = `
repository = "SlopDotCash/slopdotcash"
github_repository = "SlopDotCash/slopdotcash"
release_label = "slop-release-candidate"
provenance_name = "PROVENANCE.json"
max_source_files = 32
max_source_directories = 32
max_entry_bytes = 1_048_576
max_total_bytes = 4_194_304
max_api_bytes = 2_097_152
max_pull_pages = 10
max_timeline_pages = 10
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


def pull_records(revision):
    records = []
    for page in range(1, max_pull_pages + 1):
        response = api_json(
            f"/repos/{github_repository}/commits/{revision}/pulls",
            (("page", str(page)), ("per_page", "100")),
        )
        if not isinstance(response, list):
            raise ValueError("GitHub associated-pulls response must be an array")
        if len(response) > 100:
            raise ValueError("GitHub associated-pulls page exceeds its bound")
        records.extend(response)
        if len(response) < 100:
            return records
    raise ValueError("GitHub associated-pulls pagination exceeded its bound")


def pull_timeline(number):
    if not isinstance(number, int) or isinstance(number, bool) or number <= 0:
        raise ValueError("candidate pull request number is invalid")
    records = []
    for page in range(1, max_timeline_pages + 1):
        response = api_json(
            f"/repos/{github_repository}/issues/{number}/timeline",
            (("page", str(page)), ("per_page", "100")),
        )
        if not isinstance(response, list) or len(response) > 100:
            raise ValueError("GitHub pull-request timeline page is invalid or unbounded")
        records.extend(response)
        if len(response) < 100:
            return records
    raise ValueError("GitHub pull-request timeline pagination exceeded its bound")


def candidate_approval_is_fresh(number, revision):
    revision_event = None
    last_head_change = None
    last_release_label = None
    for index, event in enumerate(pull_timeline(number)):
        if not isinstance(event, dict):
            raise ValueError("GitHub pull-request timeline entry must be an object")
        kind = event.get("event")
        if kind == "committed":
            event_revision = event.get("sha")
            if not isinstance(event_revision, str) or not sha_pattern.fullmatch(event_revision):
                raise ValueError("GitHub committed timeline event omitted its revision")
            last_head_change = index
            if event_revision == revision:
                revision_event = index
        elif kind in ("head_ref_force_pushed", "head_ref_restored"):
            last_head_change = index
        elif kind in ("labeled", "unlabeled"):
            label = event.get("label")
            if isinstance(label, dict) and label.get("name") == release_label:
                last_release_label = (kind, index)
    return (
        revision_event is not None
        and last_head_change is not None
        and last_release_label is not None
        and last_release_label[0] == "labeled"
        and last_release_label[1] > last_head_change
        and last_release_label[1] > revision_event
    )


def pull_matches_repository_contract(pull, revision, *, require_open, require_label=True):
    if not isinstance(pull, dict):
        return False
    head = pull.get("head")
    base = pull.get("base")
    labels = pull.get("labels")
    if not isinstance(head, dict) or not isinstance(base, dict) or not isinstance(labels, list):
        return False
    head_repository = head.get("repo")
    base_repository = base.get("repo")
    if not isinstance(head_repository, dict) or not isinstance(base_repository, dict):
        return False
    label_names = {
        label.get("name")
        for label in labels
        if isinstance(label, dict) and isinstance(label.get("name"), str)
    }
    expected_state = pull.get("state") == "open" if require_open else pull.get("state") == "closed"
    return (
        expected_state
        and pull.get("draft") is False
        and head.get("sha") == revision
        and head_repository.get("full_name") == github_repository
        and base.get("ref") == "develop"
        and base_repository.get("full_name") == github_repository
        and (not require_label or release_label in label_names)
    )


def develop_head():
    response = api_json(f"/repos/{github_repository}/git/ref/heads/develop")
    if not isinstance(response, dict) or response.get("ref") != "refs/heads/develop":
        raise ValueError("GitHub develop ref response has the wrong identity")
    target = response.get("object")
    if not isinstance(target, dict) or target.get("type") != "commit":
        raise ValueError("GitHub develop ref does not resolve to a commit")
    return require_sha(target.get("sha"), "GitHub develop head")


def authorize_revision(revision, canonical_files):
    current_develop = develop_head()
    revocations = api_json(f"/repos/{github_repository}/contents/protocol/skill-revocations.json", (("ref", current_develop),))
    if not isinstance(revocations, dict) or revocations.get("encoding") != "base64":
        raise ValueError("Skill revocation list is unavailable")
    revoked = decode_json(base64.b64decode(revocations["content"]), "skill revocations")
    if not isinstance(revoked, list) or any(not isinstance(item, str) or not sha_pattern.fullmatch(item) for item in revoked):
        raise ValueError("Skill revocation list is invalid")
    if revision in revoked:
        raise ValueError("This skill revision was explicitly revoked; install the replacement")
    if revision == current_develop:
        return {"kind": "develop", "develop": current_develop}
    matching = [
        pull
        for pull in pull_records(revision)
        if pull_matches_repository_contract(pull, revision, require_open=True)
    ]
    if matching:
        numbers = sorted(
            pull.get("number")
            for pull in matching
            if isinstance(pull.get("number"), int) and pull.get("number") > 0
        )
        if not numbers:
            raise ValueError("authorized release candidate omitted its pull request number")
        approved = [
            number
            for number in numbers
            if candidate_approval_is_fresh(number, revision)
        ]
        if not approved:
            raise ValueError("release-candidate approval is not bound to the current pull-request head")
        if not compare_is_ancestor(current_develop, revision):
            raise ValueError("release candidate is behind or divergent from current develop")
        return {"kind": "candidate", "develop": current_develop, "pull": approved[0]}
    if compare_is_ancestor(revision, current_develop):
        current_files = remote_skill_bytes(current_develop)
        if current_files == canonical_files:
            return {"kind": "develop", "develop": current_develop}
        raise ValueError(f"installed skill bytes differ from current develop {current_develop}; install the current skill")
    raise ValueError(
        "archive revision is neither the current canonical develop skill nor an open labeled same-repository release candidate"
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


def compare_is_ancestor(old_revision, new_revision):
    comparison = api_json(f"/repos/{github_repository}/compare/{old_revision}...{new_revision}")
    if not isinstance(comparison, dict):
        raise ValueError("GitHub compare response must be an object")
    base_commit = comparison.get("base_commit")
    merge_base = comparison.get("merge_base_commit")
    return (
        comparison.get("status") == "ahead"
        and isinstance(comparison.get("ahead_by"), int)
        and comparison.get("ahead_by") > 0
        and comparison.get("behind_by") == 0
        and isinstance(base_commit, dict)
        and base_commit.get("sha") == old_revision
        and isinstance(merge_base, dict)
        and merge_base.get("sha") == old_revision
    )


`;

/** Run the same source authorization without installing or changing a version. */
export function createSkillAuthorizationProgram(testAuthority) {
  const authority = testAuthority ?? {
    apiOrigin: "https://api.github.com",
    rawOrigin: "https://raw.githubusercontent.com",
  };
  if (testAuthority !== undefined) {
    if (
      !testAuthority ||
      Object.keys(testAuthority).sort().join(",") !== "apiOrigin,rawOrigin" ||
      Object.values(testAuthority).some((value) => {
        const url = new URL(value);
        return url.protocol !== "file:" || url.search || url.hash;
      })
    )
      throw new TypeError(
        "Test skill authority requires deterministic file:// origins",
      );
  }
  return `
import base64
import hashlib
import json
import math
import os
import re
import socket
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import PurePosixPath

request = json.load(sys.stdin)
api_origin = ${JSON.stringify(authority.apiOrigin.replace(/\/$/u, ""))}
raw_origin = ${JSON.stringify(authority.rawOrigin.replace(/\/$/u, ""))}
skill_repository_path = request["sourcePath"]
request_timeout_seconds = 60
${SKILL_AUTHORITY_PYTHON}

try:
    revision = require_sha(request["revision"], "installed revision")
    canonical_relative_path(skill_repository_path, "canonical source path")
    files = {path: base64.b64decode(contents, validate=True) for path, contents in request["files"].items()}
    entries = list_remote_skill_files(revision)
    if sorted(files) != sorted(entries):
        raise ValueError("installed tree differs from its immutable GitHub source")
    for path, contents in files.items():
        entry = entries[path]
        if len(contents) != entry["size"] or git_blob_digest(contents) != entry.get("sha"):
            raise ValueError("installed bytes differ from their immutable GitHub source")
    authorization = authorize_revision(revision, files)
    print(json.dumps({"revision": revision, "authorization": authorization}))
except (ValueError, KeyError, TypeError) as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
`;
}
