"use client";

import * as React from "react";
import { useRenderElement } from "@base-ui/react/internals/useRenderElement";
import type { ComponentRenderFn, HTMLProps } from "@base-ui/react/use-render";
import { addEventListener } from "@base-ui/utils/addEventListener";
import { useAnimationFrame } from "@base-ui/utils/useAnimationFrame";
import { useIsoLayoutEffect } from "@base-ui/utils/useIsoLayoutEffect";
import { useRefWithInit } from "@base-ui/utils/useRefWithInit";
import { useStableCallback } from "@base-ui/utils/useStableCallback";

/**
 * An unstyled in-page navigation component. `TocRoot` tracks one current
 * location in a scrolling surface (§6) from one tracking lane — a
 * `targetIds` collection or a `headings` entry list (§4.1); `TocList`,
 * `TocItem`, and `TocLink` compose native fragment links over it.
 * `useTocOutline`, `discoverHeadings`, and `buildOutline` supply the heading
 * data and presentational nesting.
 *
 * Specification: SPEC.md. Geometry model is physical, vertical, top-to-bottom.
 */

const MIN_HEADING_LEVEL = 1;
const MAX_HEADING_LEVEL = 6;

const DEFAULT_DISCOVERY_LEVELS: readonly HeadingLevel[] = [2, 3, 4, 5, 6];

const HEADINGS_SELECTOR = "h1, h2, h3, h4, h5, h6";

const HEADING_LEVEL_BY_TAG_NAME: Readonly<Record<string, HeadingLevel | undefined>> = {
  H1: 1,
  H2: 2,
  H3: 3,
  H4: 4,
  H5: 5,
  H6: 6,
};

const TITLE_EXCLUDED_TAG_NAMES: ReadonlySet<string> = new Set(["script", "style"]);

// ASCII whitespace runs within a heading title collapse to one space.
const TITLE_WHITESPACE_RUN_PATTERN = /\s+/g;

// U+0009–U+000D and U+0020 are forbidden in target IDs (§4.2).
const ASCII_WHITESPACE_PATTERN = /[\u0009-\u000D\u0020]/;

// A high surrogate without a following low surrogate, or a low surrogate
// without a preceding high surrogate. Unpaired surrogates cannot serialize
// to a URL fragment.
const UNPAIRED_SURROGATE_PATTERN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const ARIA_CURRENT_LOCATION = "location";

const DEFAULT_ROOT_LABEL = "Table of contents";

// The default landmark label occupies the leftmost merge slot, so a
// consumer-provided aria-label or aria-labelledby wins it (§8.3).
const DEFAULT_ROOT_LABEL_PROPS = { "aria-label": DEFAULT_ROOT_LABEL };

// A scroll position within this distance from the surface's maximum counts
// as "at the bottom" (§6 leaves the sub-pixel tolerance to the
// implementation). The value is one whole pixel because engines round
// fractional maximum scroll positions: the tolerance must not strand a
// bottom state one rounding unit early.
const BOTTOM_MAX_SCROLL_TOLERANCE_PX = 1;

const INVALID_COLLECTION_MESSAGE = "Invalid target ID in targetIds: every entry must be a valid, unique target ID.";

const DUPLICATE_TARGET_MESSAGE_PREFIX = "Duplicate target ID: ";

const INVALID_ACTIVATION_OFFSET_MESSAGE = "Invalid activationOffset: it must be a finite, non-negative number.";

const INVALID_TRACKING_SOURCE_MESSAGE = "TocRoot receives one tracking source: targetIds or headings.";

const INVALID_TARGET_ID_ON_LINK_MESSAGE = "Invalid targetId on TocLink: it must be a valid target ID.";

const LINK_OUTSIDE_ROOT_MESSAGE = "TocLink must render inside a TocRoot.";

const LINK_NOT_IN_COLLECTION_MESSAGE_PREFIX = "targetId is not in the root collection: ";

const INVALID_LIST_FUNCTION_CHILDREN_MESSAGE = "TocList receives function children only when TocRoot owns an outline; pass `headings` to TocRoot.";

const OWNERSHIP_ERROR_MESSAGE = "Toc target resolves outside its configured scroller. Targets in element mode must be DOM descendants of the scroller.";

const INVALID_DISCOVERY_LEVEL_MESSAGE = "Invalid levels option: values must be integers from 1 to 6.";

const INVALID_DISCOVERY_ID_MESSAGE_PREFIX = "Invalid target ID on heading: ";

const DUPLICATE_DISCOVERY_ID_MESSAGE_PREFIX = "Duplicate heading ID: ";

