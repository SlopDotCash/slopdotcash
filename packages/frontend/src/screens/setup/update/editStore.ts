// spec/frontend/projectDrafts.md, "A project setup draft belongs to one live document slot that a duplicated tab cannot take"; spec/frontend/projectDrafts.md, "Each saved setup draft has a strictly greater revision than the record it replaces"
import { Effect } from "effect";
import { useSyncExternalStore } from "react";
import type { PageRuntime } from "../../../app/runtime.vibe";
import type { DraftSaver, SaveView } from "../../../flows/projects/draftStore.vibe";
import { openUpdateDraft } from "./actions.vibe";
import { type Edit, editPayload, restoredEdit } from "./revision.ts";

export interface EditView {
  readonly edit: Edit;
  readonly saving: boolean;
  readonly saveFailed: boolean;
}

export interface EditStore {
  readonly get: () => EditView;
  readonly subscribe: (notify: () => void) => () => void;
  readonly update: (change: (edit: Edit) => Edit) => void;
}

interface Opening {
  readonly get: () => EditStore | undefined;
  readonly subscribe: (notify: () => void) => () => void;
}

const openings = new Map<string, Opening>();

/** The project's edit, restored from its saved draft and saved again on each change. @throws {never} */
export function editStore(initial: string | null, saver: DraftSaver): EditStore {
  let view: EditView = { edit: restoredEdit(initial), saving: false, saveFailed: false };
  let saved = editPayload(view.edit);
  const listeners = new Set<() => void>();
  const publish = (next: EditView) => {
    view = next;
    for (const listener of listeners) listener();
  };
  const save = (payload: string | null) => {
    saved = payload;
    publish({ ...view, saving: true, saveFailed: false });
    void Effect.runPromise(saver.save(payload)).then((shown: SaveView) => publish({ ...view, saving: shown.saving, saveFailed: shown.failed }));
  };
  return {
    get: () => view,
    subscribe: (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    update: (change) => {
      const edit = change(view.edit);
      if (edit === view.edit) return;
      publish({ ...view, edit });
      const payload = editPayload(edit);
      if (payload !== saved) save(payload);
    },
  };
}

function openingOf(runtime: PageRuntime, projectId: string): Opening {
  const known = openings.get(projectId);
  if (known) return known;
  let store: EditStore | undefined;
  let started = false;
  const listeners = new Set<() => void>();
  const opening: Opening = {
    get: () => store,
    subscribe: (notify) => {
      listeners.add(notify);
      if (!started) {
        started = true;
        void runtime.runPromise(openUpdateDraft(projectId)).then(async (saver) => {
          const { payload } = await Effect.runPromise(saver.view());
          store = editStore(payload, saver);
          for (const listener of listeners) listener();
        });
      }
      return () => listeners.delete(notify);
    },
  };
  openings.set(projectId, opening);
  return opening;
}

/** The edit store of the project's update draft, opened once per document; undefined until its slot is open. */
export function useEditStore(runtime: PageRuntime, projectId: string): EditStore | undefined {
  const opening = openingOf(runtime, projectId);
  return useSyncExternalStore(opening.subscribe, opening.get, opening.get);
}

export function useEdit(store: EditStore): EditView {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
