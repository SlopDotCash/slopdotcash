# Session log for clients without a session file

Claude Code and Codex keep their own session files, and `run-receipt.mjs
session` reads them. For any other client, write this log yourself while you
work and pass it with `--log <path>`. Keep the log outside the repository, for
example in a temporary directory.

## Format

UTF-8 NDJSON: one JSON object per line, in the order things happened. Fields:

- `kind` (required): `user`, `assistant`, `tool_call` or `tool_result`.
- `t` (optional): an ISO 8601 time with a zone, such as
  `2026-11-23T14:02:11Z`.
- `text`: the words of the message, or the output of a tool. Required for
  `user` and `assistant`.
- `tool`: the tool name. Required for `tool_call`, optional for
  `tool_result`. Letters, digits and `_ . : -`, up to 64 characters.
- `args`: the tool's arguments, as JSON, for `tool_call`.

A `t` that is not a valid time is dropped and the line is kept. Lines of any
other shape are ignored.

```json
{"t":"2026-11-23T14:02:11Z","kind":"user","text":"Fix the date parsing bug in the importer."}
{"t":"2026-11-23T14:02:20Z","kind":"assistant","text":"I will reproduce the failure first."}
{"t":"2026-11-23T14:02:25Z","kind":"tool_call","tool":"shell","args":{"command":"node --test"}}
{"t":"2026-11-23T14:02:31Z","kind":"tool_result","tool":"shell","text":"1 failing"}
```

## Rules

- Record what you did, in order. Never invent, reorder or tidy events, and
  never add a step you did not take.
- Do not write credentials, keys or private data into the log. Leave them out.
- Keep the log under 64 MiB.

## What the cleaner does to it

The same cleaner runs over this log as over a client's own file, on this
machine, before anything is uploaded. Credentials, local paths and paths
outside the repository are replaced with markers such as
`[REDACTED:CREDENTIAL]`. In this mode a tool result has no provable file path,
so its text is replaced with `[REDACTED:SOURCE]` unless it is empty. Your
messages and tool calls are what the log keeps. The cleaner is pattern based
and can miss a secret, so the operator reads the cleaned file before approving
the upload.
