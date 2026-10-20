"use client";

import * as React from "react";
import { useRenderElement } from "@base-ui/react/internals/useRenderElement";
import type { ComponentRenderFn, HTMLProps } from "@base-ui/react/use-render";
import { addEventListener } from "@base-ui/utils/addEventListener";
import { useAnimationFrame } from "@base-ui/utils/useAnimationFrame";
import { useIsoLayoutEffect } from "@base-ui/utils/useIsoLayoutEffect";
import { useRefWithInit } from "@base-ui/utils/useRefWithInit";
import { useStableCallback } from "@base-ui/utils/useStableCallback";

const MIN_HEADING_LEVEL = 1;
const MAX_HEADING_LEVEL = 6;

const DEFAULT_DISCOVERY_LEVELS: readonly HeadingLevel[] = [2, 3, 4, 5, 6];

const HEADINGS_SELECTOR = "h1, h2, h3, h4, h5, h6";

const HEADING_LEVEL_BY_TAG_NAME: Readonly<
    Record<string, HeadingLevel | undefined>
> = {
    H1: 1,
    H2: 2,
    H3: 3,
    H4: 4,
    H5: 5,
    H6: 6,
};

const TITLE_EXCLUDED_TAG_NAMES: ReadonlySet<string> = new Set([
    "script",
    "style",
]);

const TITLE_WHITESPACE_RUN_PATTERN = /\s+/g;

const ASCII_WHITESPACE_PATTERN = /[\u0009-\u000D\u0020]/;

const UNPAIRED_SURROGATE_PATTERN =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const ARIA_CURRENT_LOCATION = "location";

const DEFAULT_ROOT_LABEL_PROPS = { "aria-label": "Table of contents" };

const BOTTOM_MAX_SCROLL_TOLERANCE_PX = 1;

const INVALID_COLLECTION_MESSAGE =
    "Invalid target ID in targetIds: every entry must be a valid, unique target ID.";

const DUPLICATE_TARGET_MESSAGE_PREFIX = "Duplicate target ID: ";

const INVALID_ACTIVATION_OFFSET_MESSAGE =
    "Invalid activationOffset: it must be a finite, non-negative number.";

const INVALID_TRACKING_SOURCE_MESSAGE =
    "TocRoot receives one tracking source: targetIds or headings.";

const INVALID_TARGET_ID_ON_LINK_MESSAGE =
    "Invalid targetId on TocLink: it must be a valid target ID.";

const LINK_OUTSIDE_ROOT_MESSAGE = "TocLink must render inside a TocRoot.";

const LINK_NOT_IN_COLLECTION_MESSAGE_PREFIX =
    "targetId is not in the root collection: ";

const VALUE_OUTSIDE_ROOT_MESSAGE = "TocValue must render inside a TocRoot.";

const INVALID_LIST_FUNCTION_CHILDREN_MESSAGE =
    "TocList receives function children only when TocRoot owns an outline; pass `headings` to TocRoot.";

const OWNERSHIP_ERROR_MESSAGE =
    "Toc target resolves outside its configured scroller. Targets in element mode must be DOM descendants of the scroller.";

const INVALID_DISCOVERY_LEVEL_MESSAGE =
    "Invalid levels option: values must be integers from 1 to 6.";

const INVALID_DISCOVERY_ID_MESSAGE_PREFIX = "Invalid target ID on heading: ";

const DUPLICATE_DISCOVERY_ID_MESSAGE_PREFIX = "Duplicate heading ID: ";

const EMPTY_HEADING_TITLE_MESSAGE =
    "Heading title is empty after whitespace cleaning.";

const INVALID_OUTLINE_ID_MESSAGE_PREFIX =
    "Invalid heading ID in buildOutline input: ";

const INVALID_OUTLINE_LEVEL_MESSAGE =
    "Invalid heading level in buildOutline input: it must be an integer from 1 to 6.";

const INVALID_OUTLINE_TITLE_MESSAGE =
    "Invalid heading title in buildOutline input: it must be a string.";

const DUPLICATE_OUTLINE_ID_MESSAGE_PREFIX =
    "Duplicate heading ID in buildOutline input: ";

const EMPTY_PART_STATE: Record<string, never> = {};

const EMPTY_HEADINGS: readonly Heading[] = [];

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface Heading {
    id: string;
    title: string;
    level: HeadingLevel;
}

