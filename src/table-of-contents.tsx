"use client";

import * as React from "react";
import { useRenderElement } from "@base-ui/react/internals/useRenderElement";
import type { ComponentRenderFn, HTMLProps } from "@base-ui/react/use-render";
import { addEventListener } from "@base-ui/utils/addEventListener";
import { createLogOnce } from "@base-ui/utils/createLogOnce";
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
    "TocList receives function children only when TocRoot owns headings; pass `headings` to TocRoot.";

const OWNERSHIP_WARNING_MESSAGE =
    "Skipped a target that resolves outside its configured scroller. Targets in element mode must be DOM descendants of the scroller.";

const INVALID_DISCOVERY_LEVEL_MESSAGE =
    "Invalid levels option: values must be integers from 1 to 6.";

const EMPTY_HEADING_TITLE_MESSAGE =
    "Heading title is empty after whitespace cleaning.";

const INVALID_HEADING_ID_MESSAGE_PREFIX =
    "Invalid heading ID in groupHeadings input: ";

const INVALID_HEADING_LEVEL_MESSAGE =
    "Invalid heading level in groupHeadings input: it must be an integer from 1 to 6.";

const INVALID_HEADING_TITLE_MESSAGE =
    "Invalid heading title in groupHeadings input: it must be a string.";

const DUPLICATE_HEADING_ID_MESSAGE_PREFIX =
    "Duplicate heading ID in groupHeadings input: ";

const EMPTY_PART_STATE: Record<string, never> = {};

const EMPTY_HEADINGS: readonly Heading[] = [];

const warn = createLogOnce("warn", "base-ui-toc");

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface Heading {
    id: string;
    title: string;
    level: HeadingLevel;
}

export interface HeadingNode extends Heading {
    children: readonly HeadingNode[];
}

interface HeadingNodeDraft extends Heading {
    children: HeadingNodeDraft[];
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
    headings: readonly Heading[] | null;
    currentId: string | null;
}

/** A valid target ID is non-empty and holds no ASCII whitespace or unpaired surrogate. */
export function isValidTargetId(candidate: unknown): candidate is string {
    if (typeof candidate !== "string") return false;
    if (candidate === "") return false;
    if (ASCII_WHITESPACE_PATTERN.test(candidate)) return false;
    return !UNPAIRED_SURROGATE_PATTERN.test(candidate);
}

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

function parseActivationOffset(candidate: unknown): number {
    if (!isValidActivationOffset(candidate))
        throw new Error(INVALID_ACTIVATION_OFFSET_MESSAGE);
    return candidate;
}

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
 * Groups headings into a tree: an entry at level L collects the following
 * deeper entries until a level ≤ L appears; skipped levels nest under the
 * last shallower entry.
 */
