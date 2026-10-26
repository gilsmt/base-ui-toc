"use client";

import * as React from "react";
import { useRenderElement } from "@base-ui/react/internals/useRenderElement";
import type { ComponentRenderFn, HTMLProps } from "@base-ui/react/use-render";
import { addEventListener } from "@base-ui/utils/addEventListener";
import { createLogOnce } from "@base-ui/utils/createLogOnce";
import { fastObjectShallowCompare } from "@base-ui/utils/fastObjectShallowCompare";
import { useAnimationFrame } from "@base-ui/utils/useAnimationFrame";
import { useIsoLayoutEffect } from "@base-ui/utils/useIsoLayoutEffect";
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

const CURRENT_LINK_SELECTOR = `[aria-current="${ARIA_CURRENT_LOCATION}"]`;

const BOTTOM_MAX_SCROLL_TOLERANCE_PX = 1;

const INVALID_COLLECTION_MESSAGE =
    "Invalid target ID in targetIds: every entry must be a valid, unique target ID.";

const INVALID_TARGET_COLLECTION_MESSAGE =
    "Invalid targetIds: expected an array of target IDs.";

const DUPLICATE_TARGET_MESSAGE_PREFIX = "Duplicate target ID: ";

const INVALID_ACTIVATION_OFFSET_MESSAGE =
    "Invalid activationOffset: it must be a finite, non-negative number.";

const INVALID_TRACKING_SOURCE_MESSAGE =
    "TocRoot receives one tracking source: targetIds or headings.";

const INVALID_TARGET_ID_ON_LINK_MESSAGE =
    "Invalid targetId on TocLink: it must be a valid target ID.";

const LINK_OUTSIDE_ROOT_MESSAGE = "TocLink must render inside a TocRoot.";

const INDICATOR_OUTSIDE_ROOT_MESSAGE =
    "TocIndicator must render inside a TocRoot.";

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

const INVALID_HEADINGS_COLLECTION_MESSAGE =
    "Invalid headings: expected an array of heading records.";

const INVALID_HEADING_RECORD_MESSAGE =
    "Invalid heading: expected an object with id, title, and level fields.";

const DUPLICATE_HEADING_ID_MESSAGE_PREFIX =
    "Duplicate heading ID in groupHeadings input: ";

const INVALID_SCROLL_ELEMENT_MESSAGE =
    "Invalid scrollElement: pass a DOM Element, null, or undefined.";

const SCROLL_ELEMENT_DOCUMENT_MESSAGE =
    "Invalid scrollElement: it must belong to the same document as TocRoot.";

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

export interface TocTargetPosition {
    id: string;
    /** Distance in CSS pixels from the surface top to the target top; null when unavailable. */
    distanceFromSurfaceTopPx: number | null;
}

export interface TocScrollSnapshot {
    targetPositions: readonly TocTargetPosition[];
    activationOffsetPx: number;
    hasSurfaceBottomReached: boolean;
}

export interface TocRootState {
    currentId: string | null;
}

export interface TocLinkState {
    current: boolean;
}

export interface TocTitleState {}

export interface TocIndicatorState {
    visible: boolean;
}

export interface TocListState {}

export interface TocItemState {}

export interface TocActions {
    refresh(): void;
}

interface TocRootContextValue {
    targetIds: readonly string[];
    headings: readonly Heading[] | null;
    navElementRef: React.RefObject<HTMLElement | null>;
}

/** A valid target ID is non-empty and holds no ASCII whitespace or unpaired surrogate. */
export function isValidTargetId(candidate: unknown): candidate is string {
    if (typeof candidate !== "string") return false;
    if (candidate === "") return false;
    if (ASCII_WHITESPACE_PATTERN.test(candidate)) return false;
    return !UNPAIRED_SURROGATE_PATTERN.test(candidate);
}

export function parseTargetCollection(targetIds: unknown): readonly string[] {
    if (!isUnknownArray(targetIds))
        throw new Error(INVALID_TARGET_COLLECTION_MESSAGE);

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
    snapshot: TocScrollSnapshot,
): string | null {
    let lastCrossedId: string | null = null;
    let lastAvailableId: string | null = null;
    for (const position of snapshot.targetPositions) {
        if (position.distanceFromSurfaceTopPx === null) continue;
        lastAvailableId = position.id;
        if (position.distanceFromSurfaceTopPx <= snapshot.activationOffsetPx)
            lastCrossedId = position.id;
    }
    if (lastCrossedId !== null) return lastCrossedId;
    if (snapshot.hasSurfaceBottomReached) return lastAvailableId;
    return null;
}

