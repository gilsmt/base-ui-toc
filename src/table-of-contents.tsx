"use client";

import * as React from "react";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentRenderFn, HTMLProps } from "@base-ui/react/use-render";
import { mergePropsN } from "@base-ui/react/merge-props";
import { addEventListener } from "@base-ui/utils/addEventListener";
import { useIsoLayoutEffect } from "@base-ui/utils/useIsoLayoutEffect";
import { useStableCallback } from "@base-ui/utils/useStableCallback";

/**
 * An unstyled in-page navigation component. `TocRoot` tracks one current
 * location in a scrolling surface (§6); `TocList`, `TocItem`, and `TocLink`
 * compose native fragment links over it. `discoverHeadings` and
 * `buildOutline` supply the target collection and presentational nesting.
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

const INVALID_TARGET_ID_ON_LINK_MESSAGE = "Invalid targetId on TocLink: it must be a valid target ID.";

const LINK_OUTSIDE_ROOT_MESSAGE = "TocLink must render inside a TocRoot.";

const LINK_NOT_IN_COLLECTION_MESSAGE_PREFIX = "targetId is not in the root collection: ";

const OWNERSHIP_ERROR_MESSAGE = "Toc target resolves outside its configured scroller. Targets in element mode must be DOM descendants of the scroller.";

const INVALID_DISCOVERY_LEVEL_MESSAGE = "Invalid levels option: values must be integers from 1 to 6.";

const INVALID_DISCOVERY_ID_MESSAGE_PREFIX = "Invalid target ID on heading: ";

const DUPLICATE_DISCOVERY_ID_MESSAGE_PREFIX = "Duplicate heading ID: ";

const EMPTY_DISCOVERY_TITLE_MESSAGE = "Heading title is empty after cleaning excluded content and whitespace.";

const INVALID_OUTLINE_ID_MESSAGE_PREFIX = "Invalid heading ID in buildOutline input: ";

const INVALID_OUTLINE_LEVEL_MESSAGE = "Invalid heading level in buildOutline input: it must be an integer from 1 to 6.";

const INVALID_OUTLINE_TITLE_MESSAGE = "Invalid heading title in buildOutline input: it must be a string.";

const DUPLICATE_OUTLINE_ID_MESSAGE_PREFIX = "Duplicate heading ID in buildOutline input: ";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface Heading {
  id: string;
  title: string;
  level: HeadingLevel;
}

export type HeadingGroup = Heading & { children: readonly HeadingGroup[] };

// The same node shape with mutable children, used while the outline builds;
// the returned trees still satisfy HeadingGroup.
type HeadingGroupDraft = Heading & { children: HeadingGroupDraft[] };

// Grid of one measurement: injected into the pure selection step so the
// crossing rule stays testable without a DOM (§16.1).
export type TocTargetGeometry = {
  id: string;
  /** Pixels from the surface top edge down to the target's top edge; `null` when the target is unavailable (§4.6, §6). */
  headroomPx: number | null;
};

export type TocGeometrySample = {
  targets: readonly TocTargetGeometry[];
  activationOffsetPx: number;
  hasSurfaceBottomReached: boolean;
};

// State types are `type` aliases: `useRender` rejects interfaces here.
export type TocRootState = { currentId: string | null };

export type TocLinkState = { current: boolean };

export type TocListState = Record<string, never>;

export type TocItemState = Record<string, never>;

const TOC_ROOT_SLOT = "toc-root";
const TOC_LIST_SLOT = "toc-list";
const TOC_ITEM_SLOT = "toc-item";
const TOC_LINK_SLOT = "toc-link";

// TocList and TocItem share one empty state; it carries no attributes.
const EMPTY_TOC_STATE: TocListState = {};

export interface TocActions {
  refresh(): void;
}

/** A valid target ID is non-empty, holds no ASCII whitespace, and holds no unpaired surrogate (§4.2). */
export function isValidTargetId(candidate: unknown): candidate is string {
  if (typeof candidate !== "string") return false;
  if (candidate === "") return false;
  if (ASCII_WHITESPACE_PATTERN.test(candidate)) return false;
  return !UNPAIRED_SURROGATE_PATTERN.test(candidate);
}

/** Collection boundary: every entry must be a valid target ID and unique (§4.3). */
export function validateTargetCollection(targetIds: readonly unknown[]): void {
  const seenIds = new Set<string>();
  for (const candidate of targetIds) {
    if (!isValidTargetId(candidate)) throw new Error(INVALID_COLLECTION_MESSAGE);
    if (seenIds.has(candidate)) throw new Error(DUPLICATE_TARGET_MESSAGE_PREFIX + candidate);
    seenIds.add(candidate);
  }
}

