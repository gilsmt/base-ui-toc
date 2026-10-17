# base-ui-toc — Design Specification

**Status:** every design decision in this document is settled. The interview closed on 2026-10-16 with an empty frontier. Items the final audit surfaced were resolved by the recommendations included there, adopted verbatim when the interview closed (§4.4, §13, §17).

---

## 1. Purpose and product boundary

`base-ui-toc` is an unstyled, copy-and-paste React 19 component for **in-page document navigation**. It tracks **one current location** in the content while the reader scrolls, and it offers **native fragment links** that move the reader to sections.

One call stack serves two presentations:

- a classic text outline (nested lists of links), and
- a compact scrubber-style rail (small ticks with accessible names).

The difference is presentation only. There is no second interaction model: every entry is a link, hovering or focusing an entry inspects it, and activating it navigates. What the core and the utilities expose is exactly what adjacent widgets need: current-location state, refs, and an outline. Floating panels, previews, tick magnification, progress meters, and disclosures are consumer-composed UI (§8.6, §2).

## 2. Explicit non-goals

The component does not ship, and this specification does not reserve an API for:

- reading-progress percentages, scroll percentages, or per-target visibility sets;
- continuous drag-to-navigate, slider/listbox semantics, or hover-to-navigate;
- heading ID generation, slugging, or document mutation;
- continuous content monitoring (MutationObserver, animation frames, polling) intended to detect every stationary layout shift;
- a controlled current-location override;
- shadow roots, cross-document targets, nested or coordinated scrollers, or automatic scrollable-ancestor detection;
- horizontal scrolling, vertical writing modes, visual-viewport/pinch-zoom geometry, rotated or scaled scrolling surfaces;
- Label, Indicator, Preview, or Content parts; built-in animation of any kind;
- automated browser-testing infrastructure;
- validation that a target's fragment name is unique across the whole document.

Each omission is deliberate. A consumer can compose them outside the core; the core would otherwise carry state and contracts no single consumer needs.

## 3. Platform and dependency contract

- **React 19**, per the project peer range. In RSC environments, the module exports client components.
- **Modern evergreen browsers only.** No legacy-browser polyfills or feature shims beyond what Web-standard code needs.
- **Server rendering and hydration are safe.** The module renders the same markup on the server, before hydration, and with an empty target collection. `"use client"` marks the client boundary.
- **Runtime imports are limited to:**
  - `react` (and JSX runtime),
  - React DOM types,
  - `@base-ui/react/internals/useRenderElement` — a published-but-internals subpath the whole part pipeline is built on; drift pinned by the peer ranges,
  - `@base-ui/utils` subpaths that the implementation actually uses (verified available in 0.5.0: `addEventListener`, `useAnimationFrame`, `useIsoLayoutEffect`, `useRefWithInit`, `useStableCallback`). Type-only imports stay unrestricted.
- No additional runtime dependencies. No private Base UI imports. A missing `@base-ui/utils` export is a build failure, not an inline reimplementation.
- **Geometry model:** physical, vertical, top-to-bottom, in layout-viewport coordinates. RTL text and RTL columns are supported because they do not reverse vertical order. The layout viewport is the boundary; visual-viewport activation and pinch-zoom are out of scope (§2).
- **Verification:** manual browser QA is the standard for scrolling, navigation, focus, and assistive behavior (§15). `bun:test` unit tests cover pure logic with synthetic inputs (§16).

## 4. Target data and identity

### 4.1 The target collection

- `TocRoot` receives `targetIds: readonly string[]`: the authoritative, ordered collection of destination IDs.
- Membership and order come from the collection alone. Mounted Links never add, remove, reorder, or hide a target. One `TocRoot` may render several presentations (text outline, rail, subsets) whose links all point into the same collection; mounting, hiding, or unmounting a presentation does not change what is tracked.
- The collection may be empty. An empty collection is valid: trackers run, `currentId` is `null`, and the consumer decides whether an empty landmark renders (§8.3, §12).
- Consumers treat inputs as immutable snapshots: reconfigure by replacing the array or entry objects, never by mutating values in place. `refresh()` reschedules DOM measurement; it does not promise support for mutated props.
- In the `headings` lane (§8.3) the flat collection derives from the `headings` entry ids inside `TocRoot`; it is the authoritative collection under the same identity semantics: it changes only when the `headings` array identity changes.

### 4.2 Valid target ID

A string is a valid target ID when all of the following hold:

1. nonempty after no trimming (raw value; the component never trims or rewrites),
2. contains no ASCII whitespace (U+0009–U+000D, U+0020),
3. contains no unpaired UTF-16 surrogate code units (surrogate pairs are fine; unpaired surrogates cannot be serialized to a fragment).