export interface HeadingGroup extends Heading {
    children: readonly HeadingGroup[];
}

// Mutable-children draft node; the returned trees still satisfy HeadingGroup.
interface HeadingGroupDraft extends Heading {
    children: HeadingGroupDraft[];
}

export interface TocTargetGeometry {
    id: string;
    /** Pixels from the surface top edge down to the target's top edge; `null` when the target is unavailable. */
    headroomPx: number | null;
}

export interface TocGeometrySample {
    targets: readonly TocTargetGeometry[];
    activationOffsetPx: number;
    hasSurfaceBottomReached: boolean;
}

// Part states are interfaces because useRenderElement's State must extend Record<string, any>; empty ones stay empty.
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
    targetIds: readonly string[];
    outline: readonly HeadingGroup[] | null;
    currentId: string | null;
}

/** A valid target ID is non-empty and holds no ASCII whitespace or unpaired surrogate. */
export function isValidTargetId(candidate: unknown): candidate is string {
    if (typeof candidate !== "string") return false;
    if (candidate === "") return false;
    if (ASCII_WHITESPACE_PATTERN.test(candidate)) return false;
    return !UNPAIRED_SURROGATE_PATTERN.test(candidate);
}

/** Throws unless every entry is a valid, unique target ID; returns a fresh array. */
export function parseTargetCollection(
    targetIds: readonly unknown[],
): readonly string[] {
    const parsedIds: string[] = [];
    const seenIds = new Set<string>();
    for (const candidate of targetIds) {
        if (!isValidTargetId(candidate))
            throw new Error(INVALID_COLLECTION_MESSAGE);
        if (seenIds.has(candidate))
            throw new Error(DUPLICATE_TARGET_MESSAGE_PREFIX + candidate);
        seenIds.add(candidate);
        parsedIds.push(candidate);
    }
    return parsedIds;
}

/** An activation offset is a non-negative, finite CSS-pixel number. */
export function isValidActivationOffset(
    candidate: unknown,
): candidate is number {
    return (
        typeof candidate === "number" &&
        Number.isFinite(candidate) &&
        candidate >= 0
    );
}

/** Parses an activation offset; throws on an invalid value. */
function parseActivationOffset(candidate: unknown): number {
    if (!isValidActivationOffset(candidate))
        throw new Error(INVALID_ACTIVATION_OFFSET_MESSAGE);
    return candidate;
}

/**
 * Pure selection step: the last crossed target in configured order; when
 * nothing crossed and the bottom is reached, the last available target.
 */
export function selectCurrentTargetId(
    sample: TocGeometrySample,
): string | null {
    let lastCrossedId: string | null = null;
    let lastAvailableId: string | null = null;
    for (const target of sample.targets) {
        if (target.headroomPx === null) continue;
        lastAvailableId = target.id;
        if (target.headroomPx <= sample.activationOffsetPx)
            lastCrossedId = target.id;
    }
    if (lastCrossedId !== null) return lastCrossedId;
    if (sample.hasSurfaceBottomReached) return lastAvailableId;
    return null;
}

/** Trims and collapses whitespace runs; throws when the result is empty. */
export function cleanHeadingTitle(title: string): string {
    const cleaned = title.replace(TITLE_WHITESPACE_RUN_PATTERN, " ").trim();
    if (cleaned === "") throw new Error(EMPTY_HEADING_TITLE_MESSAGE);
    return cleaned;
}

function isHeadingLevelValue(candidate: unknown): candidate is HeadingLevel {
    return (
        typeof candidate === "number" &&
        Number.isInteger(candidate) &&
        candidate >= MIN_HEADING_LEVEL &&
        candidate <= MAX_HEADING_LEVEL
    );
}

/**
 * Pure outline builder: an entry at level L collects the following deeper
 * entries until a level ≤ L appears; skipped levels nest under the last shallower entry.
 */
