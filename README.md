# base-ui-toc

An unstyled, copy-and-paste Table of Contents for in-page navigation in React 19 projects. It tracks one current location in the content while the reader scrolls, and it renders native fragment links that move the reader to sections. Made to be used alongside [Base UI](https://base-ui.com).

One call stack serves two presentations:

- a classic text outline (nested lists of links)
- a compact scrubber-style rail (small ticks with accessible names)

The difference is presentation only. There is no second interaction model: every entry is a link, hovering or focusing an entry inspects it, and activating it navigates. Floating panels, previews, tick magnification, progress meters, and disclosure state are consumer-composed UI. The component forwards events and refs, and it owns no inspection state. Inspecting an entry never changes the document's current location, and navigation never changes inspection.

## Use

### 1. Install dependencies

```bash
npm install @base-ui/react @base-ui/utils
```

```bash
pnpm add @base-ui/react @base-ui/utils
```

```bash
bun add @base-ui/react @base-ui/utils
```

### 2. Copy the file into your project

[src/table-of-contents.tsx](./src/table-of-contents.tsx) is the entire product in one file. Copy it into your repository, read it, and change it to match your team's standards and goals. Adjust the import path in the examples below to the file's new location.

## Anatomy

Import the parts, and assemble them together:

```tsx
import {
  TocRoot, TocList, TocItem, TocLink,
  useTocOutline, discoverHeadings, buildOutline,
} from "@/components/table-of-contents";

// Discovery runs after commit, before paint — never during rendering:
// renders rerun under StrictMode and concurrency and must depend only on
// props and state, the scanned article does not exist during the nav's
// render, and the server holds no document.
const { headings } = useTocOutline(article);

return (
  <TocRoot headings={headings}>
    <TocList>
      {/* The function child maps the Root-owned outline; keys stay yours. */}
      {(group) => <OutlineItemGroup key={group.id} group={group} />}
    </TocList>
  </TocRoot>
);

function OutlineItemGroup({ group }: { group: HeadingGroup }) {
  return (
    <TocItem>
      <TocLink targetId={group.id}>{group.title}</TocLink>
      {group.children.length > 0 && (
        <TocList>
          {/* deeper levels map your own group data */}
          {group.children.map((child) => (
            <OutlineItemGroup key={child.id} group={child} />
          ))}
        </TocList>
      )}
    </TocItem>
  );
}
```

The id-only `targetIds` lane stays for manual consumers: you own discovery, grouping, and the nesting yourself, and render the nesting from your own outline data:

```tsx
const headings = article == null ? [] : discoverHeadings(article);
const outline = buildOutline(headings);

<TocRoot targetIds={headings.map((heading) => heading.id)}>
  <TocList>
    {outline.map((group) => (
      <TocItem key={group.id}>
        <TocLink targetId={group.id}>{group.title}</TocLink>
        {group.children.length > 0 && (
          <TocList>
            {/* deeper levels, same shape */}
          </TocList>
        )}
      </TocItem>
    ))}
  </TocList>
</TocRoot>
```

Default rendering:

| Part | Element | Default semantics |
| :--- | :--- | :--- |
| `TocRoot` | `<nav>` | `aria-label="Table of contents"` (override with `aria-label` or `aria-labelledby`) |
| `TocList` | `<ol>` | — |
| `TocItem` | `<li>` | — |
| `TocLink` | `<a>` | `aria-current="location"` when current |

## Outline utilities

Two synchronous helpers and one hook come with the parts, and all three are dispatched from the same file:

- `discoverHeadings` reads a flat heading snapshot from the DOM.
- `buildOutline` groups flat headings into a nested outline.
- `useTocOutline` packages discovery and grouping into one client-side hook.

The helpers do not mutate their inputs or the document, and they return fresh values. They do not measure layout, so visually hidden headings are included. Neither helper runs during component rendering.

### `discoverHeadings`

`discoverHeadings(scope, options?)` returns `{ id, title, level }` entries, in document order, for native heading elements `h1`–`h6` among the descendants of `scope`. The `scope` element itself is never included, whatever its tag. Headings `h2`–`h6` are selected by default; pass `levels` to select any subset of `1`–`6`. An empty list selects nothing:

```tsx
const headings = discoverHeadings(article);
const headings2To3 = discoverHeadings(article, { levels: [2, 3] });
```

Titles come from the heading text, with `hidden` and `aria-hidden="true"` subtrees removed, `script` and `style` removed, trimmed, and whitespace runs collapsed to single spaces. Mark permalink icons and other decorations with one of those attributes yourself; the utility does not guess.

Discovery is a snapshot with no layout reads: content changes require another call. It throws when a selected heading has a missing or invalid ID, a duplicate ID, or an empty title after cleaning.

### `buildOutline`

`buildOutline(headings)` groups flat entries: an entry at level L collects the deeper entries that follow it, until an entry at level L or shallower appears. Skipped levels create no synthetic nodes — an `h4` after an `h2` nests directly under the `h2`. A later heading shallower than the current branch starts a new top-level group:

```tsx
buildOutline([
  { id: "intro", title: "Intro", level: 2 },
  { id: "detail", title: "Detail", level: 4 },
]);
// [
//   {
//     id: "intro", title: "Intro", level: 2,
//     children: [{ id: "detail", title: "Detail", level: 4, children: [] }],
//   },
// ]
```

Every node carries `id`, `title`, `level`, and an always-present `children` array, so rendering needs no emptiness branching. `buildOutline` is the input boundary for consumer-supplied data: it throws for an invalid ID, a level outside `1`–`6`, an empty title, or a duplicate ID.

### `useTocOutline`

`useTocOutline(scope)` packages the above: it discovers the headings of `scope` in a layout effect — one client-side snapshot per scope identity — and returns `{ headings, outline }`, already grouped through `buildOutline`:

```tsx
const [article, setArticle] = useState<HTMLElement | null>(null);
const { headings, outline } = useTocOutline(article);
```

A `null` or unmounted scope yields the empty pair. Scope is the only input, so a scope identity change is the only re-discovery trigger; content that mutates under the same element re-discovers itself (like the dynamic-targets playground variant). On the server, every render yields the empty pair, because layout effects never run there and no `document` read escapes the effect callbacks.

The layout effect — not a render-time read — is deliberate: renders rerun under StrictMode and concurrency and must depend only on props and state; the scanned article usually renders in a sibling subtree that does not exist during the navigation's own render; and the server holds no `document`. The hook is that after-commit-before-paint slot, packaged.

## API reference

### Target IDs

A valid target ID is a non-empty string that holds no ASCII whitespace (tab through carriage return, plus space) and no unpaired surrogate. IDs are case-sensitive and raw: the component never trims, decodes, case-folds, or rewrites them. A link encodes the destination itself: `href = "#" + encodeURIComponent(id)`.

The component does not check that an ID is unique across the document. A target with no matching element, or with no box (for example inside `display: none`), is unavailable: it cannot be current, but it is not an error, and its link still renders and navigates as a normal anchor.

### `TocRoot`

The tracked navigation landmark. Renders a `<nav>` element.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `targetIds` | `readonly string[]` | — | Ordered destination IDs — the `targetIds` lane. This collection alone is the source of truth for membership and order: mounted links never add, remove, reorder, or hide a target. Treat it as an immutable snapshot; replace the array to reconfigure. An empty collection is valid: trackers run, `currentId` is `null`, and the empty landmark is your decision. Mutually exclusive with `headings`: pass exactly one lane, or the render throws. |
| `headings` | `readonly Heading[]` | — | Flat heading entries — the `headings` lane. `TocRoot` derives the tracked collection from the entry ids (same identity semantics as `targetIds`) and builds the outline through `buildOutline`; a `TocList` function child then maps it (see `TocList`). Immutable snapshot; replace the array to reconfigure. Mutually exclusive with `targetIds`. |
| `scrollElement` | `Element \| null` | `undefined` | The tracked scrolling surface. Omit to track the document viewport. Passing the tracking document's root element is equivalent to omitting it: the root element is the viewport. Pass an element to track that scrollport. `null` deactivates tracking: `currentId` is `null`; this is not a fallback to the viewport. One `TocRoot` tracks one surface. |
| `activationOffset` | `number` | `0` | CSS pixels below the surface top edge that count as "reached". Must be finite and non-negative. Tracking-only: coordinate with CSS `scroll-padding` and `scroll-margin` for navigation landings. |
| `onCurrentChange` | `(currentId: string \| null) => void` | — | Change-only notification of the current target ID. Runs after commit, never during render. Replacing the callback identity does not re-notify the current value. |
| `actionsRef` | `React.RefObject<TocActions \| null>` | — | Receives `{ refresh(): void }`. Distinct from `ref` by design. |
| `ref` | `React.Ref<HTMLElement>` | — | The rendered `<nav>` element. |
| `className`, `style`, `render` | — | — | Shared composition interface (see below). |
| native props | — | — | All native `<nav>` props are accepted and merged; your handlers run first. Pass `aria-label` or `aria-labelledby` to override the default label. |

```ts
type TocRootState = {
  /** The ID of the current target, or null before the first crossing. */
  currentId: string | null;
}
```

| Attribute | Description |
| :--- | :--- |
| `data-slot="toc-root"` | Always present. |
| `data-has-current` | Present when `currentId` is not `null`. |

Behavior:

- `TocRoot` owns the tracker: measurement scheduling, coalescing, and change notifications.
- Exactly one tracking lane is provided: `targetIds` alone, or `headings` alone; both or neither throws an `Error` at render. In the `targetIds` lane the entries are validated synchronously; in the `headings` lane `buildOutline` is the single validator for entry shapes. Nothing is deduplicated, sorted, or rewritten.
- `activationOffset` is validated synchronously at render: a non-finite or negative offset throws an `Error`.
- `refresh()` re-resolves targets and measures again. It coalesces like any other scheduled update; it does not force a synchronous render, does not scroll, and returns nothing.

### `TocList` and `TocItem`

Structural composition parts. They render your children as-is:

| | `TocList` | `TocItem` |
| :--- | :--- | :--- |
| Default element | `<ol>` | `<li>` |
| State | `{}` | `{}` |
| Attributes | `data-slot="toc-list"` | `data-slot="toc-item"` |

The nested list structure is yours and mirrors your outline data; the tracked collection stays flat at any nesting depth. The empty state object carries nothing, and the function forms of `className` and `style` are accepted for interface uniformity only.

`TocList` also accepts a function child `(group) => ReactNode`, modeled on Base UI's `Select.Value`: with the `headings` lane, the part reads the outline `TocRoot` built from your `headings` prop and renders one callback element per top-level group — the mapping moves into the part, and keys stay yours. Function children throw under the `targetIds` lane, which owns no outline. Plain children render as-is in both lanes, and every level below the mapped one keeps mapping your own group data. Every `TocList` with function children maps the same top-level groups, so nest plain children below the mapped level.

### `TocLink`

A native fragment link to one configured target. Renders an `<a>` element.

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `targetId` | `string` | — | The canonical target ID. It must be a valid ID, and it must be a member of the root collection; both violations throw at render. |
| `href`, `aria-current` | — | component-owned | `href` derives as `"#" + encodeURIComponent(targetId)`, and `aria-current="location"` appears exactly when the link is current. Component-owned values win over conflicting consumer values at runtime. |
| `ref`, `className`, `style`, `render`, other native anchor props | — | — | Shared composition interface (see below). Your `onClick` handlers merge and run before internals; preventing the native navigation yourself is allowed and respected. |

```ts
type TocLinkState = {
  /** Whether this link's target is the current location. */
  current: boolean;
}
```

| Attribute | Description |
| :--- | :--- |
| `data-slot="toc-link"` | Always present. |
| `data-current` | Present when the link's target is current. |

Notes:

- A `TocLink` must render inside a `TocRoot`; outside, it throws. Use an ordinary anchor for destinations that are not in the collection.
- Rendering any subset of the collection is fine, and several links may share one configured target.
- Within one rendered navigation landmark, render at most one link per target, so one set never carries two `aria-current="location"` elements. Separate `TocRoot` instances may each link the same document targets.

### Shared composition interface

Every part exposes the same Base UI composition surface (see the [customization handbook](https://base-ui.com/react/handbook/composition)):

- `className`: `string | ((state) => string | undefined)`
- `style`: `React.CSSProperties | ((state) => React.CSSProperties | undefined)`
- `render`: `ReactElement | ((props, state) => ReactElement)`
- `ref` forwards to the rendered element, never to an actions object.
- All native props of the default element are accepted and merged, with your handlers running first.

The state functions receive the part's state, so styling can follow the tracked location:

```tsx
<TocLink
  targetId={...}
  className="toc-link"
  style={({ current }) => (current ? { fontWeight: 700 } : undefined)}
/>
```

A `render` replacement must produce an element that forwards the received props and ref to its DOM node. For `TocLink`, hold the anchor behavior yourself (see Custom renderers below). `TocRoot` merges the whole interface on the `<nav>`: the default label occupies the merge's first slot, so your `aria-label` or `aria-labelledby` wins.

## Tracking behavior

### The current-location rule

The tracked surface has a top edge: the viewport's top edge in viewport mode, or the scroller's visible top edge in element mode. The activation line sits `activationOffset` pixels below that edge. A target whose top edge is above this line (distance less than or equal to the offset) has crossed.

At each measurement, the current target is the **last crossed** target in collection order (either lane):

- Before the first crossing there is no current target. A document open above the content reports `null`, and "before the first crossing" means before crossing the activation line, not before entering view.
- A large `activationOffset` can select a target below the fold: there is no clamp to the viewport height. A section stays current through the space after its heading, so the heading can be far offscreen.
- Configured order is authoritative. Geometrically non-monotonic collections are not repaired or sorted.
- **Bottom exception:** when the surface has real vertical overflow and its scroll position reaches the maximum, the current target becomes the last available target, even if it never crossed. On a surface with no overflow there is no bottom state, so a short page reports `null` everywhere. The bottom is the configured surface's bottom, including unrelated content such as footers; there is no article-end detection.

The output is only `currentId: string | null`. There is no progress value, no visible-target set, no per-target visibility, and no direction signal; compose such UI outside the core.

Unavailable targets — missing elements and box-less elements — participate in neither the crossing rule nor the bottom exception. They re-resolve at every measurement, which repairs same-ID node replacement without any collection change.

### When tracking runs

Measurements resolve the configured IDs again and read current rectangles each time; there is no position cache. Scheduled work coalesces to at most one measurement per animation frame, and state publishes only when `currentId` changes. A measurement is scheduled by:

1. the first client commit after mount;
2. a `scroll` of the tracked surface (document viewport, or the configured element);
3. a layout-viewport `resize` (viewport mode), or a box resize of the configured element (`ResizeObserver`; a 0→size box transition also reactivates tracking, and a lost box deactivates it immediately);
4. a committed change to the tracking collection (either lane), `scrollElement` identity, or `activationOffset`;
5. an explicit `refresh()` call through `actionsRef`.

Documented gaps — with no trigger, not bugs:

- Stationary layout changes: images that load above the content, font swaps, stylesheet-driven reflow, CSS animation or transforms while stationary, Suspense or external DOM updates, and unrelated element scrollers moving the targets.
- Content height growth inside an element scroller with no box-size change.

Reaching a moved position still needs a scroll; otherwise the content owner calls `refresh()`. The component runs no `MutationObserver`, no interval, and no continuous polling.

A `TocLink`'s membership and the collection's validity throw synchronously at render. An element-mode target that resolves outside its configured scroller throws during the measurement effect, because targets in element mode must be DOM descendants of the scroller. The error surfaces as an uncaught exception from the scheduled measurement callback, and React error boundaries do not catch it. The error repeats on every scheduled event while the configuration stays broken.

### Immediate `null` transitions

These configuration changes publish `null` at once, with no wait for a measurement:

- the current target is removed from the tracking collection, including by an emptied lane;
- `scrollElement` becomes `null`, so tracking is inactive;
- an element scroller with no usable layout box arrives or loses its box.

Other changes lag by design: after a commit, the next scheduled measurement decides the new current target, and you can observe the previous value until then. Unmounting emits nothing and cancels pending work; cleanup never fabricates a `null` transition.

## Server rendering and StrictMode

- The server render, the first client render, and an empty collection produce the same markup: `currentId` is `null`, with no loading placeholders and no automatic hiding of empty outlines. You can render the full nav, lists, items, and links on the server, because a link's `href` is a pure function of its `targetId` — and the `headings` lane's function children map from prop data the server also holds.
- Discovery is client-only and never runs in render. If your content depends on the discovered outline, produce matching server markup yourself, or render the navigation after hydration; the component does not reconcile the two.
- After hydration, the first measurement can notify a change. The first measured `null` does not notify; the first measured non-null value does.
- Under StrictMode, effects and callback refs replay, and cleanups cancel pending work. A replay can re-emit the first measured value on the new instance; nothing else notifies.
- Without JavaScript, the links navigate natively. Tracking, `data-current`, and `refresh()` are inert.

## Preconditions and limitations

The component targets modern evergreen browsers, with no polyfills beyond what standard code needs. The browser owns navigation: fragment resolution, ancestor scrolling, CSS offsets, history entries, `hashchange`, `:target`, and the focus-navigation starting point. The component intercepts nothing and writes no history. Therefore:

- **Fragment aliases.** Native fragment lookup matches the literal fragment document-wide before percent-decoding. Keep no element with a literal ID equal to an encoded form (for example `id="%C3%A9"` competes with `id="é"`) unless you want it to capture that navigation. The component guarantees its one deterministic encoding; document-wide alias freedom is your authoring precondition and is not validated.
- **`<base>`.** A conflicting `<base href>` is unsupported: fragment URLs must resolve to the tracking document. `<base target>` must not redirect activation out of the current browsing context. Land with a header offset through CSS: `scroll-padding` on the scroller and `scroll-margin` on headings. `activationOffset` does not move the landing point.
- **Back and forward.** History paging restores scroll positions per the browser's own rules; the component neither enhances this nor fights it. Your own `pushState` and `replaceState` calls are your own contract and do not trigger tracker navigation.
- **Custom renderers.** A `render` replacement for `TocLink` must render an element that natively activates the navigation (an anchor or equivalent), spreads the received props — including the component-owned `href`, `aria-current`, and `data-*` — onto its DOM node, and forwards the ref. An element that intercepts activation breaks the navigation contract.

### Explicit non-goals

Each omission below is deliberate; compose the behavior outside the core:

- Reading-progress percentages, scroll percentages, and per-target visibility sets.
- Drag-to-navigate, slider or listbox semantics, and hover-to-navigate.
- Heading ID generation, slugging, and document mutation.
- Continuous monitoring (`MutationObserver`, animation frames, polling) of every stationary layout shift.
- A controlled current-location override.
- Shadow roots, cross-document targets, nested or coordinated scrollers, and automatic scrollable-ancestor detection.
- Horizontal scrolling, vertical writing modes, visual-viewport and pinch-zoom geometry, and rotated or scaled scrolling surfaces.
- Label, Indicator, Preview, or Content parts, and built-in animation of any kind.
- Automated browser-testing infrastructure.
- Validation that a fragment name is unique across the whole document.

### Consumer responsibilities

- Own the target collection and its order; keep IDs valid and unique; treat inputs as immutable snapshots (replace the array or entry objects, never mutate values in place).
- Call `refresh()` after content changes that no scheduled event covers.
- Own presentation: styles, nesting, inspection state, previews, disclosures, animations, and empty states.
- Coordinate `activationOffset` with CSS scroll offsets where a landing position must correspond to a crossing.
- Honor the authoring constraints above (one current link per landmark set; the fragment-alias and `<base>` preconditions).
- Verify assistive-technology behavior manually.

## Verification

There is no automated browser suite. The `bun:test` units cover pure logic with synthetic inputs; scrolling, navigation, focus, and assistive behavior are verified manually. No bundle-size figures appear in this README until a measurement path exists.

Run this checklist in current Chrome, Firefox, and Safari, in viewport and element-scroller modes. A completed pass records its results here:

1. `currentId` starts `null`; the first crossing notifies; scrolling up past headings re-selects the last crossed.
2. The activation line lands where expected for offsets `0`, a fixed-header-style offset, and an offset larger than the viewport height (the current target can sit below the fold — intended).
3. Bottom exception: a short final section becomes current at the bottom; a short page with no overflow reports `null` throughout.
4. Element scroller: its scroll drives tracking; document scrolling under it does not; `scrollElement={null}` deactivates; unmounting and reattaching through callback-ref state resumes correctly.
5. Targets inside an overflow panel in viewport mode are tracked; native anchor navigation to them scrolls inner and outer ancestors per browser rules.
6. Late-mounted and replaced same-ID targets become current at the next event; `refresh()` picks up image and font reflow while stationary.
7. Missing target: the anchor renders and navigates natively; the tracker skips it; no crash.
8. `targetIds` replaced: a removed current target reports `null` immediately; the new current appears at the next scroll or `refresh()`.
9. Links: `href` and `aria-current` are correct; a modified click opens a new tab; middle click behaves; back and forward accumulate entries and restore per browser rules; a direct load with `#fragment` lands correctly with consumer `scroll-padding`.
10. Keyboard: tab order follows the links; Enter navigates; after native navigation, the next tab stop continues near the destination.
11. Hydration: server HTML and first client render match; StrictMode double-invoke causes no extra notifications beyond the documented re-emission.
12. `discoverHeadings` ignores the scope element itself, excludes `aria-hidden`/`hidden` title content and script/style, trims whitespace, throws on missing or duplicate IDs and empty titles, and includes CSS-hidden headings.
13. `buildOutline` nests per the grouping rule, including skipped levels, a deep first heading, and a later shallower heading; `children` is always an array; the input is not mutated.
14. Composition: `render` on every part swaps elements while state props and refs reach the DOM node; the `className`/`style` state functions receive the documented state.
15. An empty collection renders an empty landmark with `currentId = null`; consumer empty-state styling applies.
16. RTL article text: tracking and navigation behave identically (vertical geometry is unaffected).

## Playground

`playground/vite-app` is a small Vite app with four worked use cases of the parts. The dev server runs from the repository root:

```bash
bun install
bun run playground:dev
```

| Variant | Demonstrates | Checklist rows above |
| :--- | :--- | :--- |
| Document scroll | the `useTocOutline` snapshot into the `headings` lane, document-viewport tracking, and `scroll-margin-top` coordination with the sticky header | 1, 2, 9, 12 |
| Embedded scroll area | static `headings` data tracked in an element scrollport wired through callback-ref state | 4, 13 |
| Custom render + events | `onCurrentChange`, `activationOffset` from a range input, a `TocLink` `render` prop, and `actionsRef` `refresh()` after a banner toggle | 2, 6, 14 |
| Dynamic targets | manual discovery into the `headings` lane after add and remove commits (the content mutates), and `display: none` targets that discovery still finds | 7, 8, 15 |

Vite dev is a manual-verification venue for the checklist above: each variant exercises its listed rows in the shipped modes. The playground imports [src/table-of-contents.tsx](./src/table-of-contents.tsx) directly, and the library itself is not rebuilt for the playground; `vite build` compiles the same source the unit tests run against.

## Also exported

The module exports the four parts, the two outline utilities (`discoverHeadings`, `buildOutline`), and the consumer hook `useTocOutline` (see Outline utilities). It also exports pure helpers (`isValidTargetId`, `parseTargetCollection`, `isValidActivationOffset`, `parseTrackingSource`, `selectCurrentTargetId`, `cleanHeadingTitle`) solely for the unit tests in [test/table-of-contents.test.tsx](./test/table-of-contents.test.tsx); they are not part of the public contract — build on the parts, the utilities, and the hook.

## Contributing

Open to pull requests & suggestions.

## License

Licensed under the MIT License - see the [LICENSE file](LICENSE) for details.
