// spec/frontend/routes.md, "A fragment destination opens its section and stays aligned until it settles or the reader takes over"
import type { AlignTo, HashAlignment } from "../../gen/frontend__routes.ts";
import { webStorage } from "./webStorage.ts";

interface Position {
  readonly left: number
  readonly top: number
}

interface Entry {
  readonly key: string
  readonly href: string
}

interface Alignment {
  readonly entry: Entry
  readonly targetId: string
  readonly restore: Position | undefined
  readonly restoring: boolean
  readonly queryOnly: boolean
  readonly startedMs: number
  readerInput: boolean
}

const readerInputs = ["keydown", "pointerdown", "touchstart", "wheel"] as const
const positionPrefix = "slop:hash-scroll:"

function targetIdOf(hash: string): string {
  try {
    return hash === "" ? "" : decodeURIComponent(hash.slice(1))
  } catch {
    return ""
  }
}

function alignmentKeyOf(href: string): string {
  try {
    const url = new URL(href)
    if (url.pathname === "/") url.searchParams.delete("audience")
    return url.href
  } catch {
    return href
  }
}

function entryOf(state: unknown): Entry | undefined {
  if (typeof state !== "object" || state === null || !("__slopHashScroll" in state)) return undefined
  const entry = state.__slopHashScroll
  return typeof entry === "object" && entry !== null && "key" in entry && "href" in entry && typeof entry.key === "string" && typeof entry.href === "string" ? { key: entry.key, href: entry.href } : undefined
}

function positionOf(key: string): Position | undefined {
  try {
    const stored: unknown = JSON.parse(webStorage("session")?.getItem(positionPrefix + key) ?? "null")
    return typeof stored === "object" && stored !== null && "left" in stored && "top" in stored && typeof stored.left === "number" && typeof stored.top === "number" ? { left: stored.left, top: stored.top } : undefined
  } catch {
    return undefined
  }
}

function keepPosition(key: string, position: Position) {
  try {
    webStorage("session")?.setItem(positionPrefix + key, JSON.stringify(position))
  } catch {
    return
  }
}

function traversedHere(): Position | undefined {
  try {
    const [navigation] = performance.getEntriesByType("navigation")
    const entry = entryOf(history.state)
    return navigation instanceof PerformanceNavigationTiming && navigation.type === "back_forward" && entry?.href === location.href ? positionOf(entry.key) : undefined
  } catch {
    return undefined
  }
}

function reveal(targetId: string) {
  try {
    const target = document.getElementById(targetId)
    if (target === null) return
    for (let parent: HTMLElement | null = target; parent !== null; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true
    }
    target.scrollIntoView({ behavior: "auto", block: "start" })
  } catch {
    return
  }
}

function decided(alignment: Alignment, decide: (alignment: HashAlignment) => AlignTo): AlignTo {
  return decide({ targetNamed: alignment.targetId !== "", elapsedMs: performance.now() - alignment.startedMs, readerInput: alignment.readerInput, restoring: alignment.restoring, queryOnly: alignment.queryOnly })
}

/** @throws {never} */
export function listenForFragments(decide: (alignment: HashAlignment) => AlignTo): void {
  let previous: Entry | undefined
  let active: Alignment | undefined
  let observer: MutationObserver | undefined
  let frame = 0

  function settle() {
    try {
      observer?.disconnect()
      observer = undefined
      cancelAnimationFrame(frame)
      for (const type of readerInputs) removeEventListener(type, takeOver, true)
    } catch {
      return
    }
  }

  function align() {
    const alignment = active
    if (alignment === undefined) return
    const decision = decided(alignment, decide)
    if (decision === "NoAlignment") return settle()
    try {
      if (decision === "RestorePosition" && alignment.restore !== undefined) scrollTo({ ...alignment.restore, behavior: "instant" })
      else reveal(alignment.targetId)
    } catch {
      settle()
    }
  }

  function takeOver() {
    if (active !== undefined) active.readerInput = true
    settle()
  }

  function remember() {
    try {
      const alignment = active
      if (alignment === undefined || alignment.entry.href !== location.href) return
      const decision = decided(alignment, decide)
      if (alignment.restore !== undefined && decision !== "NoAlignment") return align()
      if (decision === "NoAlignment") settle()
      keepPosition(alignment.entry.key, { left: scrollX, top: scrollY })
    } catch {
      return
    }
  }

  function open(restoring: Position | undefined) {
    try {
      const href = location.href
      if (previous?.href === href) return
      const key = alignmentKeyOf(href)
      const queryOnly = previous !== undefined && previous.key === key
      previous = { key, href }
      settle()
      active = undefined
      const targetId = targetIdOf(new URL(href).hash)
      if (targetId === "") return
      const earlier = entryOf(history.state)
      const entry = { key: earlier?.href === href ? earlier.key : crypto.randomUUID(), href }
      history.replaceState({ ...history.state, __slopHashScroll: entry }, "")
      const restore = restoring ?? (queryOnly ? { left: scrollX, top: scrollY } : undefined)
      if (restore !== undefined) keepPosition(entry.key, restore)
      active = { entry, targetId, restore, restoring: restoring !== undefined, queryOnly: restoring === undefined && queryOnly, startedMs: performance.now(), readerInput: false }
      for (const type of readerInputs) addEventListener(type, takeOver, { capture: true, passive: type !== "wheel" })
      observer = new MutationObserver(align)
      observer.observe(document.body, { childList: true, subtree: true })
      frame = requestAnimationFrame(align)
      align()
      void document.fonts.ready.then(align)
    } catch {
      return
    }
  }

  function traversed(event: PopStateEvent) {
    try {
      const entry = entryOf(event.state)
      open(event.isTrusted && entry?.href === location.href ? positionOf(entry.key) : undefined)
    } catch {
      return
    }
  }

  try {
    addEventListener("popstate", traversed)
    addEventListener("hashchange", () => open(undefined))
    addEventListener("scroll", remember, { passive: true })
    open(traversedHere())
  } catch {
    return
  }
}