const EMPTY_DISCOVERY_TITLE_MESSAGE = "Heading title is empty after cleaning excluded content and whitespace.";

const INVALID_OUTLINE_ID_MESSAGE_PREFIX = "Invalid heading ID in buildOutline input: ";

const INVALID_OUTLINE_LEVEL_MESSAGE = "Invalid heading level in buildOutline input: it must be an integer from 1 to 6.";

const INVALID_OUTLINE_TITLE_MESSAGE = "Invalid heading title in buildOutline input: it must be a string.";

const DUPLICATE_OUTLINE_ID_MESSAGE_PREFIX = "Duplicate heading ID in buildOutline input: ";

const TOC_ROOT_SLOT = "toc-root";
const TOC_LIST_SLOT = "toc-list";
const TOC_ITEM_SLOT = "toc-item";
const TOC_LINK_SLOT = "toc-link";

// TocList and TocItem share one empty state; it carries no attributes.
const EMPTY_TOC_STATE: TocListState = {};

// The empty snapshot the outline hook yields on the server and on a null
// scope; the stable identity keeps the outline derivation from rebuilding.
const EMPTY_HEADINGS: readonly Heading[] = [];

// Definition order: module doc, then constants, then types. Shared pure
// helpers sit above their first consumer, a helper with one consumer sits
// directly below it, and each part's props sit directly above the part.

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface Heading {
  id: string;
  title: string;
  level: HeadingLevel;
}

export interface HeadingGroup extends Heading {
  children: readonly HeadingGroup[];
}

// The same node shape with mutable children, used while the outline builds;
// the returned trees still satisfy HeadingGroup.
interface HeadingGroupDraft extends Heading {
  children: HeadingGroupDraft[];
}

// A parsed outline entry: title cleaning has already run, so grouping reads
// nothing further (§9.2).
type CleanedHeading = Heading;

// Grid of one measurement: injected into the pure selection step so the
// crossing rule stays testable without a DOM (§16.1).
export interface TocTargetGeometry {
  id: string;
  /** Pixels from the surface top edge down to the target's top edge; `null` when the target is unavailable (§4.6, §6). */
  headroomPx: number | null;
}

export interface TocGeometrySample {
  targets: readonly TocTargetGeometry[];
  activationOffsetPx: number;
  hasSurfaceBottomReached: boolean;
}

// Part states are interfaces because `useRenderElement`'s `State extends
// Record<string, any>` accepts them; the empty structural states are empty
// interfaces, in the same idiom Base UI's own part states use.
export interface TocRootState {
  currentId: string | null;
}

export interface TocLinkState {
  current: boolean;
}

export interface TocListState {}

export interface TocItemState {}

export interface TocActions {
  refresh(): void;
}

interface TocRootContextValue {
  /** Ordered destination IDs of the owning Root (§4.1); identity is the committed prop value. */
  targetIds: readonly string[];
  /** The outline the Root built from its `headings` lane; `null` in the `targetIds` lane (§8.3, §8.4). */
  outline: readonly HeadingGroup[] | null;
  /** The current location this Root tracks; `null` before the first crossing (§6). */
  currentId: string | null;
}

/** A valid target ID is non-empty, holds no ASCII whitespace, and holds no unpaired surrogate (§4.2). */
export function isValidTargetId(candidate: unknown): candidate is string {
  if (typeof candidate !== "string") return false;
  if (candidate === "") return false;
  if (ASCII_WHITESPACE_PATTERN.test(candidate)) return false;
  return !UNPAIRED_SURROGATE_PATTERN.test(candidate);
}

/**
 * Collection boundary: every entry must be a valid target ID and unique (§4.3).
 * Returns a fresh array: the parser owns the copy, so callers keep reading
 * their own prop value (§4.1).
 */
export function parseTargetCollection(targetIds: readonly unknown[]): readonly string[] {
  const parsedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const candidate of targetIds) {
    if (!isValidTargetId(candidate)) throw new Error(INVALID_COLLECTION_MESSAGE);
    if (seenIds.has(candidate)) throw new Error(DUPLICATE_TARGET_MESSAGE_PREFIX + candidate);
    seenIds.add(candidate);
    parsedIds.push(candidate);
  }
  return parsedIds;
}

/** The activation line offset is a non-negative, finite CSS-pixel number (§6). */
export function isValidActivationOffset(candidate: unknown): candidate is number {
  return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0;
}

/** Offset boundary (§6): parse a non-negative, finite CSS-pixel number or throw (§10). */
export function parseActivationOffset(candidate: unknown): number {
  if (!isValidActivationOffset(candidate)) throw new Error(INVALID_ACTIVATION_OFFSET_MESSAGE);
  return candidate;
}