The component never decodes, normalizes, or case-folds IDs. Raw DOM IDs and serialized URL fragments are distinct representations; the component owns exactly one deterministic encoding, `href = "#" + encodeURIComponent(id)`. IDs are case-sensitive and opaque.

### 4.3 Collection validation

`targetIds` is validated at the input boundary, on every commit. Errors are thrown (§10) when the collection contains:

- an entry that is not a valid target ID (§4.2),
- a duplicate entry.

The component does not deduplicate, sort, or rewrite the collection, and it does not scan the document to verify that configured IDs are document-wide unique (§2). It resolves `document.getElementById(id)` in the tracking document.

### 4.4 Link identity

- `TocLink` takes one canonical prop `targetId: string` and derives the fragment destination from it. Link does not parse `href` and does not accept `href` or `aria-current` from consumers; those props are component-owned (§8.6). TypeScript prevents the conflict for typed consumers; at runtime the component-owned values win.
- Membership: a Link whose `targetId` is absent from its root's collection is a configuration error. Rendering any subset of the collection is fine, and several Links may share one configured target. A destination outside the collection means the element should use an ordinary anchor instead.
- **Authoring constraint (not enforced):** within one rendered navigation landmark, render at most one Link per target, so a single set never contains two `aria-current="location"` elements. Separate `TocRoot` instances may each link the same document targets.

### 4.5 Configuration transitions

- Invalidation of **still-valid, active** configurations may lag until the next scheduled event: after props commit, the next measurement decides a new current target; consumers may observe the previous geometry-derived value until then.
- The following must **not** be observable, even briefly, after the commit that caused them:
  - a former current ID that is no longer a member of `targetIds`,
  - a former current ID left behind by an emptied collection,
  - any current value while tracking is inactive (`scrollElement` is `null`, or the configured scroller has no usable layout box).
  These transitions publish `null` immediately, without waiting for a measurement.
- Effect cleanup and StrictMode replays never manufacture transitions (§12).

### 4.6 Availability

At measurement time a configured target is **available** when:

1. its element resolves in the tracking document, and
2. the element currently has at least one box (`getClientRects()` is nonempty).

A target that is present but has no box (for example inside `display: none`) is temporarily unavailable, not an error; it cannot be current and its Link still renders as a normal anchor. A missing element is likewise tolerated and re-resolved at every measurement, which repairs same-ID node replacement without any target-collection change. Availability never changes navigation: a missing destination behaves natively in the browser (§13).

## 5. Scrolling surface

- One `TocRoot` instance tracks **one scrolling surface**:
  - `scrollElement` omitted → the document viewport of the tracking document;
  - `scrollElement` is an `Element` → that element's scrollport;
  - `scrollElement` is `null` → tracking is **inactive**. `currentId` is `null`. This is not a silent fallback to the viewport.
- `scrollElement` is a reactive DOM-element value (callback-ref state). A mutable ref object or getter would change node identity without notifying React. Attachment, replacement, and cleanup must be explicit.
- Ownership: in element mode, each resolved target must be a DOM descendant of the scroller. A resolved target outside the scroller is a configuration error (§10). Viewport mode requires targets in the tracking document.
- A scroller with no usable layout box makes tracking inactive until a later event observes a box (§7, §4.6). Hiding the navigation presentation never affects tracking; navigation and content are separate.
- No automatic scrollable-ancestor detection, no nested-scroll coordination, no observation of scrollers other than the configured one.

## 6. Current-location algorithm

Definitions, at a scheduled measurement:

- **Surface top edge:** viewport mode → the layout viewport's top edge; element mode → the scroller's visible (client-area) top edge. Both measured in viewport coordinates.
- **Headroom** of an available target: the distance from the surface top edge down to the target's top edge. Viewport: the target's `getBoundingClientRect().top`. Element: `targetRect.top − elementRect.top` (a common translation cancels).
- **Activation line:** `activationOffset` pixels below the surface top edge. `activationOffset` is a non-negative, finite CSS-pixel number, default `0`.
- **Crossed:** a target whose headroom is less than or equal to `activationOffset`.
- **Surface bottom reached:** the surface has actual vertical overflow (client viewport: `document.documentElement.scrollHeight > clientHeight`; element: `scrollHeight > clientHeight`) **and** the scroll position is at its maximum, within a small sub-pixel tolerance (number is an implementation detail).

**Rule.** Iterate available targets in configured order. The current target is the **last crossed** target. If no target crossed, `currentId` is `null` — **except** when the surface bottom is reached, in which case the current target is the **last available** target, even if it never reached the activation line.

