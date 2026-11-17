// spec/contributor/traceServer.md, "The run, its intents, reservation, objects and events are separate records"
export const writes = [
  "trace_runs",
  "trace_upload_intents",
  "trace_write_reservations",
  "trace_objects",
  "trace_uploads",
  "trace_attachment_commits",
  "run_progress_events",
] as const;