/**
 * Pure current-location step (§6): the last crossed target in configured
 * order; when nothing crossed and the surface bottom is reached, the last
 * available target. Unavailable targets participate in neither.
 */
export function selectCurrentTargetId(sample: TocGeometrySample): string | null {
  let lastCrossedId: string | null = null;
  let lastAvailableId: string | null = null;
  for (const target of sample.targets) {
    if (target.headroomPx === null) continue;
    lastAvailableId = target.id;
    if (target.headroomPx <= sample.activationOffsetPx) lastCrossedId = target.id;
  }
  if (lastCrossedId !== null) return lastCrossedId;
  if (sample.hasSurfaceBottomReached) return lastAvailableId;
  return null;
}

/** Trims and collapses whitespace runs; an empty result after cleaning is rejected (§9.1). */
export function cleanHeadingTitle(title: string): string {
  const cleaned = title.replace(TITLE_WHITESPACE_RUN_PATTERN, " ").trim();
  if (cleaned === "") throw new Error(EMPTY_DISCOVERY_TITLE_MESSAGE);
  return cleaned;
}

function isHeadingLevelValue(candidate: unknown): candidate is HeadingLevel {
  return (
    typeof candidate === "number"
    && Number.isInteger(candidate)
    && candidate >= MIN_HEADING_LEVEL
    && candidate <= MAX_HEADING_LEVEL
  );
}

/**
 * Pure outline builder (§9.2). An entry at level L groups the following
 * deeper entries until an entry with level ≤ L appears. Skipped levels nest
 * directly under the last shallower entry; a later shallower heading starts a
 * new top-level group; earlier branches are never re-parented.
 */
export function buildOutline(headings: readonly Heading[]): readonly HeadingGroup[] {
  const cleanedHeadings = parseOutlineHeadings(headings);

  const topGroups: HeadingGroupDraft[] = [];
  const openGroups: HeadingGroupDraft[] = [];
  for (const entry of cleanedHeadings) {
    const group: HeadingGroupDraft = { id: entry.id, title: entry.title, level: entry.level, children: [] };
    // The nearest preceding group shallower than this entry becomes its parent.
    while (openGroups.length > 0) {
      const openGroup = openGroups[openGroups.length - 1];
      if (openGroup.level < group.level) break;
      openGroups.pop();
    }
    if (openGroups.length === 0) topGroups.push(group);
    else openGroups[openGroups.length - 1].children.push(group);
    openGroups.push(group);
  }
  return topGroups;
}

/**
 * Outline boundary: parse consumer-supplied entries once (§9.2); discovery
 * output already satisfies it. Returns the entries in input order with
 * cleaned titles, so grouping above never re-cleans or re-validates.
 */
function parseOutlineHeadings(headings: readonly Heading[]): readonly CleanedHeading[] {
  const cleanedHeadings: CleanedHeading[] = [];
  const seenIds = new Set<string>();
  for (const entry of headings) {
    if (!isValidTargetId(entry.id)) throw new Error(INVALID_OUTLINE_ID_MESSAGE_PREFIX + String(entry.id));
    if (!isHeadingLevelValue(entry.level)) throw new Error(INVALID_OUTLINE_LEVEL_MESSAGE);
    // A JS caller can supply junk inside typed fields; reject a non-string
    // title explicitly before cleaning runs, so no TypeError escapes (§9.2).
    if (typeof entry.title !== "string") throw new Error(INVALID_OUTLINE_TITLE_MESSAGE);
    const cleanedTitle = cleanHeadingTitle(entry.title);
    if (seenIds.has(entry.id)) throw new Error(DUPLICATE_OUTLINE_ID_MESSAGE_PREFIX + entry.id);
    cleanedHeadings.push({ id: entry.id, title: cleanedTitle, level: entry.level });
    seenIds.add(entry.id);
  }
  return cleanedHeadings;
}

/**
 * The tracking-source lanes of `TocRootProps` (§4.1, §8.3): exactly one is
 * present, so the union makes the absent lane unrepresentable.
 */
export type TocTrackingSource =
  | { lane: "targetIds"; targetIds: readonly string[] }
  | { lane: "headings"; targetIds: readonly string[]; outline: readonly HeadingGroup[] };

/**
 * Tracking-source boundary (§4.1, §10): parse the Root's lane props once at
 * the root render commit. The `targetIds` lane runs `parseTargetCollection`
 * and owns no outline; the `headings` lane runs `buildOutline` — the single
 * validator for entry shapes (no second parse over the derived ids) — and
 * derives the flat collection from the same entries. Check order: the
 * two-lanes error precedes the absent-lane error, and lane discrimination
 * precedes per-lane parsing.
 */
