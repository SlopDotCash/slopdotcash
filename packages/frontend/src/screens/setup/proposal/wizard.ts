// spec/frontend/projectDrafts.md, "A project setup draft belongs to one live document slot that a duplicated tab cannot take"; spec/frontend/projectDrafts.md, "Each saved setup draft has a strictly greater revision than the record it replaces"
import { Effect } from "effect";
import { useSyncExternalStore } from "react";
import type { PageRuntime } from "../../../app/runtime.vibe";
import type { DraftSaver, SaveView } from "../../../flows/projects/draftStore.vibe";
import { openProposalDraft } from "./draft.vibe";
import { draftPayload, restoredWizard, type Wizard } from "./form.ts";

export interface WizardView {
  readonly wizard: Wizard;
  readonly saving: boolean;
  readonly saveFailed: boolean;
}

export interface WizardStore {
  readonly get: () => WizardView;
  readonly subscribe: (notify: () => void) => () => void;
  readonly update: (change: (wizard: Wizard) => Wizard) => void;
}

interface Loader {
  store: WizardStore | undefined;
  readonly listeners: Set<() => void>;
  readonly subscribe: (notify: () => void) => () => void;
  readonly get: () => WizardStore | undefined;
}

let opening: Promise<DraftSaver> | undefined;
const loaders = new WeakMap<PageRuntime, Loader>();

/** @throws {never} */
export function wizardStore(initial: string | null, search: string, saver: DraftSaver): WizardStore {
  let view: WizardView = { wizard: restoredWizard(initial, search), saving: false, saveFailed: false };
  let saved = initial;
  const listeners = new Set<() => void>();
  const publish = (next: WizardView) => {
    view = next;
    for (const listener of listeners) listener();
  };
  const save = (payload: string | null) => {
    saved = payload;
    publish({ ...view, saving: true, saveFailed: false });
    void Effect.runPromise(saver.save(payload)).then((shown: SaveView) => publish({ ...view, saving: shown.saving, saveFailed: shown.failed }));
  };
  const opened = draftPayload(view.wizard);
  if (opened !== initial) save(opened);
  return {
    get: () => view,
    subscribe: (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    update: (change) => {
      const wizard = change(view.wizard);
      if (wizard === view.wizard) return;
      publish({ ...view, wizard });
      const payload = draftPayload(wizard);
      if (payload !== saved) save(payload);
    },
  };
}

function loaderOf(runtime: PageRuntime, search: string): Loader {
  const known = loaders.get(runtime);
  if (known) return known;
  const loader: Loader = {
    store: undefined,
    listeners: new Set(),
    get: () => loader.store,
    subscribe: (notify) => {
      loader.listeners.add(notify);
      opening ??= runtime.runPromise(openProposalDraft());
      void opening.then(async (saver) => {
        const { payload } = await Effect.runPromise(saver.view());
        if (loader.store !== undefined) return;
        loader.store = wizardStore(payload, search, saver);
        for (const listener of loader.listeners) listener();
      });
      return () => loader.listeners.delete(notify);
    },
  };
  loaders.set(runtime, loader);
  return loader;
}

/** The setup wizard of this page, restored from the document's draft slot once it is open; undefined until then. */
export function useWizardStore(runtime: PageRuntime, search: string): WizardStore | undefined {
  const loader = loaderOf(runtime, search);
  return useSyncExternalStore(loader.subscribe, loader.get, loader.get);
}

const unopened: WizardView | undefined = undefined;
const nothing = () => () => undefined;

export function useWizard(store: WizardStore | undefined): WizardView | undefined {
  return useSyncExternalStore(store?.subscribe ?? nothing, store?.get ?? (() => unopened), store?.get ?? (() => unopened));
}