export function groupHeadings(
    headings: readonly Heading[],
): readonly HeadingNode[] {
    const cleanedHeadings = parseHeadings(headings);
    const topGroups: HeadingNodeDraft[] = [];
    const openGroups: HeadingNodeDraft[] = [];
    for (const entry of cleanedHeadings) {
        const group: HeadingNodeDraft = {
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

function parseHeadings(headings: readonly Heading[]): readonly Heading[] {
    // Validate the entries and return cleaned copies in input order, so the
    // grouping never re-cleans or re-validates.
    const cleanedHeadings: Heading[] = [];
    const seenIds = new Set<string>();
    for (const entry of headings) {
        if (!isValidTargetId(entry.id))
            throw new Error(
                INVALID_HEADING_ID_MESSAGE_PREFIX + String(entry.id),
            );

        if (!isHeadingLevelValue(entry.level))
            throw new Error(INVALID_HEADING_LEVEL_MESSAGE);

        if (typeof entry.title !== "string")
            throw new Error(INVALID_HEADING_TITLE_MESSAGE);

        if (seenIds.has(entry.id))
            throw new Error(DUPLICATE_HEADING_ID_MESSAGE_PREFIX + entry.id);

        const cleanedTitle = cleanHeadingTitle(entry.title);
        cleanedHeadings.push({
            id: entry.id,
            title: cleanedTitle,
            level: entry.level,
        });
        seenIds.add(entry.id);
    }
    return cleanedHeadings;
}

export type TocTrackingSource =
    | { lane: "targetIds"; targetIds: readonly string[] }
    | {
          lane: "headings";
          targetIds: readonly string[];
          headings: readonly Heading[];
      };

/**
 * Tracking boundary: the two-lanes error precedes the absent-lane error, and
 * lane discrimination precedes per-lane parsing. The `headings` lane parses
 * the entries and derives its id collection from them.
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
        // The same validation groupHeadings applies; only the grouping is left out.
        const parsedHeadings = parseHeadings(headings);
        return {
            lane: "headings",
            // The parsed entries validated every id, so this projection never re-runs the collection parser.
            targetIds: parsedHeadings.map((heading) => heading.id),
            headings: parsedHeadings,
        };
    }
    throw new Error(INVALID_TRACKING_SOURCE_MESSAGE);
}

/**
 * Document-order heading snapshot with cleaned titles; it reads no layout.
 *
 * A heading that cannot be represented is left out and reported: document
 * content is not consumer code.
 */
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

        const fragments: string[] = [];
        collectTitleText(headingElement, fragments);
        const rawTitle = fragments.join("");

        const id = headingElement.getAttribute("id");
        if (!isValidTargetId(id)) {
            warn(
                `Skipped ${describeHeading(headingElement, rawTitle)}: it has no valid id, so it cannot be a link target.`,
            );
            continue;
        }
        // The first heading with an id owns it: a later duplicate resolves to
        // the first one, so the later heading is unreachable.
        if (seenIds.has(id)) {
            warn(
                `Skipped ${describeHeading(headingElement, rawTitle)}: the id "${id}" already belongs to an earlier heading.`,
            );
            continue;
        }
        seenIds.add(id);

        if (rawTitle.trim() === "") {
            warn(
                `Skipped ${describeHeading(headingElement, rawTitle)}: it has no text to show.`,
            );
            continue;
        }

        headings.push({ id, title: cleanHeadingTitle(rawTitle), level });
    }
    return headings;
}

function describeHeading(element: Element, rawTitle: string): string {
    const tag = element.tagName.toLowerCase();
    const id = element.getAttribute("id");
    const text = rawTitle.replace(TITLE_WHITESPACE_RUN_PATTERN, " ").trim();
    const idPart = id === null ? "" : ` id="${id}"`;
    return `<${tag}${idPart}> "${text}"`;
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

function collectTitleText(element: Element, fragments: string[]): void {
    // Excludes `hidden` and `aria-hidden="true"` subtrees, script/style, and comments.
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
 * Client-side heading snapshot for `scope`, one discovery per scope identity;
 * a `null` scope and every server render yield no headings.
 */
export function useTocHeadings(scope: Element | null): readonly Heading[] {
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

    return headings;
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
    const committedPropsRef = useRefWithInit(() => ({
        targetIds,
        scrollElement,
        activationOffset,
    }));
    const [currentId, setCurrentIdState] = React.useState<string | null>(null);
    const animationFrame = useAnimationFrame();

    const notifyCurrentIdChange = useStableCallback(onCurrentChange);

    const publishCurrentId = useStableCallback((nextId: string | null) => {
        if (currentIdRef.current === nextId) return;
        currentIdRef.current = nextId;
        setCurrentIdState(nextId);
    });

    // The notification runs after the commit, so the DOM already shows the new
    // current link.
    const notifiedIdRef = React.useRef<string | null>(null);
    useIsoLayoutEffect(() => {
        if (notifiedIdRef.current === currentId) return;
        notifiedIdRef.current = currentId;
        notifyCurrentIdChange(currentId);
    }, [currentId, notifyCurrentIdChange]);

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
            // Ownership: a target outside its scroller cannot be measured
            // against it, so it stays unavailable; contains() is inclusive, so
            // the scroller itself is excluded.
            if (surfaceElement !== null) {
                const isTargetOwnedByScroller =
                    targetElement !== surfaceElement &&
                    surfaceElement.contains(targetElement);
                if (!isTargetOwnedByScroller) {
                    warn(
                        `${OWNERSHIP_WARNING_MESSAGE} Skipped the target "${targetId}".`,
                    );
                    targetsGeometry.push({ id: targetId, headroomPx: null });
                    continue;
                }
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
        animationFrame.request(measureAndPublish);
    }, [measureAndPublish, animationFrame]);

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
                animationFrame.cancel();
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
            animationFrame.cancel();
        };
    }, [
        activationOffset,
        publishCurrentId,
        animationFrame,
        scheduleMeasurement,
        scrollElement,
        targetIds,
    ]);

    return { currentId, navElementRef };
}

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
    /** The `headings` lane, mutually exclusive with `targetIds`; the Root parses the entries and derives the collection from them. */
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

    const trackedHeadings =
        trackedSource.lane === "headings" ? trackedSource.headings : null;
    const contextValue: TocRootContextValue = React.useMemo(
        () => ({
            targetIds: trackedSource.targetIds,
            headings: trackedHeadings,
            currentId: tracker.currentId,
        }),
        [trackedSource.targetIds, trackedHeadings, tracker.currentId],
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
    children?:
        React.ReactNode | ((entry: Heading) => React.ReactNode) | undefined;
}