export function parseTrackingSource(props: {
  targetIds?: readonly string[] | undefined;
  headings?: readonly Heading[] | undefined;
}): TocTrackingSource {
  const { targetIds, headings } = props;
  if (targetIds !== undefined && headings !== undefined) throw new Error(INVALID_TRACKING_SOURCE_MESSAGE);
  if (targetIds !== undefined) return { lane: "targetIds", targetIds: parseTargetCollection(targetIds) };
  if (headings !== undefined) {
    const outline = buildOutline(headings);
    return {
      lane: "headings",
      // Grouping validated every id already, so the derived collection is a
      // plain projection; it never re-runs the collection parser.
      targetIds: headings.map((heading) => heading.id),
      outline,
    };
  }
  throw new Error(INVALID_TRACKING_SOURCE_MESSAGE);
}

/** Document-order heading snapshot with cleaned titles and no layout reads (§9.1). */
export function discoverHeadings(
  scope: Element,
  options?: { levels?: readonly HeadingLevel[] },
): readonly Heading[] {
  const selectedLevels = readDiscoveryLevels(options);
  const selectedLevelSet = new Set<HeadingLevel>(selectedLevels);
  const seenIds = new Set<string>();
  const headings: Heading[] = [];

  const headingElements = scope.querySelectorAll(HEADINGS_SELECTOR);
  for (const headingElement of headingElements) {
    const level = HEADING_LEVEL_BY_TAG_NAME[headingElement.tagName.toUpperCase()];
    if (level === undefined) continue;
    if (!selectedLevelSet.has(level)) continue;

    const id = headingElement.getAttribute("id");
    if (!isValidTargetId(id)) throw new Error(INVALID_DISCOVERY_ID_MESSAGE_PREFIX + String(id));
    if (seenIds.has(id)) throw new Error(DUPLICATE_DISCOVERY_ID_MESSAGE_PREFIX + id);
    seenIds.add(id);

    const fragments: string[] = [];
    collectTitleText(headingElement, fragments);
    const title = cleanHeadingTitle(fragments.join(""));
    headings.push({ id, title, level });
  }
  return headings;
}

function readDiscoveryLevels(options?: { levels?: readonly HeadingLevel[] }): readonly HeadingLevel[] {
  const levels = options?.levels;
  if (levels === undefined) return DEFAULT_DISCOVERY_LEVELS;
  if (!Array.isArray(levels)) throw new Error(INVALID_DISCOVERY_LEVEL_MESSAGE);
  for (const value of levels) {
    if (!isHeadingLevelValue(value)) throw new Error(INVALID_DISCOVERY_LEVEL_MESSAGE);
  }
  // An empty list selects nothing and yields an empty result (§9.1).
  return levels;
}

/**
 * Collects the heading's visible text: descendants marked `hidden` or
 * `aria-hidden="true"` and `script`/`style` descendants are excluded with
 * their whole subtree; comments contribute nothing. This is the only
 * content read of a heading element; nothing is measured (§9.1).
 */
function collectTitleText(element: Element, fragments: string[]): void {
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      fragments.push(child.nodeValue ?? "");
      continue;
    }
    if (!(child instanceof Element)) continue;
    const isAttributeHidden = child.hasAttribute("hidden") || child.getAttribute("aria-hidden") === "true";
    if (isAttributeHidden || TITLE_EXCLUDED_TAG_NAMES.has(child.tagName.toLowerCase())) continue;
    collectTitleText(child, fragments);
  }
}

/**
 * Client-side outline snapshot for consumers (§9.3): discovers the headings
 * of `scope` in a layout effect, one snapshot per scope identity, and groups
 * them through `buildOutline` (§9.2). A `null` scope and every server render
 * yield the empty pair: the module reads no DOM outside effect callbacks
 * (§12). Scope is the only input; options stay on `discoverHeadings`, so a
 * scope identity change is the only re-discovery trigger. Content that
 * mutates under the same element needs an explicit re-discovery (§9.1).
 */
export function useTocOutline(scope: Element | null): {
  headings: readonly Heading[];
  outline: readonly HeadingGroup[];
} {
  const [headings, setHeadings] = React.useState<readonly Heading[]>(EMPTY_HEADINGS);

  // Detachment is a state, not a stale snapshot: a null scope yields the
  // empty pair instead of the previous heading list.
  useIsoLayoutEffect(() => {
    if (scope === null) {
      setHeadings(EMPTY_HEADINGS);
      return;
    }
    setHeadings(discoverHeadings(scope));
  }, [scope]);

  const outline = React.useMemo(() => buildOutline(headings), [headings]);

  return { headings, outline };
}

