/** Loading, failed and ready states of /data/record.json for /record and /receipts. */
import type { ReactNode } from "react";
import { loadPublicRecord, type PublicRecord } from "./lib/record-data";
import {
  type PublicResourceState,
  usePublicResource,
} from "./lib/use-public-resource";
import { Spinner } from "./Presentation";

type RecordState = PublicResourceState<{ record: PublicRecord }>;

export function usePublicRecord(): [RecordState, () => void] {
  return usePublicResource(
    true,
    loadPublicRecord,
    "The public record is not available.",
  );
}

export function RecordLoadState({
  state,
  retry,
  label,
  unavailable = "The public record is not available right now.",
  children,
}: {
  state: RecordState;
  retry: () => void;
  label: string;
  unavailable?: string;
  children: (record: PublicRecord) => ReactNode;
}) {
  if (state.status === "loading") return <Spinner label={label} />;
  if (state.status === "error")
    return (
      <div role="alert">
        <p>{unavailable}</p>
        <button
          className="button secondary-button"
          type="button"
          onClick={retry}
        >
          Try again
        </button>
      </div>
    );
  return <>{children(state.record)}</>;
}