export function buildOutline(
    headings: readonly Heading[],
): readonly HeadingGroup[] {
    const cleanedHeadings = parseOutlineHeadings(headings);

    const topGroups: HeadingGroupDraft[] = [];
    const openGroups: HeadingGroupDraft[] = [];
    for (const entry of cleanedHeadings) {
        const group: HeadingGroupDraft = {
            id: entry.id,
            title: entry.title,
            level: entry.level,
            children: [],
        };
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

// Outline boundary: validate consumer entries and return cleaned copies in
// input order, so grouping above never re-cleans or re-validates.
function parseOutlineHeadings(
    headings: readonly Heading[],
): readonly Heading[] {
    const cleanedHeadings: Heading[] = [];
    const seenIds = new Set<string>();
    for (const entry of headings) {
        if (!isValidTargetId(entry.id))
            throw new Error(
                INVALID_OUTLINE_ID_MESSAGE_PREFIX + String(entry.id),
            );
        if (!isHeadingLevelValue(entry.level))
            throw new Error(INVALID_OUTLINE_LEVEL_MESSAGE);
        // A JS caller can pass a non-string title inside a typed field; reject it before cleaning so no TypeError escapes.
        if (typeof entry.title !== "string")
            throw new Error(INVALID_OUTLINE_TITLE_MESSAGE);
        const cleanedTitle = cleanHeadingTitle(entry.title);
        if (seenIds.has(entry.id))
            throw new Error(DUPLICATE_OUTLINE_ID_MESSAGE_PREFIX + entry.id);
        cleanedHeadings.push({
            id: entry.id,
            title: cleanedTitle,
            level: entry.level,
        });
        seenIds.add(entry.id);
    }
    return cleanedHeadings;
}

/** The Root's tracking lane; the union makes the absent lane unrepresentable. */
export type TocTrackingSource =
    | { lane: "targetIds"; targetIds: readonly string[] }
    | {
          lane: "headings";
          targetIds: readonly string[];
          outline: readonly HeadingGroup[];
      };

/**
 * Tracking boundary: the two-lanes error precedes the absent-lane error, and
 * lane discrimination precedes per-lane parsing. The `headings` lane builds
 * the outline and derives its id collection from the entries.
 */
export function parseTrackingSource(props: {
    targetIds?: readonly string[] | undefined;
    headings?: readonly Heading[] | undefined;
}): TocTrackingSource {
    const { targetIds, headings } = props;
    if (targetIds !== undefined && headings !== undefined)
        throw new Error(INVALID_TRACKING_SOURCE_MESSAGE);
    if (targetIds !== undefined)
        return {
            lane: "targetIds",
            targetIds: parseTargetCollection(targetIds),
        };
    if (headings !== undefined) {
        const outline = buildOutline(headings);
        return {
            lane: "headings",
            // buildOutline validated every id, so this projection never re-runs the collection parser.
            targetIds: headings.map((heading) => heading.id),
            outline,
        };
    }
    throw new Error(INVALID_TRACKING_SOURCE_MESSAGE);
}

/** Document-order heading snapshot with cleaned titles; it reads no layout. */
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
        const level =
            HEADING_LEVEL_BY_TAG_NAME[headingElement.tagName.toUpperCase()];
        if (level === undefined) continue;
        if (!selectedLevelSet.has(level)) continue;

        const id = headingElement.getAttribute("id");
        if (!isValidTargetId(id))
            throw new Error(INVALID_DISCOVERY_ID_MESSAGE_PREFIX + String(id));
        if (seenIds.has(id))
            throw new Error(DUPLICATE_DISCOVERY_ID_MESSAGE_PREFIX + id);
        seenIds.add(id);

        const fragments: string[] = [];
        collectTitleText(headingElement, fragments);
        const title = cleanHeadingTitle(fragments.join(""));
        headings.push({ id, title, level });
    }
    return headings;
}

function readDiscoveryLevels(options?: {
    levels?: readonly HeadingLevel[];
}): readonly HeadingLevel[] {
    const levels = options?.levels;
    if (levels === undefined) return DEFAULT_DISCOVERY_LEVELS;
    if (!Array.isArray(levels))
        throw new Error(INVALID_DISCOVERY_LEVEL_MESSAGE);
    for (const value of levels) {
        if (!isHeadingLevelValue(value))
            throw new Error(INVALID_DISCOVERY_LEVEL_MESSAGE);
    }
    return levels;
}