const TocRootContext = React.createContext<TocRootContextValue | undefined>(undefined);

/**
 * Root-owned tracker: resolves targets, measures one geometry sample per
 * scheduled update (§7), applies the pure selection step, and publishes
 * change-only notifications. Effects never run during render; the initial
 * `currentId` is `null` so server and first client render match (§12).
 */
function useTocTracker(trackerProps: {
  targetIds: readonly string[];
  scrollElement: Element | null | undefined;
  activationOffset: number;
  onCurrentChange: ((currentId: string | null) => void) | undefined;
  actionsRef: React.RefObject<TocActions | null> | undefined;
}): { currentId: string | null; navElementRef: React.RefObject<HTMLElement | null> } {
  const { targetIds, scrollElement, activationOffset, onCurrentChange, actionsRef } = trackerProps;

  const navElementRef = React.useRef<HTMLElement | null>(null);
  const currentIdRef = React.useRef<string | null>(null);
  // The last configuration commit; measurements read this instead of
  // render-captured values so a question asked by a scroll event between
  // the reads and the state write always sees committed props. The lazy
  // initialization also skips a fresh basket allocation on every render.
  const committedPropsRef = useRefWithInit(() => ({ targetIds, scrollElement, activationOffset }));

  // Scheduled work is coalesced into at most one measurement per animation
  // frame (§7): request() clears any previously scheduled call, and
  // cancel() is idempotent, so the commit-effect cleanups below can cancel
  // pending work without knowing whether a frame already fired.
  const raf = useAnimationFrame();

  const [currentId, setCurrentIdState] = React.useState<string | null>(null);

  // Replacing the callback identity must not re-notify (§7). The stable
  // trampoline is undefined-safe, so an absent consumer callback is a no-op.
  const notifyCurrentIdChange = useStableCallback(onCurrentChange);

  // Change-only publication (§7): identical values cause no state write and
  // no notification.
  const publishCurrentId = useStableCallback((nextId: string | null) => {
    if (currentIdRef.current === nextId) return;
    currentIdRef.current = nextId;
    setCurrentIdState(nextId);
    notifyCurrentIdChange(nextId);
  });

  // One scheduled update resolves configured IDs again and reads current
  // rectangles; there is no position cache and no invalidation system (§7).
  const measureAndPublish = React.useCallback(() => {
    const { targetIds: committedTargetIds, scrollElement: committedScrollElement, activationOffset: committedOffsetPx } = committedPropsRef.current;
    const navElement = navElementRef.current;
    // Unreachable: the scheduler runs only while an active nav element is
    // mounted, and cleanup cancels pending work before the element detaches.
    if (navElement === null) return;

    const doc = navElement.ownerDocument;

    // Tracking is inactive (scrollElement null, §5). refresh() may still be
    // called in this state, so the request skips quietly; the commit effect
    // owns the §4.5 transitions.
    if (committedScrollElement === null) return;

    const docElement = doc.documentElement;
    let surfaceElement: Element | null = null;
    // Viewport headroom reads the raw viewport top; element headroom cancels
    // the surface translation (§6). One variable carries both forms.
    let surfaceTopPx = 0;
    let hasSurfaceBottomReached = false;

    // The document's root element tracks as the viewport (§5, §6); the mode
    // note at the commit effect owns the full rationale.
    if (committedScrollElement === undefined || committedScrollElement === docElement) {
      // Viewport mode (§6): the layout viewport's top edge is 0, and the
      // bottom exception needs the document viewport's overflow state.
      const view = doc.defaultView;
      // A document without a window cannot be measured, and tracking is
      // inactive there (§4.5): publish null instead of keeping a stale value.
      if (view === null) {
        publishCurrentId(null);
        return;
      }
      hasSurfaceBottomReached =
        docElement.scrollHeight > docElement.clientHeight
        && view.scrollY >= docElement.scrollHeight - docElement.clientHeight - BOTTOM_MAX_SCROLL_TOLERANCE_PX;
    } else {
      // Element mode: no usable layout box leaves tracking inactive until a
      // later event observes a box (§5, §4.5); publishing null is immediate.
      if (committedScrollElement.clientHeight <= 0) {
        publishCurrentId(null);
        return;
      }
      surfaceElement = committedScrollElement;
      // The surface top edge is the client-area top edge, not the border-box
      // top: clientTop is the border-top width in px. Integer rounding at
      // fractional borders is acceptable (§6).
      surfaceTopPx = committedScrollElement.getBoundingClientRect().top + committedScrollElement.clientTop;
      hasSurfaceBottomReached =
        committedScrollElement.scrollHeight > committedScrollElement.clientHeight
        && committedScrollElement.scrollTop >= committedScrollElement.scrollHeight - committedScrollElement.clientHeight - BOTTOM_MAX_SCROLL_TOLERANCE_PX;
    }

    const targetsGeometry: TocTargetGeometry[] = [];
    for (const targetId of committedTargetIds) {
      const targetElement = doc.getElementById(targetId);
      if (targetElement === null) {
        targetsGeometry.push({ id: targetId, headroomPx: null });
        continue;
      }
      // Ownership (§5): a resolved target outside its scroller is a
      // configuration error, thrown while the measurement runs (§10). The
      // target must be a proper DOM descendant: contains() is inclusive, so
      // the scroller element itself is excluded.
      if (surfaceElement !== null) {
        const isTargetOwnedByScroller = targetElement !== surfaceElement && surfaceElement.contains(targetElement);
        if (!isTargetOwnedByScroller) throw new Error(OWNERSHIP_ERROR_MESSAGE);
      }
      const targetRect = targetElement.getBoundingClientRect();
      const headroomPx = targetElement.getClientRects().length > 0 ? targetRect.top - surfaceTopPx : null;
      targetsGeometry.push({ id: targetId, headroomPx });
    }

    publishCurrentId(
      selectCurrentTargetId({ targets: targetsGeometry, activationOffsetPx: committedOffsetPx, hasSurfaceBottomReached }),
    );
  }, [publishCurrentId]);

  // Coalescing (§7) comes from request(): it clears the previous call
  // instead of stacking frames.
  const scheduleMeasurement = React.useCallback(() => {
    raf.request(measureAndPublish);
  }, [measureAndPublish, raf]);

  // refresh() re-resolves targets and remeasures, coalescing like any other
  // scheduled update; it returns nothing and never scrolls (§8.3). The
  // handle attaches after commit; unmount nulls it without touching newer
  // handles.
  useIsoLayoutEffect(() => {
    if (actionsRef === undefined) return;
    const actions: TocActions = { refresh: scheduleMeasurement };
    actionsRef.current = actions;
    return () => {
      if (actionsRef.current === actions) actionsRef.current = null;
    };
  }, [actionsRef, scheduleMeasurement]);

  // The configuration commit: §4.5 immediate-null transitions, listener
  // wiring for the one tracked surface, and one coalesced measurement (§7.4).
  useIsoLayoutEffect(() => {
    // Immediate transitions (§4.5): a former current ID that left the
    // collection, an emptied collection, and an inactive surface publish
    // null without waiting for a measurement.
    if (scrollElement === null) publishCurrentId(null);
    else if (currentIdRef.current !== null && !targetIds.includes(currentIdRef.current)) publishCurrentId(null);

    committedPropsRef.current = { targetIds, scrollElement, activationOffset };

    // Inactive tracking owns no listeners and schedules nothing (§5, §12).
    if (scrollElement === null) return;
    // First client commit schedules the initial measurement (§7.1).
    scheduleMeasurement();

    const navElement = navElementRef.current;
    // Unreachable: refs attach before layout effects, and the nav element
    // always renders.
    if (navElement === null) return;
    const doc = navElement.ownerDocument;

    // Viewport mode covers an omitted `scrollElement` and also the tracking
    // document's root element. Per CSSOM View, root-scroller `scroll` events
    // target the Document, so a listener on `documentElement` never fires,
    // and `documentElement`'s bounding-rect top is the document origin, not
    // the viewport top. The root element therefore tracks exactly like the
    // omitted element (§5, §6), and element-mode ownership never applies.
    if (scrollElement === undefined || scrollElement === doc.documentElement) {
      // Viewport mode: the layout viewport's scroll and resize (§7.2–7.3).
      const view = doc.defaultView;
      // A document without a window cannot carry listeners, and tracking is
      // inactive there (§4.5): publish null instead of keeping a stale value.
      if (view === null) {
        publishCurrentId(null);
        return;
      }
      const detachScrollEvent = addEventListener(view, "scroll", scheduleMeasurement, { passive: true });
      const detachResizeEvent = addEventListener(view, "resize", scheduleMeasurement);
      return () => {
        detachScrollEvent();
        detachResizeEvent();
        raf.cancel();
      };
    }

    // Element mode: the scroller's scroll and its box resizes (§7.2–7.3).
    // No usable box at commit leaves tracking inactive right away (§4.5).
    if (scrollElement.clientHeight <= 0) publishCurrentId(null);
    const detachScrollEvent = addEventListener(scrollElement, "scroll", scheduleMeasurement, { passive: true });
    const surfaceObserver = new ResizeObserver(() => {
      // The 0→size box transition reactivates tracking; a lost box
      // deactivates it immediately (§7.3, §4.5).
      if (scrollElement.clientHeight > 0) scheduleMeasurement();
      else publishCurrentId(null);
    });
    surfaceObserver.observe(scrollElement);
    return () => {
      detachScrollEvent();
      surfaceObserver.disconnect();
      raf.cancel();
    };
  }, [activationOffset, publishCurrentId, raf, scheduleMeasurement, scrollElement, targetIds]);

  return { currentId, navElementRef };
}