Consequences, all intended:

- Before the first crossing there is no current target; an instance opening above the content reports `null`.
- A section stays current through the space after its heading; the heading may be far offscreen (including above a large `activationOffset`) and the section remains current.
- A large `activationOffset` can select a current target below the visible scrollport; there is no implicit viewport-height clamp. "Before the first crossing" means before crossing the activation line, not before entering view.
- Configured order is authoritative. Geometrically non-monotonic collections are not repaired or sorted; the rule above still selects the last crossed in configured order.
- Fully onscreen content is not bottom-exception fodder: with no overflow there is no bottom state, and a short page can remain `currentId = null` everywhere.
- The bottom is the configured surface's bottom, including unrelated page content such as footers. There is no article-end detection.
- There is no direction logic, no observer-callback race, no largest-visibility choice, and no proximity fallback. The rule is a pure function of one geometry sample.

**Output.** Tracking exposes at most `currentId: string | null`. No progress value, no visible-target set, no per-target visibility, no rewind or direction signal (§2).

## 7. Update triggers and lifecycle

**Geometry is always fresh.** Measurements resolve configured IDs again and read current rectangles. There is no position cache and no invalidation system (settled: the linear-pass correctness model is smaller than cache invalidation).

A measurement is scheduled by:

1. the initial commit after mount (first client render),
2. a `scroll` of the tracked surface (window viewport, or the configured element),
3. a layout-viewport `resize` (viewport mode), or an observed box resize of an element scroller (`ResizeObserver` on the configured element; the element-box 0→size transition also reactivates tracking),
4. a committed change to `targetIds`, `scrollElement` identity, or `activationOffset`,
5. an explicit `refresh()` call via `actionsRef`.

Scheduled work is coalesced (at most once per animation frame). Reads happen before any state-driven writes. State publishes only when `currentId` changes.

**The callback.** `onCurrentChange(id: string | null)` runs only on changes: initial `null` does not notify; a first measured non-null value notifies; identical measurements do not notify; replacing the callback identity does not re-notify the current value. Notifications occur after commit, never during render. There is no reason/direction payload, no cancellation, and no veto: current location is a reported result.

**Explicit limitations (documented, not bugs):** no trigger exists for stationary layout changes — images loading above content, font swaps, stylesheet-driven reflow, CSS animation or transforms while stationary, unrelated element scrollers moving targets, Suspense or external DOM updates, or `scrollHeight` growth inside an element scroller without a box-size change. Reaching the new bottom still requires scrolling, which is trigger 2; otherwise the content owner calls `refresh()` (trigger 5). The component runs no `MutationObserver`, no interval, and no continuous polling.

**Ownership violation** (an element-mode target resolving outside its scroller, §5) throws during the measurement effect.

**Cleanup.** Unmount and reconfigure cancel pending scheduled work. Unmount emits nothing. StrictMode replays re-measure and may legitimately re-emit the first measured value on the new instance (§12); cleanup never fabricates a `null` transition.

## 8. Component API

### 8.1 Anatomy

```tsx
import {
  TocRoot, TocList, TocItem, TocLink, TocGroup,
  useTocOutline, discoverHeadings, buildOutline,
} from "@/components/table-of-contents";

const { headings } = useTocOutline(article); // §9.3

// The fast lane: the function child maps the Root-owned outline, and
// TocGroup renders one subtree — item, link, and the recursion below it.
<TocRoot headings={headings}>
  <TocList>
    {(group) => <TocGroup key={group.id} group={group} />}
  </TocList>
</TocRoot>
```

The manual `targetIds` lane (§4.1) stays for consumers who own discovery and mapping themselves.

Default rendering:

| Part | Element | Default semantics |
| :--- | :--- | :--- |
| `TocRoot` | `<nav>` | `aria-label="Table of contents"` (consumer-overridable via `aria-label`/`aria-labelledby`) |
| `TocList` | `<ol>` | — |
| `TocItem` | `<li>` | — |
| `TocLink` | `<a>` | `aria-current="location"` when current |
| `TocGroup` | — | composite (`<li>` + `<a>` + nested `<ol>`): renders one `HeadingGroup` subtree; the nested list only when children exist |

### 8.2 Shared composition interface

Every part exposes the same Base UI composition surface:

- `className`: `string | ((state: TocXState) => string | undefined)`;
- `style`: `React.CSSProperties | ((state: TocXState) => React.CSSProperties | undefined)`;
- `render`: `ReactElement | ((props, state) => ReactElement)`;
- `ref` forwards to the rendered element (never to an actions object);
- all native props of the default element are accepted and merged, with consumer handlers running first.