// Excludes `hidden` and `aria-hidden="true"` subtrees, script/style, and comments.
function collectTitleText(element: Element, fragments: string[]): void {
    for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            fragments.push(child.nodeValue ?? "");
            continue;
        }
        if (!(child instanceof Element)) continue;
        const isAttributeHidden =
            child.hasAttribute("hidden") ||
            child.getAttribute("aria-hidden") === "true";
        if (
            isAttributeHidden ||
            TITLE_EXCLUDED_TAG_NAMES.has(child.tagName.toLowerCase())
        )
            continue;
        collectTitleText(child, fragments);
    }
}

/**
 * Client-side outline snapshot for `scope`, one discovery per scope identity; a `null` scope and every server render yield the empty pair.
 */
export function useTocOutline(scope: Element | null): {
    headings: readonly Heading[];
    outline: readonly HeadingGroup[];
} {
    const [headings, setHeadings] =
        React.useState<readonly Heading[]>(EMPTY_HEADINGS);

    // Clear the snapshot when the scope detaches.
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

const TocRootContext = React.createContext<TocRootContextValue | undefined>(
    undefined,
);

function hasReachedBottom(
    scrollHeightPx: number,
    clientHeightPx: number,
    scrollOffsetPx: number,
): boolean {
    return (
        scrollHeightPx > clientHeightPx &&
        scrollOffsetPx >=
            scrollHeightPx - clientHeightPx - BOTTOM_MAX_SCROLL_TOLERANCE_PX
    );
}

/**
 * Root-owned tracker: one geometry sample per scheduled update, change-only
 * notifications, and an initial `currentId` of `null` for SSR parity.
 */
function useTocTracker(trackerProps: {
    targetIds: readonly string[];
    scrollElement: Element | null | undefined;
    activationOffset: number;
    onCurrentChange: ((currentId: string | null) => void) | undefined;
    actionsRef: React.RefObject<TocActions | null> | undefined;
}): {
    currentId: string | null;
    navElementRef: React.RefObject<HTMLElement | null>;
} {
    const {
        targetIds,
        scrollElement,
        activationOffset,
        onCurrentChange,
        actionsRef,
    } = trackerProps;

    const navElementRef = React.useRef<HTMLElement | null>(null);
    const currentIdRef = React.useRef<string | null>(null);
    // The last configuration commit; measurements read it so a scroll-event
    // question between the reads and the state write sees committed props.
    const committedPropsRef = useRefWithInit(() => ({
        targetIds,
        scrollElement,
        activationOffset,
    }));

    // Scheduled work coalesces into one measurement per frame: request() clears
    // the previous call, and cancel() is idempotent, so the commit-effect
    // cleanups can cancel unconditionally.
    const raf = useAnimationFrame();

    const [currentId, setCurrentIdState] = React.useState<string | null>(null);

    // A replaced callback identity must not re-notify, and an absent callback is a no-op.
    const notifyCurrentIdChange = useStableCallback(onCurrentChange);

    const publishCurrentId = useStableCallback((nextId: string | null) => {
        if (currentIdRef.current === nextId) return;
        currentIdRef.current = nextId;
        setCurrentIdState(nextId);
        notifyCurrentIdChange(nextId);
    });

    const measureAndPublish = React.useCallback(() => {
        const {
            targetIds: committedTargetIds,
            scrollElement: committedScrollElement,
            activationOffset: committedOffsetPx,
        } = committedPropsRef.current;
        const navElement = navElementRef.current;
        // A refresh() handle retained past unmount can schedule this after the ref clears.
        if (navElement === null) return;

        const doc = navElement.ownerDocument;

        // Inactive tracking: refresh() may still run, so the request skips quietly.
        if (committedScrollElement === null) return;

        const docElement = doc.documentElement;
        let surfaceElement: Element | null = null;
        let surfaceTopPx = 0;
        let hasSurfaceBottomReached = false;

        if (
            committedScrollElement === undefined ||
            committedScrollElement === docElement
        ) {
            const view = doc.defaultView;
            // A document without a window cannot be measured; publish null instead of keeping a stale value.
            if (view === null) {
                publishCurrentId(null);
                return;
            }
            hasSurfaceBottomReached = hasReachedBottom(
                docElement.scrollHeight,
                docElement.clientHeight,
                view.scrollY,
            );
        } else {
            if (committedScrollElement.clientHeight <= 0) {
                publishCurrentId(null);
                return;
            }
            surfaceElement = committedScrollElement;
            // The surface top edge is the client-area edge, so clientTop adds the border-top width in px.
            surfaceTopPx =
                committedScrollElement.getBoundingClientRect().top +
                committedScrollElement.clientTop;
            hasSurfaceBottomReached = hasReachedBottom(
                committedScrollElement.scrollHeight,
                committedScrollElement.clientHeight,
                committedScrollElement.scrollTop,
            );
        }

        const targetsGeometry: TocTargetGeometry[] = [];
        for (const targetId of committedTargetIds) {
            const targetElement = doc.getElementById(targetId);
            if (targetElement === null) {
                targetsGeometry.push({ id: targetId, headroomPx: null });
                continue;
            }
            // Ownership: a target outside its scroller throws while the measurement
            // runs; contains() is inclusive, so the scroller itself is excluded.
            if (surfaceElement !== null) {
                const isTargetOwnedByScroller =
                    targetElement !== surfaceElement &&
                    surfaceElement.contains(targetElement);
                if (!isTargetOwnedByScroller)
                    throw new Error(OWNERSHIP_ERROR_MESSAGE);
            }
            if (targetElement.getClientRects().length === 0) {
                targetsGeometry.push({ id: targetId, headroomPx: null });
                continue;
            }
            targetsGeometry.push({
                id: targetId,
                headroomPx:
                    targetElement.getBoundingClientRect().top - surfaceTopPx,
            });
        }

        publishCurrentId(
            selectCurrentTargetId({
                targets: targetsGeometry,
                activationOffsetPx: committedOffsetPx,
                hasSurfaceBottomReached,
            }),
        );
    }, [publishCurrentId]);

    const scheduleMeasurement = React.useCallback(() => {
        raf.request(measureAndPublish);
    }, [measureAndPublish, raf]);

    // refresh() remeasures and never scrolls; the unmount cleanup nulls the handle only while it is current.
    useIsoLayoutEffect(() => {
        if (actionsRef === undefined) return;
        const actions: TocActions = { refresh: scheduleMeasurement };
        actionsRef.current = actions;
        return () => {
            if (actionsRef.current === actions) actionsRef.current = null;
        };
    }, [actionsRef, scheduleMeasurement]);

    useIsoLayoutEffect(() => {
        // The committed props are the measurement input, so they update before any scheduled work.
        committedPropsRef.current = {
            targetIds,
            scrollElement,
            activationOffset,
        };

        // Immediate transitions: an inactive surface or a departed current ID publishes null without a measurement.
        if (scrollElement === null) {
            publishCurrentId(null);
            return;
        }
        if (
            currentIdRef.current !== null &&
            !targetIds.includes(currentIdRef.current)
        )
            publishCurrentId(null);

        scheduleMeasurement();

        const navElement = navElementRef.current;
        // A custom renderer that drops the ref cannot provide the tracking element.
        if (navElement === null) return;
        const doc = navElement.ownerDocument;

        // The root element tracks like an omitted `scrollElement`: root-scroller
        // events target the Document, and its bounding-rect top is the document origin.
        if (
            scrollElement === undefined ||
            scrollElement === doc.documentElement
        ) {
            const view = doc.defaultView;
            // A document without a window cannot carry listeners; publish null instead of keeping a stale value.
            if (view === null) {
                publishCurrentId(null);
                return;
            }
            const detachScrollEvent = addEventListener(
                view,
                "scroll",
                scheduleMeasurement,
                { passive: true },
            );
            const detachResizeEvent = addEventListener(
                view,
                "resize",
                scheduleMeasurement,
            );
            return () => {
                detachScrollEvent();
                detachResizeEvent();
                raf.cancel();
            };
        }

        if (scrollElement.clientHeight <= 0) publishCurrentId(null);
        const detachScrollEvent = addEventListener(
            scrollElement,
            "scroll",
            scheduleMeasurement,
            { passive: true },
        );
        const surfaceObserver = new ResizeObserver(() => {
            // A 0→size box transition reactivates tracking; a lost box deactivates it at once.
            if (scrollElement.clientHeight > 0) scheduleMeasurement();
            else publishCurrentId(null);
        });
        surfaceObserver.observe(scrollElement);
        return () => {
            detachScrollEvent();
            surfaceObserver.disconnect();
            raf.cancel();
        };
    }, [
        activationOffset,
        publishCurrentId,
        raf,
        scheduleMeasurement,
        scrollElement,
        targetIds,
    ]);

    return { currentId, navElementRef };
}

// The shared composition interface: native props merge, and each part
// destructures `ref` because `mergeProps` ignores it and would silently drop it.
type TocCompositionProps<
    ElementType extends React.ElementType,
    State,
    OmittedKeys extends string = never,
> = Omit<
    React.ComponentPropsWithRef<ElementType>,
    "className" | "style" | OmittedKeys
> & {
    className?: string | ((state: State) => string | undefined) | undefined;
    render?:
        React.ReactElement | ComponentRenderFn<HTMLProps, State> | undefined;
    style?:
        | React.CSSProperties
        | ((state: State) => React.CSSProperties | undefined)
        | undefined;
};

export interface TocRootProps extends TocCompositionProps<"nav", TocRootState> {
    /** The `targetIds` lane; mutually exclusive with `headings`. Immutable snapshot, replace it to reconfigure. */
    targetIds?: readonly string[] | undefined;
    /** The `headings` lane, mutually exclusive with `targetIds`; the Root derives the collection and outline. */
    headings?: readonly Heading[] | undefined;
    /** The tracked scrolling surface; omit for the document viewport, pass `null` to deactivate tracking. */
    scrollElement?: Element | null | undefined;
    /** CSS pixels below the surface top edge that count as reached. */
    activationOffset?: number | undefined;
    /** Change-only notification of the current target ID. */
    onCurrentChange?: ((currentId: string | null) => void) | undefined;
    /** Receives the imperative `refresh()` handle. */
    actionsRef?: React.RefObject<TocActions | null> | undefined;
}

// `currentId` must not emit a `data-current-id` attribute; the root exposes `data-has-current` instead.
const TOC_ROOT_STATE_ATTRIBUTES_MAPPING = { currentId: () => null };

/** The tracked navigation landmark; renders a `<nav>` with a default label consumers can override. */
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

    // Input boundaries: parse once per render so the commit effect keeps
    // dependency identity; the collection is fresh only when its source prop value is.
    const trackedSource = React.useMemo(
        () => parseTrackingSource({ targetIds, headings }),
        [targetIds, headings],
    );
    const tracker = useTocTracker({
        targetIds: trackedSource.targetIds,
        scrollElement,
        activationOffset: parseActivationOffset(activationOffset),
        onCurrentChange,
        actionsRef,
    });

    const contextValue: TocRootContextValue = React.useMemo(
        () => ({
            targetIds: trackedSource.targetIds,
            outline:
                trackedSource.lane === "headings"
                    ? trackedSource.outline
                    : null,
            currentId: tracker.currentId,
        }),
        [trackedSource, tracker.currentId],
    );

    const state: TocRootState = { currentId: tracker.currentId };

    const element = useRenderElement<TocRootState, HTMLElement, "nav">(
        "nav",
        componentProps,
        {
            state,
            ref: [ref, tracker.navElementRef],
            stateAttributesMapping: TOC_ROOT_STATE_ATTRIBUTES_MAPPING,
            props: [
                // Keep the default first so consumer-provided labels override it.
                DEFAULT_ROOT_LABEL_PROPS,
                elementProps,
                (props) => ({
                    ...props,
                    "data-has-current":
                        state.currentId !== null ? "" : undefined,
                }),
            ],
        },
    );

    return (
        <TocRootContext.Provider value={contextValue}>
            {element}
        </TocRootContext.Provider>
    );
}