// The shared composition interface (§8.2): native props merge, consumer
// handlers run first, and className/style accept state-function forms.
// React 19 delivers `ref` inside the props object, and these interfaces
// carry it through `ComponentPropsWithRef`. Each part destructures `ref`
// and passes it to `useRenderElement`'s `ref` param: `mergeProps` ignores
// `ref`, so an unde-structured ref would be silently dropped.
type TocCompositionProps<ElementType extends React.ElementType, State, OmittedKeys extends string = never> = Omit<
  React.ComponentPropsWithRef<ElementType>,
  "className" | "style" | OmittedKeys
> & {
  className?: string | ((state: State) => string | undefined) | undefined;
  render?: React.ReactElement | ComponentRenderFn<HTMLProps, State> | undefined;
  style?: React.CSSProperties | ((state: State) => React.CSSProperties | undefined) | undefined;
};

/** Root props (§8.3). */
export interface TocRootProps extends TocCompositionProps<"nav", TocRootState> {
  /**
   * Ordered destination IDs (§4.1–§4.3) — the `targetIds` lane. Mutually
   * exclusive with `headings`: exactly one lane is provided (§10). Immutable
   * snapshot; replace to reconfigure.
   */
  targetIds?: readonly string[] | undefined;
  /**
   * Flat heading entries (§9.1) — the `headings` lane. Mutually exclusive
   * with `targetIds` (§10). Root derives the flat collection from the entry
   * ids and builds the outline through `buildOutline` (§9.2).
   */
  headings?: readonly Heading[] | undefined;
  /** The tracked scrolling surface. Omit for the document viewport; `null` deactivates tracking (§5). */
  scrollElement?: Element | null | undefined;
  /** CSS pixels below the surface top edge that count as "reached" (§6). */
  activationOffset?: number | undefined;
  /** Change-only notification of the current target ID (§7). */
  onCurrentChange?: ((currentId: string | null) => void) | undefined;
  /** Receives `{ refresh(): void }` (§8.3). */
  actionsRef?: React.RefObject<TocActions | null> | undefined;
}