/** The activation line offset is a non-negative, finite CSS-pixel number (§6). */
export function isValidActivationOffset(candidate: unknown): boolean {
  return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0;
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

/** Outline boundary: validate consumer-supplied entries once (§9.2); discovery output already satisfies this. */
function validateOutlineHeadings(headings: readonly Heading[]): void {
  const seenIds = new Set<string>();
  for (const entry of headings) {
    if (!isValidTargetId(entry.id)) throw new Error(INVALID_OUTLINE_ID_MESSAGE_PREFIX + String(entry.id));
    if (!isHeadingLevelValue(entry.level)) throw new Error(INVALID_OUTLINE_LEVEL_MESSAGE);
    // A JS caller can supply junk inside typed fields; reject a non-string
    // title explicitly before cleaning runs, so no TypeError escapes (§9.2).
    if (typeof entry.title !== "string") throw new Error(INVALID_OUTLINE_TITLE_MESSAGE);
    cleanHeadingTitle(entry.title);
    if (seenIds.has(entry.id)) throw new Error(DUPLICATE_OUTLINE_ID_MESSAGE_PREFIX + entry.id);
    seenIds.add(entry.id);
  }
}

/**
 * Pure outline builder (§9.2). An entry at level L groups the following
 * deeper entries until an entry with level ≤ L appears. Skipped levels nest
 * directly under the last shallower entry; a later shallower heading starts a
 * new top-level group; earlier branches are never re-parented.
 */
export function buildOutline(headings: readonly Heading[]): readonly HeadingGroup[] {
  validateOutlineHeadings(headings);

  const topGroups: HeadingGroupDraft[] = [];
  const openGroups: HeadingGroupDraft[] = [];
  for (const entry of headings) {
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

const TocRootContext = React.createContext<TocRootContextValue | undefined>(undefined);

type TocRootContextValue = {
  /** Ordered destination IDs of the owning Root (§4.1); identity is the committed prop value. */
  targetIds: readonly string[];
  /** The current location this Root tracks; `null` before the first crossing (§6). */
  currentId: string | null;
};

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
  const frameRequestRef = React.useRef<number | null>(null);
  // The last configuration commit; measurements read this instead of
  // render-captured values so a question asked by a scroll event between
  // the reads and the state write always sees committed props.
  const committedPropsRef = React.useRef({ targetIds, scrollElement, activationOffset });

  const [currentId, setCurrentIdState] = React.useState<string | null>(null);

  // A stable wrapper: replacing the callback identity must not re-notify (§7).
  const notifyCurrentIdChange = useStableCallback((changedId: string | null) => {
    onCurrentChange?.(changedId);
  });

  // Change-only publication (§7): identical values cause no state write and
  // no notification.
  const publishCurrentId = useStableCallback((nextId: string | null) => {
    if (currentIdRef.current === nextId) return;
    currentIdRef.current = nextId;
    setCurrentIdState(nextId);
    notifyCurrentIdChange(nextId);
  });

  const cancelPendingMeasurement = React.useCallback(() => {
    const pendingFrame = frameRequestRef.current;
    if (pendingFrame !== null) {
      cancelAnimationFrame(pendingFrame);
      frameRequestRef.current = null;
    }
  }, []);

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

  // Scheduled work is coalesced: at most one measurement per animation frame (§7).
  const scheduleMeasurement = React.useCallback(() => {
    if (frameRequestRef.current !== null) return;
    frameRequestRef.current = requestAnimationFrame(() => {
      frameRequestRef.current = null;
      measureAndPublish();
    });
  }, [measureAndPublish]);

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
        cancelPendingMeasurement();
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
      cancelPendingMeasurement();
    };
  }, [activationOffset, cancelPendingMeasurement, publishCurrentId, scheduleMeasurement, scrollElement, targetIds]);

  return { currentId, navElementRef };
}

// The shared composition interface (§8.2): native props merge, consumer
// handlers run first, and className/style accept state-function forms.
type TocCompositionProps<ElementType extends React.ElementType, State, OmittedKeys extends string = never> = Omit<
  React.ComponentPropsWithRef<ElementType>,
  "className" | "style" | OmittedKeys
> & {
  className?: string | ((state: State) => string | undefined) | undefined;
  render?: React.ReactElement | ComponentRenderFn<HTMLProps, State> | undefined;
  style?: React.CSSProperties | ((state: State) => React.CSSProperties | undefined) | undefined;
};

