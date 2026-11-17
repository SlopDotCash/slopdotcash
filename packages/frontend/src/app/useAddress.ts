// spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
import { useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  addEventListener("popstate", notify);
  addEventListener("hashchange", notify);
  return () => {
    removeEventListener("popstate", notify);
    removeEventListener("hashchange", notify);
  };
};

const address = () => `${location.pathname}${location.search}${location.hash}`;

export function useAddress(): string {
  return useSyncExternalStore(subscribe, address, address);
}