// Root state mapping: `currentId` must not emit a `data-current-id`
// attribute; the root exposes `data-has-current` instead (§8.3).
const TOC_ROOT_STATE_ATTRIBUTES_MAPPING = { currentId: () => null };

/**
 * The tracked navigation landmark (§8.3). Owns the tracker, coalescing, and
 * notifications; renders a `<nav>` with a default label consumers can
 * override through `aria-label`/`aria-labelledby`.
 */
export function TocRoot(componentProps: TocRootProps) {
  const {
    targetIds,
    headings,
    scrollElement,
    activationOffset = 0,
    onCurrentChange,
    actionsRef,
    className,
    style,
    render,
    ref,
    ...elementProps
  } = componentProps;

  // Input boundaries (§4.3, §10): synchronous throws at the root render
  // commit. Parsing once per render keeps the commit effect's dependency
  // identity (§7.4): the parsed collection is fresh only when its source
  // prop value is, and the headings lane derives its collection and outline
  // on the same `headings` identity.
  const trackedSource = React.useMemo(
    () => parseTrackingSource({ targetIds, headings }),
    [targetIds, headings],
  );
  const parsedActivationOffset = parseActivationOffset(activationOffset);

  const tracker = useTocTracker({
    targetIds: trackedSource.targetIds,
    scrollElement,
    activationOffset: parsedActivationOffset,
    onCurrentChange,
    actionsRef,
  });

  const contextValue: TocRootContextValue = React.useMemo(
    () => ({
      targetIds: trackedSource.targetIds,
      outline: trackedSource.lane === "headings" ? trackedSource.outline : null,
      currentId: tracker.currentId,
    }),
    [trackedSource, tracker.currentId],
  );

  const state: TocRootState = { currentId: tracker.currentId };

  const renderedElement = useRenderElement<TocRootState, HTMLElement, "nav">("nav", componentProps, {
    state,
    ref: [ref, tracker.navElementRef],
    stateAttributesMapping: TOC_ROOT_STATE_ATTRIBUTES_MAPPING,
    props: [
      DEFAULT_ROOT_LABEL_PROPS,
      elementProps,
      (props) => ({
        ...props,
        "data-slot": TOC_ROOT_SLOT,
        "data-has-current": state.currentId !== null ? "" : undefined,
      }),
    ],
  });

  // The provider wraps the tracked elements; unmounting a presentation never
  // changes what is tracked (§4.1).
  return <TocRootContext.Provider value={contextValue}>{renderedElement}</TocRootContext.Provider>;
}

