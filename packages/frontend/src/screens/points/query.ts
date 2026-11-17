// spec/frontend/navigation.md, "The browser remembers its requested page independently of authentication"
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  addEventListener("popstate", notify);
  addEventListener("hashchange", notify);
  return () => {
    listeners.delete(notify);
    removeEventListener("popstate", notify);
    removeEventListener("hashchange", notify);
  };
};

const address = () => `${location.search}${location.hash}`;

/** The address's query and fragment, read again whenever the history moves or a page rewrites its query. @throws {never} */
export function useQuery(): { readonly params: URLSearchParams; readonly hash: string } {
  const shown = useSyncExternalStore(subscribe, address, address);
  const at = shown.indexOf("#");
  return { params: new URLSearchParams(at < 0 ? shown : shown.slice(0, at)), hash: at < 0 ? "" : shown.slice(at) };
}

/** Writes the given query parameters (an empty value removes one) into the current history entry. @throws {never} */
export function writeQuery(values: Readonly<Record<string, string>>, notify = true): void {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (url.href === location.href) return;
  history.replaceState(history.state, "", url);
  if (notify) for (const listener of listeners) listener();
}