// Fresh object literals carrying data-* attributes are rejected by
// excess-property checks, so merge-arg values flow through this widened
// element-props type: element props plus an unknown-key index signature.
type TocElementProps<ElementType extends React.ElementType> =
  React.ComponentPropsWithRef<ElementType> & Record<string, unknown>;

/** Root props (§8.3). */
export interface TocRootProps extends TocCompositionProps<"nav", TocRootState> {
  /** Ordered destination IDs (§4.1–§4.3). Immutable snapshot; replace to reconfigure. */
  targetIds: readonly string[];
  /** The tracked scrolling surface. Omit for the document viewport; `null` deactivates tracking (§5). */
  scrollElement?: Element | null | undefined;
  /** CSS pixels below the surface top edge that count as "reached" (§6). */
  activationOffset?: number | undefined;
  /** Change-only notification of the current target ID (§7). */
  onCurrentChange?: ((currentId: string | null) => void) | undefined;
  /** Receives `{ refresh(): void }` (§8.3). */
  actionsRef?: React.RefObject<TocActions | null> | undefined;
}

/** List props (§8.4): structural part with an empty state. */
export interface TocListProps extends TocCompositionProps<"ol", TocListState> {}

/** Item props (§8.4): structural part with an empty state. */
export interface TocItemProps extends TocCompositionProps<"li", TocItemState> {}

/** Link props (§8.4): component-owned `href`/`aria-current` cannot be re-set by typed consumers (§4.4). */
export interface TocLinkProps extends TocCompositionProps<"a", TocLinkState, "href" | "aria-current"> {
  /** The canonical target ID (§4.4): must be valid and a member of the root collection (§10). */
  targetId: string;
}

function resolveClassName<State>(
  classNameValue: string | ((state: State) => string | undefined) | undefined,
  state: State,
): string | undefined {
  return typeof classNameValue === "function" ? classNameValue(state) : classNameValue;
}

function resolveStyle<State>(
  styleValue: React.CSSProperties | ((state: State) => React.CSSProperties | undefined) | undefined,
  state: State,
): React.CSSProperties | undefined {
  return typeof styleValue === "function" ? styleValue(state) : styleValue;
}

// Root state mapping: `currentId` must not emit a `data-current-id`
// attribute; the root exposes `data-has-current` instead (§8.3).
const TOC_ROOT_STATE_ATTRIBUTES_MAPPING = { currentId: () => null };

/**
 * The tracked navigation landmark (§8.3). Owns the tracker, coalescing, and
 * notifications; renders a `<nav>` with a default label consumers can
 * override through `aria-label`/`aria-labelledby`.
 */
export const TocRoot: React.ForwardRefExoticComponent<Omit<TocRootProps, "ref"> & React.RefAttributes<HTMLElement>> = React.forwardRef<HTMLElement, TocRootProps>(
  function TocRoot(componentProps, forwardedRef) {
    const {
      targetIds,
      scrollElement,
      activationOffset = 0,
      onCurrentChange,
      actionsRef,
      className,
      style,
      render,
      ...elementProps
    } = componentProps;

    const tracker = useTocTracker({ targetIds, scrollElement, activationOffset, onCurrentChange, actionsRef });

    // Input boundaries (§4.3, §10): synchronous throws at the root render commit.
    validateTargetCollection(targetIds);
    if (!isValidActivationOffset(activationOffset)) throw new Error(INVALID_ACTIVATION_OFFSET_MESSAGE);

    const contextValue: TocRootContextValue = React.useMemo(
      () => ({ targetIds, currentId: tracker.currentId }),
      [targetIds, tracker.currentId],
    );

    const state: TocRootState = { currentId: tracker.currentId };
    const resolvedClassNameProps = resolveClassName(className, state);
    const resolvedStyleProps = resolveStyle(style, state);
    const classNameProps = resolvedClassNameProps === undefined ? undefined : { className: resolvedClassNameProps };
    const styleProps = resolvedStyleProps === undefined ? undefined : { style: resolvedStyleProps };
    const rootDataProps: TocElementProps<"nav"> = {
      "data-slot": TOC_ROOT_SLOT,
      "data-has-current": state.currentId !== null ? "" : undefined,
    };

    const renderedElement = useRender<TocRootState, HTMLElement>({
      defaultTagName: "nav",
      render,
      state,
      stateAttributesMapping: TOC_ROOT_STATE_ATTRIBUTES_MAPPING,
      ref: [forwardedRef, tracker.navElementRef],
      props: mergePropsN<"nav">([DEFAULT_ROOT_LABEL_PROPS, elementProps, classNameProps, styleProps, rootDataProps]),
    });

    // The provider wraps the tracked elements; unmounting a presentation never
    // changes what is tracked (§4.1).
    return (
      <TocRootContext.Provider value={contextValue}>{renderedElement}</TocRootContext.Provider>
    );
  },
);