State per part is minimal (§8.3, §8.6). `TocList` and `TocItem` have an **empty** state object; their function forms of `className`/`style` are accepted for interface uniformity only.

Consumers who replace the element through `render` own preserving semantics: they must produce an element that forwards the received props and ref to its DOM node (handbook contract). For `TocLink` specifically, §13.4 applies.

### 8.3 TocRoot

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `targetIds` | `readonly string[]` | — | Ordered destination IDs (§4.1–§4.3) — the `targetIds` lane. Mutually exclusive with `headings`: exactly one lane is provided (§10). Immutable snapshot; replace to reconfigure. |
| `headings` | `readonly Heading[]` | — | Flat heading entries (§9.1) — the `headings` lane. Mutually exclusive with `targetIds` (§10). Root derives the flat collection from the entry ids (§4.1) and builds the outline through `buildOutline` (§9.2). |
| `scrollElement` | `Element \| null` | undefined | The tracked scrolling surface. Omit for the document viewport; `null` deactivates tracking. |
| `activationOffset` | `number` | `0` | CSS pixels below the surface top edge that count as "reached". Finite and non-negative; otherwise an error. Tracking-only: coordinate with CSS `scroll-padding`/`scroll-margin` for navigation landings. |
| `onCurrentChange` | `(currentId: string \| null) => void` | — | Change-only notification of the current target ID (§7). |
| `actionsRef` | `React.RefObject<TocActions \| null>` | — | Receives `{ refresh(): void }`; see below. |
| `ref` | `React.Ref<HTMLElement>` | — | The rendered `<nav>` element. Distinct from `actionsRef` by design. |
| `className`, `style`, `render`, native props | — | — | Shared interface (§8.2). Default label overridable through native `aria-label`/`aria-labelledby`. |

**State — `TocRootState`:** `{ currentId: string | null }`.
**Attributes:** `data-slot="toc-root"`; `data-has-current=""` when `currentId` is not `null`.
**Behavior:** owns the tracker, coalescing, and notifications (§6–§7). `refresh()` re-resolves targets and remeasures, coalescing like any scheduled update; it does not force synchronous rendering, does not scroll, and returns nothing. Never exposes scheduling or observer internals.

### 8.4 TocList and TocItem

Structural composition parts with no distinguishing state.

| Prop | Value |
| :--- | :--- |
| default element | `<ol>` / `<li>` |
| state | `{}` (empty; function forms accepted for uniformity only) |
| attributes | `data-slot="toc-list"` / `data-slot="toc-item"` |

They render consumer-authored children as-is. The nesting composes in one of two lanes: `TocGroup` recursion (§8.5) is the default, and consumer-authored list structure takes over at any level that needs custom nodes; the tracking collection stays flat regardless of nesting depth.

`TocList` also accepts function children `(group: HeadingGroup) => React.ReactNode`, modeled on `Select.Value`: the part reads the Root context and renders `outline.map((group) => children(group))` into the `<ol>` — one callback element per top-level group, with keys consumer-authored. Function children require the Root to own an outline: in the `targetIds` lane the Root builds none and `TocList` throws (§10). Plain children render as-is in both lanes; every `TocList` given function children maps the same root outline, so deeper levels render from the group data the callback receives — through `TocGroup` children (§8.5) or the consumer's own plain children.

### 8.5 TocGroup

The composite part that owns the outline→JSX recursion: one `HeadingGroup` in (§9.2), one rendered subtree out. It has no host element of its own and no state, and it exposes no composition surface — §8.2 does not apply.

| Prop | Value |
| :--- | :--- |
| `group` | The one `HeadingGroup` to render |

**Contract:** renders `TocItem` > `TocLink` carrying `{group.title}`, plus a nested `TocList` of one `TocGroup` per child **only when `group.children` is non-empty**. The empty-`<ol>` guard is the part's rule: a childless group leaves no invalid list. The recursion keys itself from `child.id` inside the part; the consumer keys only the top-level `TocGroup` in a `TocList` function child (§8.4).

**No slot props:** a level that needs custom nodes — a custom link render, extra markup — bypasses `TocGroup` at that level and composes `TocList`/`TocItem`/`TocLink` directly (§13.4).

**Lanes:** the part reads no context itself — `TocItem`/`TocLink`/`TocList` own their context contracts — so it renders in both Root lanes wherever its `TocList`/`TocLink` ancestors are legal. The canonical pairing is `<TocList>{(group) => <TocGroup key={group.id} group={group} />}</TocList>`.

