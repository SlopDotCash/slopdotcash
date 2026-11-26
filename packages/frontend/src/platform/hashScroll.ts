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
  if (hash === "") return ""
  try {
    return decodeURIComponent(hash.slice(1))
  } catch {
    return ""
  }
}

function alignmentKeyOf(href: string): string {
  const url = URL.parse(href)
  if (url === null) return href
  if (url.pathname === "/") url.searchParams.delete("audience")
  return url.href
}

function entryOf(state: unknown): Entry | undefined {
  if (typeof state !== "object" || state === null || !("__slopHashScroll" in state)) return undefined
  const entry = state.__slopHashScroll
  return typeof entry === "object" && entry !== null && "key" in entry && "href" in entry && typeof entry.key === "string" && typeof entry.href === "string" ? { key: entry.key, href: entry.href } : undefined
}

function positionOf(key: string): Position | undefined {
  const raw = webStorage("session")?.getItem(positionPrefix + key)
  if (!raw) return undefined
  try {
    const stored: unknown = JSON.parse(raw)
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
  if (typeof performance === "undefined" || typeof history === "undefined" || typeof location === "undefined") return undefined
  const [navigation] = performance.getEntriesByType("navigation")
  const entry = entryOf(history.state)
  return navigation instanceof PerformanceNavigationTiming && navigation.type === "back_forward" && entry?.href === location.href ? positionOf(entry.key) : undefined
}

function reveal(targetId: string) {
  const target = document.getElementById(targetId)
  if (target === null) return
  for (let parent: HTMLElement | null = target; parent !== null; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true
  }
  target.scrollIntoView({ behavior: "auto", block: "start" })
}

function decided(alignment: Alignment, decide: (alignment: HashAlignment) => AlignTo): AlignTo {
  return decide({ targetNamed: alignment.targetId !== "", elapsedMs: performance.now() - alignment.startedMs, readerInput: alignment.readerInput, restoring: alignment.restoring, queryOnly: alignment.queryOnly })
}

/** @throws {never} */
export function listenForFragments(decide: (alignment: HashAlignment) => AlignTo): () => void {
  if (typeof window === "undefined" || typeof document === "undefined" || typeof location === "undefined") return () => {}

  let previous: Entry | undefined
  let active: Alignment | undefined
  let observer: MutationObserver | undefined
  let frame = 0

  function settle() {
    observer?.disconnect()
    observer = undefined
    cancelAnimationFrame(frame)
    for (const type of readerInputs) removeEventListener(type, takeOver, true)
  }

  function align() {
    const alignment = active
    if (alignment === undefined) return
    const decision = decided(alignment, decide)
    if (decision === "NoAlignment") return settle()
    if (decision === "RestorePosition" && alignment.restore !== undefined) scrollTo({ ...alignment.restore, behavior: "instant" })
    else reveal(alignment.targetId)
  }

  function takeOver() {
    if (active !== undefined) active.readerInput = true
    settle()
  }

  function remember() {
    const alignment = active
    if (alignment === undefined || alignment.entry.href !== location.href) return
    const decision = decided(alignment, decide)
    if (alignment.restore !== undefined && decision !== "NoAlignment") return align()
    if (decision === "NoAlignment") settle()
    keepPosition(alignment.entry.key, { left: scrollX, top: scrollY })
  }

  function open(restoring: Position | undefined) {
    const href = location.href
    if (previous?.href === href) return
    const key = alignmentKeyOf(href)
    const queryOnly = previous !== undefined && previous.key === key
    previous = { key, href }
    settle()
    active = undefined
    const parsed = URL.parse(href)
    const targetId = parsed === null ? "" : targetIdOf(parsed.hash)
    if (targetId === "") return
    const earlier = entryOf(history.state)
    const entry = { key: earlier?.href === href ? earlier.key : crypto.randomUUID(), href }
    const state: unknown = history.state
    const currentState = typeof state === "object" && state !== null && !Array.isArray(state) ? Object.fromEntries(Object.entries(state)) : {}
    history.replaceState({ ...currentState, __slopHashScroll: entry }, "")
    const restore = restoring ?? (queryOnly ? { left: scrollX, top: scrollY } : undefined)
    if (restore !== undefined) keepPosition(entry.key, restore)
    active = { entry, targetId, restore, restoring: restoring !== undefined, queryOnly: restoring === undefined && queryOnly, startedMs: performance.now(), readerInput: false }
    for (const type of readerInputs) addEventListener(type, takeOver, { capture: true, passive: type !== "wheel" })
    if (document.body !== null) {
      observer = new MutationObserver(align)
      observer.observe(document.body, { childList: true, subtree: true })
    }
    frame = requestAnimationFrame(align)
    align()
    if (document.fonts !== undefined) void document.fonts.ready.then(align)
  }

  function traversed(event: PopStateEvent) {
    const entry = entryOf(event.state)
    open(event.isTrusted && entry?.href === location.href ? positionOf(entry.key) : undefined)
  }

  function onHashChange() {
    open(undefined)
  }

  addEventListener("popstate", traversed)
  addEventListener("hashchange", onHashChange)
  addEventListener("scroll", remember, { passive: true })
  open(traversedHere())

  return () => {
    settle()
    removeEventListener("popstate", traversed)
    removeEventListener("hashchange", onHashChange)
    removeEventListener("scroll", remember)
  }
}