/** List props (§8.4): structural part with an empty state; function children map the Root-owned outline. */
export interface TocListProps extends TocCompositionProps<"ol", TocListState, "children"> {
  /**
   * Plain children render consumer-authored content as-is (§8.4). A function
   * child receives one outline group per call (Select.Value shape) and maps
   * the `headings` lane's outline onto the `<ol>` (§8.4); keys stay
   * consumer-authored.
   */
  children?: React.ReactNode | ((group: HeadingGroup) => React.ReactNode) | undefined;
}

/** An ordered list level of the outline structure (§8.4). */
export function TocList(componentProps: TocListProps) {
  const rootContext = React.useContext(TocRootContext);
  const { className, style, render, ref, children: childrenProp, ...elementProps } = componentProps;

  // Plain children pass through untouched in both lanes and outside any
  // Root. A function child maps the Root-owned outline (§8.4), so the
  // `targetIds` lane — which owns no outline — is a configuration error.
  let children = childrenProp;
  if (typeof children === "function") {
    // The callback reads a const, not the reassigned `children` binding.
    const renderGroup = children;
    const outline = rootContext === undefined ? null : rootContext.outline;
    if (outline === null) throw new Error(INVALID_LIST_FUNCTION_CHILDREN_MESSAGE);
    children = outline.map((group) => renderGroup(group));
  }

  return useRenderElement<TocListState, HTMLOListElement, "ol">("ol", componentProps, {
    state: EMPTY_TOC_STATE,
    ref,
    props: [
      elementProps,
      (props) => ({ ...props, "data-slot": TOC_LIST_SLOT, children }),
    ],
  });
}

/** Item props (§8.4): structural part with an empty state. */
export interface TocItemProps extends TocCompositionProps<"li", TocItemState> {}

/** An entry of the outline structure (§8.4); nesting is the consumer's list structure. */
export function TocItem(componentProps: TocItemProps) {
  const { className, style, render, ref, ...elementProps } = componentProps;

  return useRenderElement<TocItemState, HTMLLIElement, "li">("li", componentProps, {
    state: EMPTY_TOC_STATE,
    ref,
    props: [
      elementProps,
      (props) => ({ ...props, "data-slot": TOC_ITEM_SLOT }),
    ],
  });
}

/** Link props (§8.4): component-owned `href`/`aria-current` cannot be re-set by typed consumers (§4.4). */
export interface TocLinkProps extends TocCompositionProps<"a", TocLinkState, "href" | "aria-current"> {
  /** The canonical target ID (§4.4): must be valid and a member of the root collection (§10). */
  targetId: string;
}

/**
 * A native fragment link to one configured target (§8.5). Component-owned
 * `href` and `aria-current` win over conflicting consumer values at runtime
 * (§4.4); consumer handlers stay merged on the link.
 */
export function TocLink(componentProps: TocLinkProps) {
  const rootContext = React.useContext(TocRootContext);
  const { targetId, className, style, render, ref, ...elementProps } = componentProps;

  // Boundaries (§10): identity first, then context, then membership.
  if (!isValidTargetId(targetId)) throw new Error(INVALID_TARGET_ID_ON_LINK_MESSAGE);
  if (rootContext === undefined) throw new Error(LINK_OUTSIDE_ROOT_MESSAGE);
  if (!rootContext.targetIds.includes(targetId)) throw new Error(LINK_NOT_IN_COLLECTION_MESSAGE_PREFIX + targetId);

  const state: TocLinkState = { current: rootContext.currentId === targetId };

  return useRenderElement<TocLinkState, HTMLAnchorElement, "a">("a", componentProps, {
    state,
    ref,
    // The component owns the fragment encoding and the current marker (§4.4);
    // the last member keeps both beating conflicting consumer values.
    props: [
      elementProps,
      (props) => ({
        ...props,
        "data-slot": TOC_LINK_SLOT,
        href: `#${encodeURIComponent(targetId)}`,
        "aria-current": state.current ? ARIA_CURRENT_LOCATION : undefined,
      }),
    ],
  });
}