/** A flat ordered list of heading entries. */
export function TocList(componentProps: TocListProps) {
    const context = React.useContext(TocRootContext);
    const {
        className,
        style,
        render,
        ref,
        children: childrenProp,
        ...elementProps
    } = componentProps;

    const headings = context === undefined ? null : context.headings;
    const children =
        typeof childrenProp === "function"
            ? renderHeadingEntries(childrenProp, headings)
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

function renderHeadingEntries(
    renderEntry: (entry: Heading) => React.ReactNode,
    headings: readonly Heading[] | null,
): React.ReactNode {
    if (headings === null)
        throw new Error(INVALID_LIST_FUNCTION_CHILDREN_MESSAGE);
    return headings.map((entry) => (
        <React.Fragment key={entry.id}>{renderEntry(entry)}</React.Fragment>
    ));
}

export function selectActiveValue(
    headings: readonly Heading[] | null,
    currentId: string | null,
): string | null {
    if (currentId === null) return null;
    if (headings === null) return currentId;
    for (const heading of headings) {
        if (heading.id === currentId) return heading.title;
    }
    return currentId;
}

export interface TocItemProps extends TocCompositionProps<"li", TocItemState> {}

/** An entry of the flat list; nested lists are consumer-authored from `groupHeadings` when wanted. */
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
    const context = React.useContext(TocRootContext);
    const { targetId, className, style, render, ref, ...elementProps } =
        componentProps;

    if (!isValidTargetId(targetId))
        throw new Error(INVALID_TARGET_ID_ON_LINK_MESSAGE);
    if (context === undefined) throw new Error(LINK_OUTSIDE_ROOT_MESSAGE);
    if (!context.targetIds.includes(targetId))
        throw new Error(LINK_NOT_IN_COLLECTION_MESSAGE_PREFIX + targetId);

    const state: TocLinkState = { current: context.currentId === targetId };

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
    children?: ((value: string | null) => React.ReactNode) | undefined;
}

/**
 * The active item's value as text: the current heading's title, or the current
 * target ID in the `targetIds` lane. Renders no element.
 */
export function TocValue({ children }: TocValueProps) {
    const context = React.useContext(TocRootContext);
    if (context === undefined) throw new Error(VALUE_OUTSIDE_ROOT_MESSAGE);

    const value = selectActiveValue(context.headings, context.currentId);
    return typeof children === "function" ? children(value) : value;
}
