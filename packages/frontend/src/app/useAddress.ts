// spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

const notifyAll = () => {
  for (const listener of listeners) listener();
};

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  if (typeof addEventListener === "undefined") {
    return () => {
      listeners.delete(notify);
    };
  }
  addEventListener("popstate", notify);
  addEventListener("hashchange", notify);
  return () => {
    listeners.delete(notify);
    removeEventListener("popstate", notify);
    removeEventListener("hashchange", notify);
  };
};

const address = () => (typeof location === "undefined" ? "/" : `${location.pathname}${location.search}${location.hash}`);

const serverAddress = () => "/";

export function navigateWithin(href: string): void {
  if (typeof history === "undefined") return;
  history.pushState({}, "", href);
  notifyAll();
}

export function useAddress(): string {
  return useSyncExternalStore(subscribe, address, serverAddress);
}