export interface TocListProps extends TocCompositionProps<
    "ol",
    TocListState,
    "children"
> {
    /**
     * Function children receive one outline entry per call in document order;
     * the part authors each key from the entry id, so the callback needs no key.
     */
    children?:
        React.ReactNode | ((entry: Heading) => React.ReactNode) | undefined;
}

/** A flat ordered list of outline entries. */
export function TocList(componentProps: TocListProps) {
    const rootContext = React.useContext(TocRootContext);
    const {
        className,
        style,
        render,
        ref,
        children: childrenProp,
        ...elementProps
    } = componentProps;

    const outline = rootContext === undefined ? null : rootContext.outline;
    const children =
        typeof childrenProp === "function"
            ? renderOutlineEntries(childrenProp, outline)
            : childrenProp;

    return useRenderElement<TocListState, HTMLOListElement, "ol">(
        "ol",
        componentProps,
        {
            state: EMPTY_PART_STATE,
            ref,
            props: [elementProps, (props) => ({ ...props, children })],
        },
    );
}

function renderOutlineEntries(
    renderEntry: (entry: Heading) => React.ReactNode,
    outline: readonly HeadingGroup[] | null,
): React.ReactNode {
    if (outline === null)
        throw new Error(INVALID_LIST_FUNCTION_CHILDREN_MESSAGE);

    return flattenOutline(outline).map((entry) => (
        <React.Fragment key={entry.id}>{renderEntry(entry)}</React.Fragment>
    ));
}