### 8.6 TocLink

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `targetId` | `string` | — | The canonical target ID. Must be a valid ID (§4.2) and a member of the root's collection; both are errors otherwise (§10). |
| `href`, `aria-current` | — | component-owned | Derived `href = "#" + encodeURIComponent(id)`; `aria-current="location"` exactly when current. Component-owned values win over conflicting consumer values at runtime. |
| `ref`, `className`, `style`, `render`, other native anchor props | — | — | Shared interface (§8.2). Consumer `onClick` handlers merge and run before internals; cancellation of native navigation by the consumer is allowed and respected. |

**State — `TocLinkState`:** `{ current: boolean }`.
**Attributes:** `data-slot="toc-link"`; `data-current=""` when current.

A Link must render inside a `TocRoot`; rendering one outside is an error. Regular anchors are always available for destinations outside the collection.

### 8.7 Inspection and adjacent UI

Hover/focus inspection, previews, panels, tick magnification, and disclosure state are **consumer-owned**. The component forwards events and refs; it owns no inspection state, no preview-open state, and no hover-selection. Two presentations under one root inspect independently. Base UI preview/tooltip primitives compose naturally for previews. Inspecting an entry never changes the document's current location, and navigating never changes inspection.

## 9. Outline utilities

The two utilities are explicit, synchronous, DOM-reading or value-only helpers, exported from the same file as the parts, and the hook (§9.3) packages the client-side discovery slot they document. No utility runs during component rendering (§12), none mutates its inputs or the document, and they return fresh values.

### 9.1 `discoverHeadings`

```ts
interface Heading { id: string; title: string; level: HeadingLevel }
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

declare function discoverHeadings(
  scope: Element,
  options?: { levels?: readonly HeadingLevel[] },
): readonly Heading[];
```

- **Scope:** descendants of `scope` only; `scope` itself is never included, whatever its tag. No document-wide scan.
- **Selection:** native heading elements `h1`–`h6` (case-insensitive tag match), filtered to the configured levels. Default levels: `2`–`6`; configurable to any subset of `1`–`6` (out-of-range values are errors; an empty list selects nothing and yields an empty result).
- **Order:** document order (`querySelectorAll` order).
- **Titles:** the heading's text content, excluding descendants with a `hidden` attribute or `aria-hidden="true"` (attribute comparison), excluding `script`/`style` descendants, then trimmed with internal whitespace runs collapsed to single spaces. Permalink icons and other decorations must be marked by the author; the utility does not guess.
- **Errors (throw):** a selected heading with a missing or invalid ID (§4.2 rules apply to IDs the utility would return), an ID repeated among selected headings, or a title empty after cleaning.
- **Semantics:** a snapshot with **no layout reads** — visually hidden headings (CSS `visibility`, offscreen positioning, closed disclosures) are included, and nothing is measured. Snapshot semantics: content changes require calling it again. The utility never mutates the DOM and never generates IDs.

### 9.2 `buildOutline`

```ts
type HeadingGroup = Heading & { children: readonly HeadingGroup[] };

declare function buildOutline(headings: readonly Heading[]): readonly HeadingGroup[];
```

- **Input validation (thrown):** every entry must have a valid ID (§4.2), a nonempty cleaned title, and a `level` that is an integer in `1`–`6`; IDs must be unique across the input. This is the input boundary for consumer-supplied data; discovery output already satisfies it.
- **Grouping rule:** an entry at level *L* groups the following entries with level greater than *L*, until an entry with level ≤ *L* appears at the same depth. Concretely:
  - equal level → sibling;
  - deeper level → child of the nearest preceding lower-level entry in document order;
  - skipped levels create **no synthetic nodes**: `h2 → h4` nests the `h4` directly under the `h2`;
  - the first entry, however deep, roots a top-level group;
  - a later entry shallower than the current branch starts a new top-level group; earlier branches are never re-parented.
- **Output shape:** every node carries `{ id, title, level, children }`; `children` is always present (an empty array when there are none), so consumers need no emptiness branching.
- **Purity:** fresh arrays and objects; the input is neither referenced nor mutated afterwards (values are copied in).

The output renders however the consumer likes — through `TocGroup` (§8.5) by default or consumer-authored composition; no part of the tracker consumes `HeadingGroup`.

### 9.3 `useTocOutline`

```ts
declare function useTocOutline(scope: Element | null): {
  headings: readonly Heading[];
  outline: readonly HeadingGroup[];
};
```

