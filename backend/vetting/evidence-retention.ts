/**
 * Successful bounded scans can establish lasting repository admission.
 * Their raw evidence stays private and permanent (owner decision, 27 October
 * 2026). This retention predicate does not grant clearance or rehabilitate
 * historical metadata-only results. Both callers name the assessment table a.
 */
export const PERMANENT_ADMISSION_EVIDENCE_SQL = `a.state='clean'
  AND json_extract(a.result,'$.schemaVersion')='slop-vetting-result-v2'
  AND json_extract(a.result,'$.disposition')='clean'`;