/** Trims and collapses whitespace runs; throws when the result is empty. */
export function cleanHeadingTitle(title: string): string {
    const cleaned = normalizeHeadingTitle(title);
    if (cleaned === "") throw new Error(EMPTY_HEADING_TITLE_MESSAGE);
    return cleaned;
}

function normalizeHeadingTitle(title: string): string {
    return title.replace(TITLE_WHITESPACE_RUN_PATTERN, " ").trim();
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

function parseHeadings(headings: unknown): readonly Heading[] {
    if (!isUnknownArray(headings))
        throw new Error(INVALID_HEADINGS_COLLECTION_MESSAGE);

    // Validate the entries and return cleaned copies in input order, so the
    // grouping never re-cleans or re-validates.
    const cleanedHeadings: Heading[] = [];
    const seenIds = new Set<string>();
    for (const candidate of headings) {
        if (!isRecord(candidate))
            throw new Error(INVALID_HEADING_RECORD_MESSAGE);

        const { id, level, title } = candidate;

        if (!isValidTargetId(id))
            throw new Error(INVALID_HEADING_ID_MESSAGE_PREFIX + String(id));

        if (!isHeadingLevelValue(level))
            throw new Error(INVALID_HEADING_LEVEL_MESSAGE);

        if (typeof title !== "string")
            throw new Error(INVALID_HEADING_TITLE_MESSAGE);

        if (seenIds.has(id))
            throw new Error(DUPLICATE_HEADING_ID_MESSAGE_PREFIX + id);

        cleanedHeadings.push({
            id,
            title: cleanHeadingTitle(title),
            level,
        });
        seenIds.add(id);
    }
    return cleanedHeadings;
}

function isUnknownArray(candidate: unknown): candidate is readonly unknown[] {
    return Array.isArray(candidate);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

type TocTrackingSource =
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
export function parseTrackingSource(props: unknown): TocTrackingSource {
    if (!isRecord(props)) throw new Error(INVALID_TRACKING_SOURCE_MESSAGE);

    const { targetIds, headings } = props;
    if (targetIds !== undefined && headings !== undefined)
        throw new Error(INVALID_TRACKING_SOURCE_MESSAGE);
    if (targetIds !== undefined)
        return {
            lane: "targetIds",
            targetIds: parseTargetCollection(targetIds),
        };
    if (headings !== undefined) {
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
    scope: Element | null,
    options?: { levels?: readonly HeadingLevel[] },
): readonly Heading[] {
    const selectedLevelSet = new Set(readDiscoveryLevels(options));
    if (scope === null) return [];

    const seenIds = new Set<string>();
    const headings: Heading[] = [];

    for (const headingElement of scope.querySelectorAll(HEADINGS_SELECTOR)) {
        const level =
            HEADING_LEVEL_BY_TAG_NAME[headingElement.tagName.toUpperCase()];
        if (level === undefined) continue;

        const id = headingElement.getAttribute("id");
        if (
            isInHiddenSubtree(headingElement) ||
            !selectedLevelSet.has(level)
        ) {
            // Filtered headings can still own the ID returned by getElementById.
            if (isValidTargetId(id)) seenIds.add(id);
            continue;
        }

        const fragments: string[] = [];
        collectTitleText(headingElement, fragments);
        const title = normalizeHeadingTitle(fragments.join(""));

        if (!isValidTargetId(id)) {
            warn(
                `Skipped ${describeHeading(headingElement, title)}: it has no valid id, so it cannot be a link target.`,
            );
            continue;
        }
        // The first heading with an id owns it: a later duplicate resolves to
        // the first one, so the later heading is unreachable.
        if (seenIds.has(id)) {
            warn(
                `Skipped ${describeHeading(headingElement, title)}: the id "${id}" already belongs to an earlier heading.`,
            );
            continue;
        }
        seenIds.add(id);

        if (title === "") {
            warn(
                `Skipped ${describeHeading(headingElement, title)}: it has no text to show.`,
            );
            continue;
        }

        headings.push({ id, title, level });
    }
    return headings;
}

function describeHeading(element: Element, title: string): string {
    const tag = element.tagName.toLowerCase();
    const id = element.getAttribute("id");
    const idPart = id === null ? "" : ` id="${id}"`;
    return `<${tag}${idPart}> "${title}"`;
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
    for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            fragments.push(child.nodeValue ?? "");
            continue;
        }
        if (!isElementNode(child)) continue;
        if (
            hasHiddenAttribute(child) ||
            TITLE_EXCLUDED_TAG_NAMES.has(child.tagName.toLowerCase())
        )
            continue;
        collectTitleText(child, fragments);
    }
}

function isElementNode(node: Node): node is Element {
    return node.nodeType === Node.ELEMENT_NODE;
}

function isInHiddenSubtree(element: Element): boolean {
    let currentNode: Node | null = element;
    while (currentNode !== null) {
        if (isElementNode(currentNode) && hasHiddenAttribute(currentNode))
            return true;

        // A shadow root has no parent node, so continue from its host.
        currentNode =
            currentNode.parentNode ??
            (isShadowRoot(currentNode) ? currentNode.host : null);
    }
    return false;
}

function isShadowRoot(node: Node): node is ShadowRoot {
    return node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && "host" in node;
}

function hasHiddenAttribute(element: Element): boolean {
    return (
        element.hasAttribute("hidden") ||
        element.getAttribute("aria-hidden") === "true"
    );
}

/**
 * Client-side heading snapshot for `scope`, one discovery per scope identity;
 * a `null` scope and every server render yield no headings.
 */
export function useTocHeadings(scope: Element | null): readonly Heading[] {
    const [headings, setHeadings] =
        React.useState<readonly Heading[]>(EMPTY_HEADINGS);

    useIsoLayoutEffect(() => {
        if (scope === null) {
            setHeadings(EMPTY_HEADINGS);
            return;
        }
        setHeadings(discoverHeadings(scope));
    }, [scope]);

    return headings;
}

function parseScrollElement(candidate: unknown): Element | null | undefined {
    if (candidate === null || candidate === undefined) return candidate;
    if (!isDomElement(candidate))
        throw new Error(INVALID_SCROLL_ELEMENT_MESSAGE);
    return candidate;
}

function isDomElement(candidate: unknown): candidate is Element {
    if (typeof candidate !== "object" || candidate === null) return false;

    // Check the element's own realm so Elements from iframes remain valid.
    const ownerDocument =
        "ownerDocument" in candidate ? candidate.ownerDocument : undefined;

    if (!isRecord(ownerDocument)) return false;
    const defaultView = ownerDocument["defaultView"];

    if (!isRecord(defaultView)) return false;
    const elementConstructor = defaultView["Element"];

    return (
        typeof elementConstructor === "function" &&
        candidate instanceof elementConstructor
    );
}

const TocRootContext = React.createContext<TocRootContextValue | undefined>(
    undefined,
);

const TocCurrentIdContext = React.createContext<string | null>(null);

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

interface TocScrollSnapshotReadOptions {
    doc: Document;
    targetIds: readonly string[];
    scrollElement: Element | null | undefined;
    activationOffsetPx: number;
}

function readTocScrollSnapshot({
    doc,
    targetIds,
    scrollElement,
    activationOffsetPx,
}: TocScrollSnapshotReadOptions): TocScrollSnapshot | null {
    if (scrollElement === null) return null;

    const docElement = doc.documentElement;
    let surfaceElement: Element | null = null;
    let surfaceTopPx = 0;
    let hasSurfaceBottomReached = false;

    if (scrollElement === undefined || scrollElement === docElement) {
        const view = doc.defaultView;
        if (view === null) return null;

        hasSurfaceBottomReached = hasReachedBottom(
            docElement.scrollHeight,
            docElement.clientHeight,
            view.scrollY,
        );
    } else {
        if (scrollElement.clientHeight <= 0) return null;

        surfaceElement = scrollElement;
        // The surface top edge is the client-area edge, so clientTop adds the border-top width in px.
        surfaceTopPx =
            scrollElement.getBoundingClientRect().top + scrollElement.clientTop;
        hasSurfaceBottomReached = hasReachedBottom(
            scrollElement.scrollHeight,
            scrollElement.clientHeight,
            scrollElement.scrollTop,
        );
    }

    const targetPositions: TocTargetPosition[] = [];
    for (const targetId of targetIds) {
        const targetElement = doc.getElementById(targetId);
        if (targetElement === null) {
            targetPositions.push({
                id: targetId,
                distanceFromSurfaceTopPx: null,
            });
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
                targetPositions.push({
                    id: targetId,
                    distanceFromSurfaceTopPx: null,
                });
                continue;
            }
        }
        if (targetElement.getClientRects().length === 0) {
            targetPositions.push({
                id: targetId,
                distanceFromSurfaceTopPx: null,
            });
            continue;
        }
        targetPositions.push({
            id: targetId,
            distanceFromSurfaceTopPx:
                targetElement.getBoundingClientRect().top - surfaceTopPx,
        });
    }

    return { targetPositions, activationOffsetPx, hasSurfaceBottomReached };
}