function flattenOutline(
    outline: readonly HeadingGroup[],
    flatEntries: Heading[] = [],
): readonly Heading[] {
    for (const group of outline) {
        flatEntries.push({
            id: group.id,
            title: group.title,
            level: group.level,
        });
        flattenOutline(group.children, flatEntries);
    }
    return flatEntries;
}

/**
 * The active item's value: the current heading's title in the `headings` lane,
 * and the current target ID in the `targetIds` lane, where no titles exist.
 */
export function selectActiveValue(
    outline: readonly HeadingGroup[] | null,
    currentId: string | null,
): string | null {
    if (currentId === null) return null;
    if (outline === null) return currentId;
    return findHeadingTitle(outline, currentId) ?? currentId;
}

function findHeadingTitle(
    outline: readonly HeadingGroup[],
    targetId: string,
): string | null {
    for (const group of outline) {
        if (group.id === targetId) return group.title;
        const childTitle = findHeadingTitle(group.children, targetId);
        if (childTitle !== null) return childTitle;
    }
    return null;
}

export interface TocItemProps extends TocCompositionProps<"li", TocItemState> {}

/** An entry of the flat outline; nested lists are consumer-authored from `buildOutline` when wanted. */
export function TocItem(componentProps: TocItemProps) {
    const { className, style, render, ref, ...elementProps } = componentProps;

    return useRenderElement<TocItemState, HTMLLIElement, "li">(
        "li",
        componentProps,
        {
            state: EMPTY_PART_STATE,
            ref,
            props: [elementProps],
        },
    );
}