- **Role:** the consumer hook packages the "after-commit-before-paint" discovery slot: one layout-effect snapshot of `scope` per scope identity (§9.1), grouped through `buildOutline` (§9.2). A `null` or unmounted scope yields the empty pair.
- **Snapshot contract:** the hook runs one discovery per scope identity; it does not watch the DOM. Content that mutates under the same element needs an explicit re-discovery outside the hook (§9.1). Scope is the only input — no options parameter, because an options object changes identity per render and would re-discover forever.
- **SSR:** every server render yields the empty pair: layout effects never run in `react-dom/server`, and the module reads no `document` outside effect callbacks (§12).
- **Why not during rendering (§12):** renders rerun and are discarded under StrictMode and concurrent rendering, so their output must depend only on props and state; the scanned article is usually a sibling subtree that does not exist during the navigation's render (commit ordering); and the server holds no `document`. The layout effect is that slot, packaged here.

## 10. Error contract

All errors are synchronous `Error` throws at the owning boundary; error **message wording is not a public contract** (no error classes or codes in the initial version — YAGNI). Throw sites:

| Error | Thrown at |
| :--- | :--- |
| invalid or repeated entry in `targetIds` | Root render commit (§4.3) |
| no tracking lane or both lanes on a Root (`targetIds` and `headings` together, or neither) | Root render commit (§4.3) |
| invalid `targetId` on a Link | Link render |
| Link outside a Root / `targetId` not in collection | Link render |
| non-finite or negative `activationOffset` | Root render commit |
| element-mode target resolving outside its scroller | measurement effect (§5, §7) |
| discovery: missing/invalid ID, duplicate ID, empty title | `discoverHeadings` call |
| discovery: invalid `levels` values | `discoverHeadings` call |
| outline: invalid entry shape or duplicate ID | the `buildOutline` call, directly or through TocRoot's `headings` lane (§9.2) |
| `TocList` function children without a Root-owned outline (`targetIds` lane) | List render (§8.4) |

Nothing is silenced, deduplicated away, or auto-repaired: an invalid collection is a programming error (§2), while temporarily missing nodes are legitimate state (§4.6).

## 11. Accessibility contract

- `TocRoot` is a **named navigation landmark**; the consumer names it via `aria-label` or `aria-labelledby`.
- The current entry is marked `aria-current="location"`. With the §4.4 authoring constraint honored, at most one element in a navigation set carries it (WAI-ARIA recommends a single current element per set).
- Entries are real links: full native keyboard behavior (`Tab`, `Enter`, modified activation, browser focus-navigation), no `tabindex` anywhere, no roving focus, no arrow-key model, no live region, and no focus transfer to targets.
- The scrubber presentation keeps **link** semantics: every tick is an anchor with an accessible name even when its visible content is minimal.
- Native fragment navigation provides the subsequent keyboard-navigation starting point at the destination; the component does not add `tabindex` to headings or steal focus. Screen-reader announcement specifics are verified manually (§15), not claimed automatically.

## 12. SSR, hydration, StrictMode

- **Server and first-hydration render:** `currentId` is `null`; markup matches. The server renders the authored nav, lists, items, and links with derived `href`s (a pure function of `targetId`). No loading placeholders, no automatic hiding of empty outlines, no children the server cannot produce.
- **Discovery is client-DOM-only** and never runs in render. A consumer hydrating content that depends on `discoverHeadings` must produce matching markup on the server themselves, or render the navigation after hydration; the component does not reconcile the two.
- **After hydration** the first measurement may notify a change (initial `null` suppresses the first `null` only).
- **StrictMode:** effects and callback refs replay; cleanups cancel pending work; replay may legitimately re-emit a first measured value on the new instance (§7). Nothing else notifies.
- **With JavaScript unavailable**, links navigate natively; tracking, `data-current`, and `refresh()` are inert.

## 13. Native-navigation preconditions

Browser-owned navigation (settled in Round 3) keeps: fragment resolution, ancestor scrolling, CSS offsets, history entries, `hashchange`, `:target`, and the focus-navigation starting point. The component intercepts nothing and writes no history. Therefore:

### 13.1 Fragment-alias precondition

Native fragment lookup first matches the literal fragment document-wide (including legacy `<a name>`), before percent-decoding. An element elsewhere in the document with a literal ID equal to the encoded form (for example `id="%C3%A9"` competing with `id="é"`) will capture that navigation. The component guarantees deterministic, single-pass encoding of the raw ID (§4.2); document-wide alias freedom is an authoring precondition and is not validated by the component (§2).

### 13.2 `<base>` precondition

Fragment URLs must resolve to the tracking document (a conflicting `<base href>` is unsupported), and ordinary activation must stay in the current browsing context (`<base target>` must not redirect). Header-offset landing behavior is consumer CSS (`scroll-padding` on the scroller, `scroll-margin` on headings); `activationOffset` does not move the landing point.