/** An ordered list level of the outline structure (§8.4). */
export const TocList: React.ForwardRefExoticComponent<Omit<TocListProps, "ref"> & React.RefAttributes<HTMLOListElement>> = React.forwardRef<HTMLOListElement, TocListProps>(
  function TocList(componentProps, forwardedRef) {
    const { className, style, render, ...elementProps } = componentProps;

    const state = EMPTY_TOC_STATE;
    const resolvedClassNameProps = resolveClassName(className, state);
    const resolvedStyleProps = resolveStyle(style, state);
    const classNameProps = resolvedClassNameProps === undefined ? undefined : { className: resolvedClassNameProps };
    const styleProps = resolvedStyleProps === undefined ? undefined : { style: resolvedStyleProps };

    const listDataProps: TocElementProps<"ol"> = { "data-slot": TOC_LIST_SLOT };
    return useRender<TocListState, HTMLOListElement>({
      defaultTagName: "ol",
      render,
      state,
      ref: forwardedRef,
      props: mergePropsN<"ol">([elementProps, classNameProps, styleProps, listDataProps]),
    });
  },
);

/** An entry of the outline structure (§8.4); nesting is the consumer's list structure. */
export const TocItem: React.ForwardRefExoticComponent<Omit<TocItemProps, "ref"> & React.RefAttributes<HTMLLIElement>> = React.forwardRef<HTMLLIElement, TocItemProps>(
  function TocItem(componentProps, forwardedRef) {
    const { className, style, render, ...elementProps } = componentProps;

    const state = EMPTY_TOC_STATE;
    const resolvedClassNameProps = resolveClassName(className, state);
    const resolvedStyleProps = resolveStyle(style, state);
    const classNameProps = resolvedClassNameProps === undefined ? undefined : { className: resolvedClassNameProps };
    const styleProps = resolvedStyleProps === undefined ? undefined : { style: resolvedStyleProps };

    const itemDataProps: TocElementProps<"li"> = { "data-slot": TOC_ITEM_SLOT };
    return useRender<TocItemState, HTMLLIElement>({
      defaultTagName: "li",
      render,
      state,
      ref: forwardedRef,
      props: mergePropsN<"li">([elementProps, classNameProps, styleProps, itemDataProps]),
    });
  },
);
/**
 * A native fragment link to one configured target (§8.5). Component-owned
 * `href` and `aria-current` win over conflicting consumer values at runtime
 * (§4.4); consumer handlers stay merged on the link.
 */
export const TocLink: React.ForwardRefExoticComponent<Omit<TocLinkProps, "ref"> & React.RefAttributes<HTMLAnchorElement>> = React.forwardRef<HTMLAnchorElement, TocLinkProps>(
  function TocLink(componentProps, forwardedRef) {
    const rootContext = React.useContext(TocRootContext);
    const { targetId, className, style, render, ...elementProps } = componentProps;

    // Boundaries (§10): identity first, then context, then membership.
    if (!isValidTargetId(targetId)) throw new Error(INVALID_TARGET_ID_ON_LINK_MESSAGE);
    if (rootContext === undefined) throw new Error(LINK_OUTSIDE_ROOT_MESSAGE);
    if (!rootContext.targetIds.includes(targetId)) throw new Error(LINK_NOT_IN_COLLECTION_MESSAGE_PREFIX + targetId);

    const state: TocLinkState = { current: rootContext.currentId === targetId };
    const resolvedClassNameProps = resolveClassName(className, state);
    const resolvedStyleProps = resolveStyle(style, state);
    const classNameProps = resolvedClassNameProps === undefined ? undefined : { className: resolvedClassNameProps };
    const styleProps = resolvedStyleProps === undefined ? undefined : { style: resolvedStyleProps };

    const linkDataProps: TocElementProps<"a"> = {
      "data-slot": TOC_LINK_SLOT,
      // The component owns the fragment encoding (§4.2); a conflicting consumer value loses at runtime (§4.4).
      href: `#${encodeURIComponent(targetId)}`,
      "aria-current": state.current ? ARIA_CURRENT_LOCATION : undefined,
    };
    return useRender<TocLinkState, HTMLAnchorElement>({
      defaultTagName: "a",
      render,
      state,
      ref: forwardedRef,
      props: mergePropsN<"a">([elementProps, classNameProps, styleProps, linkDataProps]),
    });
  },
);