interface UseTocTrackerReturnType {
    currentId: string | null;
    navElementRef: React.RefObject<HTMLElement | null>;
}

function useTocTracker(props: {
    targetIds: readonly string[];
    scrollElement: Element | null | undefined;
    activationOffset: number;
    onCurrentChange: ((currentId: string | null) => void) | undefined;
    actionsRef: React.RefObject<TocActions | null> | undefined;
}): UseTocTrackerReturnType {
    const {
        targetIds,
        scrollElement,
        activationOffset,
        onCurrentChange: onCurrentChangeProp,
        actionsRef,
    } = props;

    const animationFrame = useAnimationFrame();
    const navElementRef = React.useRef<HTMLElement | null>(null);
    const currentIdRef = React.useRef<string | null>(null);
    const [currentId, setCurrentIdState] = React.useState<string | null>(null);

    const onCurrentChange = useStableCallback(onCurrentChangeProp);

    const setCurrentId = useStableCallback((nextId: string | null) => {
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
        onCurrentChange(currentId);
    }, [currentId, onCurrentChange]);

    const flush = useStableCallback(() => {
        const container = navElementRef.current;
        if (container === null) return;

        const next = readTocScrollSnapshot({
            doc: container.ownerDocument,
            targetIds,
            scrollElement,
            activationOffsetPx: activationOffset,
        });
        if (next === null) {
            // An unavailable surface cannot be measured, so clear any stale current target.
            setCurrentId(null);
            return;
        }
        setCurrentId(selectCurrentTargetId(next));
    });

    const requestFlush = useStableCallback(() => {
        animationFrame.request(flush);
    });

    // refresh() remeasures and never scrolls; the unmount cleanup nulls the handle only while it is current.
    useIsoLayoutEffect(() => {
        if (actionsRef === undefined) return;
        const actions: TocActions = { refresh: requestFlush };
        actionsRef.current = actions;
        return () => {
            if (actionsRef.current === actions) actionsRef.current = null;
        };
    }, [actionsRef, requestFlush]);

    useIsoLayoutEffect(() => {
        const container = navElementRef.current;
        if (
            container !== null &&
            scrollElement !== null &&
            scrollElement !== undefined &&
            scrollElement.ownerDocument !== container.ownerDocument
        )
            throw new Error(SCROLL_ELEMENT_DOCUMENT_MESSAGE);

        // Immediate transitions: an inactive surface or a departed current ID publishes null without a measurement.
        if (scrollElement === null) {
            setCurrentId(null);
            return;
        }
        if (
            currentIdRef.current !== null &&
            !targetIds.includes(currentIdRef.current)
        )
            setCurrentId(null);

        // Without the rendered nav, there is no document or surface to measure.
        if (container === null) {
            setCurrentId(null);
            return;
        }
        const doc = container.ownerDocument;

        requestFlush();

        // The root element tracks like an omitted `scrollElement`: root-scroller
        // events target the Document, and its bounding-rect top is the document origin.
        if (
            scrollElement === undefined ||
            scrollElement === doc.documentElement
        ) {
            const view = doc.defaultView;
            // A document without a window cannot carry listeners; publish null instead of keeping a stale value.
            if (view === null) {
                setCurrentId(null);
                return;
            }
            const detachScrollEvent = addEventListener(
                view,
                "scroll",
                requestFlush,
                { passive: true },
            );
            const detachResizeEvent = addEventListener(
                view,
                "resize",
                requestFlush,
            );
            return () => {
                detachScrollEvent();
                detachResizeEvent();
                animationFrame.cancel();
            };
        }

        if (scrollElement.clientHeight <= 0) setCurrentId(null);

        const detachScrollEvent = addEventListener(
            scrollElement,
            "scroll",
            requestFlush,
            { passive: true },
        );
        const surfaceObserver = new ResizeObserver(() => {
            // A 0→size box transition reactivates tracking; a lost box deactivates it at once.
            if (scrollElement.clientHeight > 0) requestFlush();
            else setCurrentId(null);
        });
        surfaceObserver.observe(scrollElement);

        return () => {
            detachScrollEvent();
            surfaceObserver.disconnect();
            animationFrame.cancel();
        };
    }, [
        activationOffset,
        setCurrentId,
        animationFrame,
        requestFlush,
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

    const source = React.useMemo(
        () => parseTrackingSource({ targetIds, headings }),
        [targetIds, headings],
    );
    const tracker = useTocTracker({
        targetIds: source.targetIds,
        scrollElement: parseScrollElement(scrollElement),
        activationOffset: parseActivationOffset(activationOffset),
        onCurrentChange,
        actionsRef,
    });

    const trackedHeadings = source.lane === "headings" ? source.headings : null;

    const contextValue: TocRootContextValue = React.useMemo(
        () => ({
            targetIds: source.targetIds,
            headings: trackedHeadings,
            navElementRef: tracker.navElementRef,
        }),
        [source.targetIds, trackedHeadings, tracker.navElementRef],
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
                { "aria-label": "Table of contents" },
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
            <TocCurrentIdContext.Provider value={tracker.currentId}>
                {element}
            </TocCurrentIdContext.Provider>
        </TocRootContext.Provider>
    );
}

export interface TocTitleProps extends TocCompositionProps<
    "h2",
    TocTitleState
> {}

/** A visible heading for the table of contents. */
export function TocTitle(componentProps: TocTitleProps) {
    const { className, style, render, ref, ...elementProps } = componentProps;

    return useRenderElement<TocTitleState, HTMLHeadingElement, "h2">(
        "h2",
        componentProps,
        {
            ref,
            props: [elementProps],
        },
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
    const {
        className,
        style,
        render,
        ref,
        children: childrenProp,
        ...elementProps
    } = componentProps;

    const headings = React.useContext(TocRootContext)?.headings ?? null;
    const children =
        typeof childrenProp === "function"
            ? renderHeadingEntries(childrenProp, headings)
            : childrenProp;

    return useRenderElement<TocListState, HTMLOListElement, "ol">(
        "ol",
        componentProps,
        {
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
    const currentId = React.useContext(TocCurrentIdContext);
    const { targetId, className, style, render, ref, ...elementProps } =
        componentProps;

    if (!isValidTargetId(targetId))
        throw new Error(INVALID_TARGET_ID_ON_LINK_MESSAGE);

    if (context === undefined) throw new Error(LINK_OUTSIDE_ROOT_MESSAGE);

    if (!context.targetIds.includes(targetId))
        throw new Error(LINK_NOT_IN_COLLECTION_MESSAGE_PREFIX + targetId);

    const state: TocLinkState = { current: currentId === targetId };

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

interface TocIndicatorPosition {
    top: number;
    left: number;
    width: number;
    height: number;
}

export interface TocIndicatorProps extends TocCompositionProps<
    "span",
    TocIndicatorState
> {}

/** A decorative marker that follows the current list item. */
export function TocIndicator(componentProps: TocIndicatorProps) {
    const context = React.useContext(TocRootContext);
    const currentId = React.useContext(TocCurrentIdContext);

    const { className, style, render, ref, ...elementProps } = componentProps;

    if (context === undefined) throw new Error(INDICATOR_OUTSIDE_ROOT_MESSAGE);

    const indicatorElementRef = React.useRef<HTMLSpanElement | null>(null);

    const position = useTocIndicatorPosition(
        context.navElementRef,
        indicatorElementRef,
        currentId,
        context.targetIds,
    );

    const state: TocIndicatorState = { visible: position !== null };

    return useRenderElement<TocIndicatorState, HTMLSpanElement, "span">(
        "span",
        componentProps,
        {
            state,
            ref: [ref, indicatorElementRef],
            props: [
                elementProps,
                {
                    "aria-hidden": true,
                    hidden: position === null,
                    style: {
                        position: "absolute",
                        top: position?.top ?? 0,
                        left: position?.left ?? 0,
                        width: position?.width ?? 0,
                        height: position?.height ?? 0,
                        boxSizing: "border-box",
                        pointerEvents: "none",
                    },
                },
            ],
        },
    );
}

function useTocIndicatorPosition(
    navElementRef: React.RefObject<HTMLElement | null>,
    indicatorElementRef: React.RefObject<HTMLSpanElement | null>,
    currentId: string | null,
    targetIds: readonly string[],
): TocIndicatorPosition | null {
    const [position, setPosition] = React.useState<TocIndicatorPosition | null>(
        null,
    );
    const animationFrame = useAnimationFrame();
    const hasCurrent = currentId !== null;

    const measurePosition = useStableCallback(() => {
        const container = navElementRef.current;
        if (container === null || currentId === null) {
            setPosition(null);
            return;
        }

        const currentLink = container.querySelector<HTMLElement>(
            CURRENT_LINK_SELECTOR,
        );
        if (currentLink === null || currentLink.getClientRects().length === 0) {
            setPosition(null);
            return;
        }

        const listItem = currentLink.closest("li");
        const itemElement =
            listItem !== null && container.contains(listItem)
                ? listItem
                : currentLink;
        const positioningElement =
            indicatorElementRef.current?.offsetParent ?? container;
        const positioningRect = positioningElement.getBoundingClientRect();
        const itemRect = itemElement.getBoundingClientRect();
        const nextPosition: TocIndicatorPosition = {
            top:
                itemRect.top -
                positioningRect.top -
                positioningElement.clientTop +
                positioningElement.scrollTop,
            left:
                itemRect.left -
                positioningRect.left -
                positioningElement.clientLeft +
                positioningElement.scrollLeft,
            width: itemRect.width,
            height: itemRect.height,
        };

        setPosition((previousPosition) =>
            fastObjectShallowCompare(previousPosition, nextPosition)
                ? previousPosition
                : nextPosition,
        );
    });

    const scheduleMeasurement = useStableCallback(() => {
        animationFrame.request(measurePosition);
    });

    useIsoLayoutEffect(measurePosition);

    useIsoLayoutEffect(() => {
        const container = navElementRef.current;
        if (container === null || !hasCurrent) return;

        const resizeObserver = new ResizeObserver(scheduleMeasurement);
        resizeObserver.observe(container);
        const resizeTargets = new Set<Element>(container.children);
        for (const target of container.querySelectorAll(
            "li, a, [role='link']",
        )) {
            resizeTargets.add(target);
        }
        for (const target of resizeTargets) {
            resizeObserver.observe(target);
        }

        const detachScrollEvent = addEventListener(
            container,
            "scroll",
            scheduleMeasurement,
            { capture: true, passive: true },
        );

        return () => {
            detachScrollEvent();
            resizeObserver.disconnect();
            animationFrame.cancel();
        };
    }, [
        animationFrame,
        hasCurrent,
        navElementRef,
        scheduleMeasurement,
        targetIds,
    ]);

    return position;
}

export interface TocValueProps {
    children?:
        | React.ReactNode
        | ((value: string | null) => React.ReactNode)
        | undefined;
}

/**
 * The active item's value as text: the current heading's title, or the current
 * target ID in the `targetIds` lane. Renders no element.
 */
export function TocValue({ children }: TocValueProps) {
    const context = React.useContext(TocRootContext);
    const currentId = React.useContext(TocCurrentIdContext);
    if (context === undefined) throw new Error(VALUE_OUTSIDE_ROOT_MESSAGE);

    const value = selectActiveValue(context.headings, currentId);
    if (typeof children === "function") return children(value);
    return children == null ? value : children;
}