export interface TocLinkProps extends TocCompositionProps<
    "a",
    TocLinkState,
    "href" | "aria-current"
> {
    /** Must be a valid target ID in the root collection, or `TocLink` throws. */
    targetId: string;
}

/** A fragment link to one configured target; component-owned `href` and `aria-current` beat consumer values. */
export function TocLink(componentProps: TocLinkProps) {
    const rootContext = React.useContext(TocRootContext);
    const { targetId, className, style, render, ref, ...elementProps } =
        componentProps;

    if (!isValidTargetId(targetId))
        throw new Error(INVALID_TARGET_ID_ON_LINK_MESSAGE);
    if (rootContext === undefined) throw new Error(LINK_OUTSIDE_ROOT_MESSAGE);
    if (!rootContext.targetIds.includes(targetId))
        throw new Error(LINK_NOT_IN_COLLECTION_MESSAGE_PREFIX + targetId);

    const state: TocLinkState = { current: rootContext.currentId === targetId };

    return useRenderElement<TocLinkState, HTMLAnchorElement, "a">(
        "a",
        componentProps,
        {
            state,
            ref,
            props: [
                elementProps,
                (props) => ({
                    ...props,
                    href: `#${encodeURIComponent(targetId)}`,
                    "aria-current": state.current
                        ? ARIA_CURRENT_LOCATION
                        : undefined,
                }),
            ],
        },
    );
}

export interface TocValueProps {
    /**
     * Renders the value. A function receives it, so the consumer can format it
     * or label the empty state.
     */
    children?: ((value: string | null) => React.ReactNode) | undefined;
}

/**
 * The active item's value as text: the current heading's title, or the current
 * target ID in the `targetIds` lane. Renders no element.
 */
export function TocValue({ children }: TocValueProps) {
    const rootContext = React.useContext(TocRootContext);
    if (rootContext === undefined) throw new Error(VALUE_OUTSIDE_ROOT_MESSAGE);

    const value = selectActiveValue(rootContext.outline, rootContext.currentId);
    return typeof children === "function" ? children(value) : value;
}