### 13.3 Back/forward

Native history paging restores scroll positions per its own algorithms; the component neither enhances nor fights this. Programmatic `pushState`/`replaceState` by consumers is their own contract and does not trigger the tracker's navigation behavior.

### 13.4 Custom renderers

A `render` replacement for `TocLink` must produce an element that natively activates the navigation (an anchor or equivalent), spreads the received props (including the component-owned `href`, `aria-current`, `data-*`) onto its DOM node, and forwards the ref. Replacing the anchor with something that intercepts activation breaks the navigation contract by definition.

## 14. Consumer responsibilities (summary)

- Own the target collection and its order; keep IDs valid and unique; treat inputs as immutable.
- Call `refresh()` after content changes that no scheduled event covers (§7).
- Own presentation: styles, inspection state, previews, disclosures, animations, empty states; `TocGroup` renders the outline nesting by default (§8.5), and the consumer nests any level that bypasses it.
- Coordinate `activationOffset` with CSS scroll offsets when a landing position must correspond to a crossing.
- Honor the authoring constraints in §4.4 and §13.
- Verify assistive-technology behavior manually (§15).

## 15. Manual QA acceptance checklist

Run in current Chrome, Firefox, and Safari, viewport and element-scroller modes:

1. `currentId` starts `null`; first crossing notifies; scrolling up past headings re-selects the last crossed.
2. Activation line lands where expected for offsets `0`, a fixed-header-style offset, and an offset larger than the viewport height (current target may sit below the fold — intended).
3. Bottom exception: short final section becomes current at the bottom; short page with no overflow reports `null` throughout.
4. Element scroller: its scroll drives tracking; document scrolling under it does not; `scrollElement={null}` deactivates; unmounting/reattaching via callback-ref state resumes correctly.
5. Targets inside an overflow panel in **viewport** mode are tracked; native anchor navigation to them scrolls inner and outer ancestors per browser rules.
6. Late-mounted and replaced same-ID targets become current at the next event; `refresh()` picks up image/font reflow while stationary.
7. Missing target: anchor renders and navigates natively; tracker skips it; no crash.
8. `targetIds` replaced: previous current reported as `null` immediately if removed from the collection; new current appears at the next scroll/refresh.
9. Links: `href` and `aria-current` correct; modified click opens a new tab; middle click behaves; browser back/forward accumulates entries and restores per browser rules; direct load with `#fragment` lands correctly with consumer `scroll-padding`.
10. Keyboard: Tab order follows links; Enter navigates; after native navigation, subsequent Tab continues near the destination.
11. Hydration: server HTML and first client render match; StrictMode double-invoke causes no extra notifications beyond the documented re-emission.
12. `discoverHeadings` ignores the scope element itself, excludes `aria-hidden`/`hidden` title content and script/style, trims whitespace, throws on missing/duplicate IDs and empty titles, and includes CSS-hidden headings.
13. `buildOutline` nests per §9.2 including skipped levels, a deep first heading, and a later shallower heading; `children` is always an array; input is not mutated.
14. Composition: `render` on every part swaps elements while state props and refs reach the DOM node; `className`/`style` state functions receive the documented state.
15. Empty collection renders an empty landmark with `currentId = null`; the consumer's empty-state styling applies.
16. RTL article text: tracking and navigation behave identically (vertical geometry unaffected).

## 16. Implementation plan

Deliverables, in order, all constrained by AGENTS.md (co-location, strict types, no premature abstraction):

1. **`src/table-of-contents.tsx`** — the entire product in one file: constants (`UPPER_SNAKE_CASE`), types, ID/level validation, the pure selection step (§6) expressed over an injected geometry sample, the tracker (resolution, measurement, scheduling, notifications) as a Root-owned hook + context, the four parts via `useRender`/`mergeProps`, and the two utilities. The pure functions must be unit-testable without a DOM.
2. **`test/*.test.ts(x)`** — `bun:test` units for: ID validation (whitespace, empty, surrogates), collection duplicate detection, the crossing rule and bottom exception over synthetic geometries (including equal tops and non-monotone order), `activationOffset` validation, `buildOutline` grouping and validation, and title-cleaning rules where expressible purely. SSR boundaries for `TocGroup` (§8.5): the canonical subtree markup over a headings-lane Root, the empty-children guard (no nested `<ol>`), and structural equality of function children + `TocGroup` against manual nested rendering. No DOM-mocking of scroll behavior; that is §15's job. Add no test dependencies beyond types already present.
3. **README rewrite** — remove the leftover Masonry content; document anatomy, props/attributes tables mirroring §8, semantics, SSR notes (§12), preconditions and limitations (§13, §2, §14), and the QA expectation (§15) in place of any bundle-size table until a measurement path exists.
4. **Type-check surface** — remove `src/references` from checked scope (move out of `src` or exclude in `tsconfig.json`) so `bun run type-check` fails only on real product code.
5. **Manual QA pass** per §15 in a real browser; record results in the README. No browser-test infrastructure (settled Round 1).

