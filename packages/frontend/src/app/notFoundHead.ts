// spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"
import { createElement, useSyncExternalStore } from "react";

let mountedViews = 0;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const register = () => {
  mountedViews += 1;
  notify();
  return () => {
    mountedViews -= 1;
    notify();
  };
};

const notFoundMounted = () => mountedViews > 0;
const registered = () => true;

export const useNotFoundMounted = () => useSyncExternalStore(subscribe, notFoundMounted, notFoundMounted);

export function NotFoundHead() {
  useSyncExternalStore(register, registered, registered);
  return createElement("meta", { name: "robots", content: "noindex" });
}