## 17. Decision register

Compressed record of the interview, for traceability. R1–R6 = rounds; Q numbers in parentheses.

| Area | Decision |
| :--- | :--- |
| Product | In-page navigation primitive; text outline and compact scrubber share one call stack (R1; R2 Q6) |
| Delivery | Single vendorable file; no package build or speculative utility exports now (R1) |
| Platform | React 19, evergreen browsers, SSR/hydration safe, explicit client boundary (R1) |
| Dependencies | React + public Base UI APIs incl. `@base-ui/utils`; nothing added without demonstrated need (R1) |
| Verification | Manual QA; `bun:test` units for pure logic; no automated browser suite (R1) |
| Interaction | Links are the foundation for both presentations; inspection ≠ location; no drag/slider initially (R2 Q6, R3 Q10) |
| Source of truth | Explicit ordered collection; no discovery-in-root, no link-registration membership (R2 Q7, R5 Q37) |
| Scroller | Viewport or explicitly chosen element/null; one surface; reactive value (R2 Q8, R4 Q26) |
| Current model | Single current target or null; no visible-set, no progress (R2 Q9, R3 Q16) |
| Identity | Author-owned raw case-sensitive IDs, same document; no generation; no shadow/cross-document (R2 Q11, R3 Q11) |
| Rendering | Compound parts only; consumer-owned semantic nesting (R3 Q12) |
| Discovery | Opt-in scoped snapshot utility; native headings h2–h6 default (R3 Q13, R4 Q28) |
| Location authority | Geometry-derived; no controlled override; inspection stays consumer-owned (R3 Q14, R5 Q30) |
| Selection rule | Last crossed at surface-top + non-negative px offset; bottom exception only with real overflow (R3 Q15, R4 Q21–Q22) |
| Lifecycle | Event-driven fresh measurements; explicit `refresh()` via `actionsRef`; no continuous monitoring; missing targets tolerated (R3 Q33, R4 Q23–Q24, R5 Q32, Q40) |
| Invalid inputs | Duplicates/empty/whitespace IDs rejected; ownership violations reject; membership enforced on Links (R4 Q25, R5 Q37, Q40) |
| Geometry | Fresh O(n) pass, no cache; publish on change only; physical vertical layout-viewport coordinates (R4 Q27, R5 Q45) |
| Surface | Four parts, no decoration machinery; uniform composition interface incl. state-function className/style (R5 Q29, Q31) |
| State | Root `{currentId}`, Link `{current}`, List/Item `{}`; data-slot everywhere; `data-current`, `data-has-current` (R5 Q38) |
| A11y defaults | Named nav, `<ol>`, `<li>`, anchors, `aria-current="location"` only; no live regions/focus transfer (R5 Q39) |
| Change notification | `onCurrentChange(id \| null)`, change-only, no reasons/cancellation (R5 Q34) |
| Utilities | Flat `{id,title,level}` snapshot; usable-ID errors; plus pure nested-outline builder (R5 Q35–Q36, Q41–Q43) |
| Server | Normal rendering, `null` initial; empty states consumer-owned (R5 Q44) |
| Close-out (adopted recommendations) | Fragment-alias and `<base>` preconditions (§4.4/13); one-current-link-per-landmark authoring rule; immediate-null transition rule (§4.5); builder rules and always-present `children` (§9.2); plain `Error`, non-normative messages (§10); immutable-input contract (§4.1) |
| Close-out (R7 revision) | React 19 ref-as-prop delivery of `ref`; parts compose through published-internals `useRenderElement`; parse-don't-validate boundaries (`parseTargetCollection`, `parseActivationOffset`, `parseOutlineHeadings`); definition order follows one stated rule |
| Outline data lane (R8) | Consumer hook `useTocOutline` (one snapshot per scope identity, SSR-empty); `TocRoot` lanes `targetIds`/`headings`, mutually exclusive; `TocList` function children over the root-context outline, `Select.Value`-modeled; playground simplified to per-variant helpers |
| Outline rendering (R9) | `TocGroup` composite part owns the outline→JSX recursion (one `HeadingGroup` in, `TocItem`/`TocLink`/guarded nested `TocList` out); playground helper components removed; shape, naming, and no auto-list on `TocList` decided with the user |
