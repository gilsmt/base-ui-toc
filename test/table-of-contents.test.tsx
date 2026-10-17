import * as React from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildOutline,
  cleanHeadingTitle,
  isValidActivationOffset,
  isValidTargetId,
  parseTargetCollection,
  parseTrackingSource,
  selectCurrentTargetId,
  useTocOutline,
  type TocGeometrySample,
  type TocTargetGeometry,
  type Heading,
  type HeadingGroup,
  type TocGroupProps,
  type TocLinkProps,
  TocItem,
  TocLink,
  TocGroup,
  TocList,
  TocRoot,
} from "../src/table-of-contents";

describe("isValidTargetId", () => {
  test("accepts plain, unicode, and surrogate-pair IDs", () => {
    expect(isValidTargetId("intro")).toBe(true);
    expect(isValidTargetId("Id-1")).toBe(true);
    expect(isValidTargetId("café")).toBe(true);
    // "😀" is a single surrogate pair (U+1F600).
    expect(isValidTargetId("\uD83D\uDE00")).toBe(true);
    expect(isValidTargetId("a😀b")).toBe(true);
  });

  test("rejects the empty string", () => {
    expect(isValidTargetId("")).toBe(false);
  });

  test("rejects every ASCII whitespace character (U+0009–U+000D, U+0020)", () => {
    expect(isValidTargetId("\u0009tab")).toBe(false);
    expect(isValidTargetId("new\u000Aline")).toBe(false);
    expect(isValidTargetId("vert\u000Btab")).toBe(false);
    expect(isValidTargetId("form\u000Cfeed")).toBe(false);
    expect(isValidTargetId("return\u000D")).toBe(false);
    expect(isValidTargetId("sp ace")).toBe(false);
    expect(isValidTargetId(" lead")).toBe(false);
    expect(isValidTargetId("lead ")).toBe(false);
  });

  test("accepts non-ASCII whitespace (raw value; the component never trims)", () => {
    expect(isValidTargetId("\u00A0nbsp")).toBe(true);
  });

  test("rejects unpaired surrogates in every position", () => {
    expect(isValidTargetId("\uD800")).toBe(false);
    expect(isValidTargetId("\uDC00")).toBe(false);
    expect(isValidTargetId("x\uD800")).toBe(false);
    expect(isValidTargetId("\uD800x")).toBe(false);
    expect(isValidTargetId("\uDC00x\uDC00")).toBe(false);
    // High surrogate followed by another high surrogate leaves both unpaired.
    expect(isValidTargetId("\uD800\uD800")).toBe(false);
    // Valid pair plus a trailing low surrogate: only the trailer is unpaired.
    expect(isValidTargetId("\uD800\uDC00\uDC00")).toBe(false);
  });

  test("treats non-string values as invalid (runtime boundary)", () => {
    expect(isValidTargetId(undefined)).toBe(false);
    expect(isValidTargetId(null)).toBe(false);
    expect(isValidTargetId(5)).toBe(false);
    expect(isValidTargetId(["a"])).toBe(false);
  });
});

describe("parseTargetCollection", () => {
  const parse = (targetIds: readonly unknown[]) => () => parseTargetCollection(targetIds);

  test("passes a valid unique collection, including the empty collection", () => {
    expect(parse([])).not.toThrow();
    expect(parse(["intro", "faq"])).not.toThrow();
    expect(parse(["café", "😀", "Ид"])).not.toThrow();
  });

  test("throws on a duplicate entry", () => {
    expect(parse(["intro", "faq", "intro"])).toThrow();
    expect(parse(["intro", "intro"])).toThrow();
  });

  test("throws on an invalid entry (invalid ID or non-string)", () => {
    expect(parse(["intro", "sp ace"])).toThrow();
    expect(parse(["intro", ""])).toThrow();
    expect(parse(["intro", 5])).toThrow();
  });
});

describe("isValidActivationOffset", () => {
  test("accepts zero, non-negative finite numbers", () => {
    expect(isValidActivationOffset(0)).toBe(true);
    expect(isValidActivationOffset(0.5)).toBe(true);
    expect(isValidActivationOffset(1e6)).toBe(true);
  });

  test("rejects negative, non-finite, and non-number values", () => {
    expect(isValidActivationOffset(-1)).toBe(false);
    expect(isValidActivationOffset(-0.0001)).toBe(false);
    expect(isValidActivationOffset(Infinity)).toBe(false);
    expect(isValidActivationOffset(-Infinity)).toBe(false);
    expect(isValidActivationOffset(Number.NaN)).toBe(false);
    expect(isValidActivationOffset(undefined)).toBe(false);
    expect(isValidActivationOffset("10")).toBe(false);
    expect(isValidActivationOffset(null)).toBe(false);
  });
});

const geometry = (id: string, headroomPx: number | null): TocTargetGeometry => ({ id, headroomPx });

const sample = (
  targets: readonly TocTargetGeometry[],
  activationOffsetPx: number,
  hasSurfaceBottomReached = false,
): TocGeometrySample => ({ targets, activationOffsetPx, hasSurfaceBottomReached });

describe("selectCurrentTargetId", () => {
  test("selects the last crossed target in configured order", () => {
    expect(selectCurrentTargetId(sample([geometry("a", 120), geometry("b", 80), geometry("c", 30)], 50))).toBe("c");
  });

  test("reports null before the first crossing", () => {
    expect(selectCurrentTargetId(sample([geometry("a", 100), geometry("b", 80)], 20))).toBe(null);
    expect(selectCurrentTargetId(sample([], 0))).toBe(null);
  });

  test("treats a headroom equal to the offset as crossed; equal tops pick the later entry", () => {
    expect(selectCurrentTargetId(sample([geometry("a", 0)], 0))).toBe("a");
    expect(selectCurrentTargetId(sample([geometry("a", 10), geometry("b", 10)], 10))).toBe("b");
  });

  test("follows configured order on non-monotone geometry", () => {
    expect(selectCurrentTargetId(sample([geometry("a", 10), geometry("b", 200), geometry("c", 20), geometry("d", 5)], 10))).toBe("d");
    expect(selectCurrentTargetId(sample([geometry("a", 10), geometry("b", 5), geometry("c", 200)], 20))).toBe("b");
  });

  test("skips unavailable targets for both crossing and the bottom exception", () => {
    // The absent target crosses nothing and cannot be the "last available" one.
    expect(selectCurrentTargetId(sample([geometry("b", null), geometry("c", 200)], 20, false))).toBe(null);
    expect(selectCurrentTargetId(sample([geometry("b", null), geometry("c", 200)], 20, true))).toBe("c");
    // With a crossing present, the crossing wins regardless of the bottom.
    expect(selectCurrentTargetId(sample([geometry("a", 10), geometry("b", null), geometry("c", 200)], 20, true))).toBe("a");
  });

  test("applies the bottom exception only when no target crossed and the bottom is reached", () => {
    expect(selectCurrentTargetId(sample([geometry("a", 100), geometry("b", 80)], 20, true))).toBe("b");
    expect(selectCurrentTargetId(sample([geometry("a", 100), geometry("b", 80)], 20, false))).toBe(null);
    // A crossing wins over the bottom exception.
    expect(selectCurrentTargetId(sample([geometry("a", 10), geometry("b", 80)], 20, true))).toBe("a");
  });

  test("reports null when the bottom is reached but no target is available", () => {
    expect(selectCurrentTargetId(sample([geometry("a", null), geometry("b", null)], 0, true))).toBe(null);
  });

  test("selects a target whose headroom is at/below a large offset, and reports null otherwise", () => {
    expect(selectCurrentTargetId(sample([geometry("a", 100)], 500))).toBe("a");
    expect(selectCurrentTargetId(sample([geometry("a", 100)], 50))).toBe(null);
  });
});

describe("cleanHeadingTitle", () => {
  test("trims outer whitespace", () => {
    expect(cleanHeadingTitle(" Intro ")).toBe("Intro");
    expect(cleanHeadingTitle("Intro")).toBe("Intro");
  });

  test("collapses internal whitespace runs to single spaces", () => {
    expect(cleanHeadingTitle("Multiple   spaces here")).toBe("Multiple spaces here");
    expect(cleanHeadingTitle("Tabs\tand\tNewlines\nmix")).toBe("Tabs and Newlines mix");
    expect(cleanHeadingTitle("\t Lines\r\njoined \r here \u00A0")).toBe("Lines joined here");
  });

  test("keeps a single interior space intact", () => {
    expect(cleanHeadingTitle("Getting started")).toBe("Getting started");
  });

  test("rejects a title that is empty after cleaning", () => {
    expect(() => cleanHeadingTitle("")).toThrow();
    expect(() => cleanHeadingTitle("   ")).toThrow();
    expect(() => cleanHeadingTitle("\t\n")).toThrow();
  });
});

const heading = (id: string, level: Heading["level"], title: string): Heading => ({ id, level, title });

describe("buildOutline", () => {
  test("grouping: nests deeper entries under the nearest preceding shallower entry", () => {
    const outline = buildOutline([
      heading("intro", 2, "Intro"),
      heading("setup", 3, "Setup"),
      heading("config", 3, "Config"),
    ]);

    expect(outline).toEqual([
      { ...heading("intro", 2, "Intro"), children: [
        { ...heading("setup", 3, "Setup"), children: [] },
        { ...heading("config", 3, "Config"), children: [] },
      ] },
    ]);
  });

  test("grouping: groups equal-level entries as siblings under the same parent", () => {
    const outline = buildOutline([
      heading("root", 1, "Root"),
      heading("part-a", 2, "A"),
      heading("part-b", 2, "B"),
      heading("detail", 3, "Detail under B"),
    ]);

    expect(outline).toEqual([
      { ...heading("root", 1, "Root"), children: [
        { ...heading("part-a", 2, "A"), children: [] },
        { ...heading("part-b", 2, "B"), children: [{ ...heading("detail", 3, "Detail under B"), children: [] }] },
      ] },
    ]);
  });

  test("grouping: nests across skipped levels without synthetic nodes", () => {
    const outline = buildOutline([
      heading("h2", 2, "Two"),
      heading("h4", 4, "Four"),
    ]);

    expect(outline).toEqual([
      { ...heading("h2", 2, "Two"), children: [{ ...heading("h4", 4, "Four"), children: [] }] },
    ]);
  });

  test("grouping: roots a deep first heading as a top-level group", () => {
    const outline = buildOutline([
      heading("deep", 4, "Deep"),
      heading("shallow", 2, "Shallow"),
    ]);

    expect(outline).toEqual([
      { ...heading("deep", 4, "Deep"), children: [] },
      { ...heading("shallow", 2, "Shallow"), children: [] },
    ]);
  });

  test("grouping: starts a new top-level group for a later shallower heading and never re-parents", () => {
    const outline = buildOutline([
      heading("a2", 2, "A"),
      heading("b3", 3, "B"),
      heading("c3", 3, "C"),
      heading("d2", 2, "D"),
      heading("e4", 4, "E"),
    ]);

    expect(outline).toEqual([
      { ...heading("a2", 2, "A"), children: [
        { ...heading("b3", 3, "B"), children: [] },
        { ...heading("c3", 3, "C"), children: [] },
      ] },
      { ...heading("d2", 2, "D"), children: [{ ...heading("e4", 4, "E"), children: [] }] },
    ]);
  });

  test("output: always gives every node a children array", () => {
    const outline = buildOutline([
      heading("x", 2, "X"),
      heading("y", 6, "Y"),
      heading("z", 2, "Z"),
    ]);

    const walk = (groups: readonly { children?: unknown }[]) => {
      for (const group of groups) {
        expect(Array.isArray(group.children)).toBe(true);
        if (Array.isArray(group.children)) walk(group.children);
      }
    };
    walk(outline);
  });

  test("purity: returns an empty array for empty input and does not mutate the input", () => {
    const input: Heading[] = [];
    expect(buildOutline(input)).toEqual([]);

    const input2 = [heading("one", 2, "One"), heading("two", 3, "Two")] as Heading[];
    const snapshot = JSON.stringify(input2);
    buildOutline(input2);
    expect(JSON.stringify(input2)).toBe(snapshot);
  });

  test("purity: returns fresh output objects that do not alias the input", () => {
    const input: readonly Heading[] = [heading("one", 2, "One")];
    const [firstGroup] = buildOutline(input);
    expect(firstGroup).not.toBe(input[0]);
    expect(firstGroup?.children).toEqual([]);
  });

  test("throws on an invalid ID, an empty-after-clean title, or a bad level", () => {
    expect(() => buildOutline([heading("sp ace", 2, "Ok")])).toThrow();
    expect(() => buildOutline([heading("ok", 2, "   ")])).toThrow();
    // A JS caller can supply junk inside typed fields; the input boundary rejects it.
    expect(() => buildOutline([{ ...heading("ok", 2, "Ok"), level: 0 } as unknown as Heading])).toThrow();
    expect(() => buildOutline([{ ...heading("ok", 2, "Ok"), level: 7 } as unknown as Heading])).toThrow();
    expect(() => buildOutline([{ ...heading("ok", 2, "Ok"), level: 2.5 } as unknown as Heading])).toThrow();
  });

  test("throws on a duplicate ID across the input", () => {
    expect(() => buildOutline([heading("dup", 2, "Dup"), heading("dup", 3, "Dup again")])).toThrow();
  });

  test("throws on non-heading junk supplied by a JS caller", () => {
    expect(() => buildOutline([5] as unknown as readonly Heading[])).toThrow();
    expect(() => buildOutline([{ ...heading("a", 2, "A"), level: "2" }] as unknown as readonly Heading[])).toThrow();
  });
});

describe("parseTrackingSource", () => {
  const parse = (props: {
    targetIds?: readonly string[] | undefined;
    headings?: readonly Heading[] | undefined;
  }) => () => parseTrackingSource(props);

  test("throws when both lanes are provided", () => {
    expect(parse({ targetIds: ["intro"], headings: [heading("intro", 2, "Intro")] })).toThrow();
  });

  test("throws when neither lane is provided", () => {
    expect(parse({})).toThrow();
    expect(parse({ targetIds: undefined, headings: undefined })).toThrow();
  });

  test("parses the targetIds lane and adds no outline", () => {
    const source = parseTrackingSource({ targetIds: ["intro", "faq"], headings: undefined });

    expect(source).toEqual({ lane: "targetIds", targetIds: ["intro", "faq"] });
    expect("outline" in source).toBe(false);
  });

  test("the targetIds lane keeps the collection boundary errors", () => {
    expect(parse({ targetIds: ["sp ace"] })).toThrow();
    expect(parse({ targetIds: ["intro", "intro"] })).toThrow();
  });

  test("derives the headings lane from built outline entries", () => {
    const entries = [heading("intro", 2, "Intro"), heading("setup", 3, "Setup")];
    const source = parseTrackingSource({ targetIds: undefined, headings: entries });

    expect(source).toEqual({
      lane: "headings",
      targetIds: ["intro", "setup"],
      outline: [
        { ...heading("intro", 2, "Intro"), children: [{ ...heading("setup", 3, "Setup"), children: [] }] },
      ],
    });
  });

  test("an empty headings list is a valid lane with an empty outline", () => {
    expect(parseTrackingSource({ targetIds: undefined, headings: [] })).toEqual({
      lane: "headings",
      targetIds: [],
      outline: [],
    });
  });

  test("the headings lane validates through buildOutline only", () => {
    // Invalid entry shapes and duplicates surface from the outline boundary.
    expect(parse({ headings: [heading("sp ace", 2, "Ok")] })).toThrow();
    expect(parse({ headings: [heading("dup", 2, "Dup"), heading("dup", 3, "Dup again")] })).toThrow();
    expect(parse({ headings: [{ ...heading("ok", 2, "Ok"), level: 0 } as unknown as Heading] })).toThrow();
  });

  test("the derived collection and outline are fresh, not aliases of the input", () => {
    const entries = [heading("one", 2, "One")] as readonly Heading[];
    const source = parseTrackingSource({ headings: entries });

    if (source.lane !== "headings") throw new Error("unreachable: one lane was provided");
    expect(source.targetIds).not.toBe(entries);
    expect(source.outline[0]).not.toBe(entries[0]);
  });
});

describe("SSR smoke", () => {
  test("renders links with derived hrefs and no current marking on the server", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        TocRoot,
        { targetIds: ["intro", "deep-id", "café"] },
        React.createElement(
          TocList,
          null,
          React.createElement(
            TocItem,
            null,
            React.createElement(TocLink, { targetId: "intro" }, "Intro"),
            React.createElement(
              TocList,
              null,
              React.createElement(TocItem, null, React.createElement(TocLink, { targetId: "deep-id" }, "Deep")),
            ),
          ),
          React.createElement(TocItem, null, React.createElement(TocLink, { targetId: "café" }, "Café")),
        ),
      ),
    );

    // Slot attributes and the default landmark label.
    expect(markup).toContain(`data-slot="toc-root"`);
    expect(markup).toContain(`data-slot="toc-list"`);
    expect(markup).toContain(`data-slot="toc-item"`);
    expect(markup).toContain(`data-slot="toc-link"`);
    expect(markup).toContain(`aria-label="Table of contents"`);
    // Derived hrefs are pure functions of the target ID.
    expect(markup).toContain(`href="#intro"`);
    expect(markup).toContain(`href="#deep-id"`);
    expect(markup).toContain('href="#caf%C3%A9"');
    // No current marking before any measurement: server and first client render match.
    expect(markup).not.toContain(`aria-current`);
    expect(markup).not.toContain("data-current");
    // No suppressable state-derived attribute.
    expect(markup).not.toContain("data-current-id");
    // The nav renders an ordered list structure.
    expect(markup.startsWith("<nav")).toBe(true);
    expect(markup).toContain("<ol");
    expect(markup).toContain("<li");
  });

  test("renders the empty collection as an empty landmark", () => {
    const markup = renderToStaticMarkup(React.createElement(TocRoot, { targetIds: [] }));

    expect(markup).toContain(`data-slot="toc-root"`);
    expect(markup).toContain(`aria-label="Table of contents"`);
  });
});

describe("SSR render boundaries", () => {
  test("throws at the Root for an invalid targetIds entry", () => {
    expect(() => renderToStaticMarkup(React.createElement(TocRoot, { targetIds: ["sp ace"] }))).toThrow();
  });

  test("throws at the Root for a duplicate targetIds entry", () => {
    expect(() => renderToStaticMarkup(React.createElement(TocRoot, { targetIds: ["intro", "intro"] }))).toThrow();
  });

  test("throws at the Root when both tracking lanes are provided", () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(TocRoot, { targetIds: ["intro"], headings: [heading("intro", 2, "Intro")] }),
      ),
    ).toThrow();
  });

  test("throws at the Root when no tracking lane is provided", () => {
    expect(() => renderToStaticMarkup(React.createElement(TocRoot, {}))).toThrow();
  });

  test("throws at the Root for a non-finite or negative activationOffset", () => {
    expect(() =>
      renderToStaticMarkup(React.createElement(TocRoot, { targetIds: ["intro"], activationOffset: Number.NaN })),
    ).toThrow();
    expect(() =>
      renderToStaticMarkup(React.createElement(TocRoot, { targetIds: ["intro"], activationOffset: Infinity })),
    ).toThrow();
    expect(() =>
      renderToStaticMarkup(React.createElement(TocRoot, { targetIds: ["intro"], activationOffset: -1 })),
    ).toThrow();
  });

  test("throws at the Link render for an invalid targetId", () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(
          TocRoot,
          { targetIds: ["intro"] },
          React.createElement(TocLink, { targetId: "sp ace" }, "Intro"),
        ),
      ),
    ).toThrow();
  });

  test("throws at the Link render for a targetId outside the root collection", () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(
          TocRoot,
          { targetIds: ["intro"] },
          React.createElement(TocLink, { targetId: "other" }, "Other"),
        ),
      ),
    ).toThrow();
  });

  test("throws for a TocLink outside any TocRoot", () => {
    expect(() => renderToStaticMarkup(React.createElement(TocLink, { targetId: "intro" }, "Intro"))).toThrow();
  });

  test("component-owned href and aria-current beat conflicting consumer values", () => {
    // A JS caller can pass the component-owned props that TS consumers
    // cannot set; the component-owned values must win at runtime (§4.4).
    const conflictingProps = { targetId: "intro", href: "#conflict", "aria-current": "page" } as unknown as TocLinkProps;
    const markup = renderToStaticMarkup(
      React.createElement(
        TocRoot,
        { targetIds: ["intro"] },
        React.createElement(TocLink, conflictingProps, "Intro"),
      ),
    );
    // The derived fragment encoding wins, and the consumer values vanish.
    expect(markup).toContain(`href="#intro"`);
    expect(markup).not.toContain(`href="#conflict"`);
    expect(markup).not.toContain(`aria-current="page"`);
  });

  test("a consumer aria-label overrides the default landmark label", () => {
    const markup = renderToStaticMarkup(
      React.createElement(TocRoot, { targetIds: ["intro"], "aria-label": "Consumer label" }),
    );
    expect(markup).toContain(`aria-label="Consumer label"`);
    expect(markup).not.toContain(`aria-label="Table of contents"`);
  });
});

const LANE_HEADINGS: readonly Heading[] = [
  heading("intro", 2, "Intro"),
  heading("cookbook", 3, "Cookbook"),
];

const laneEntries = () =>
  // Flat presentation entries: one keyed item per heading, as consumers map.
  LANE_HEADINGS.map((entry) =>
    React.createElement(
      TocItem,
      { key: entry.id },
      React.createElement(TocLink, { targetId: entry.id }, entry.title),
    ),
  );

describe("SSR headings lane", () => {
  test("renders the same hrefs as the derived targetIds lane", () => {
    const headingsMarkup = renderToStaticMarkup(
      React.createElement(TocRoot, { headings: LANE_HEADINGS }, laneEntries()),
    );
    const targetIdsMarkup = renderToStaticMarkup(
      React.createElement(
        TocRoot,
        { targetIds: LANE_HEADINGS.map((entry) => entry.id) },
        laneEntries(),
      ),
    );

    // The lane is invisible in markup: identical hrefs, slots, and label.
    expect(headingsMarkup).toBe(targetIdsMarkup);
    expect(headingsMarkup).toContain(`href="#intro"`);
    expect(headingsMarkup).toContain('href="#cookbook"');
  });

  test("renders an empty headings list as an empty landmark", () => {
    const markup = renderToStaticMarkup(React.createElement(TocRoot, { headings: [] }));

    expect(markup).toContain(`data-slot="toc-root"`);
    expect(markup).toContain(`aria-label="Table of contents"`);
    expect(markup).not.toContain("href=");
  });
});

describe("SSR TocList function children", () => {
  test("maps the Root-owned outline onto the list items", () => {
    const itemForGroup = (group: HeadingGroup): React.ReactElement =>
      React.createElement(
        TocItem,
        null,
        React.createElement(TocLink, { targetId: group.id }, group.title),
        React.createElement(TocGroup, { group, children: itemForGroup }),
      );

    const markup = renderToStaticMarkup(
      React.createElement(
        TocRoot,
        { headings: LANE_HEADINGS },
        React.createElement(TocList, { children: itemForGroup }),
      ),
    );

    // The function child runs once per top-level group; the part keys each
    // mapped child from the group id, so the callback output carries no keys.
    expect(markup).toContain('href="#intro"');
    expect(markup).toContain("Intro");
    expect(markup).toContain('href="#cookbook"');
    expect(markup).toContain("Cookbook");
    expect(markup).toContain(`data-slot="toc-list"`);
    expect(markup).toContain(`data-slot="toc-item"`);
  });

  test("throw in the targetIds lane, which owns no outline", () => {
    expect(() =>
      renderToStaticMarkup(
        React.createElement(
          TocRoot,
          { targetIds: ["intro"] },
          React.createElement(TocList, { children: (group: HeadingGroup) => group.id }),
        ),
      ),
    ).toThrow();
  });
});

// Mixed-level outline (§9.2): a skipped level nests the h5 directly under
// the h3 above it, and a later shallower heading starts a second top group.
const GROUP_HEADINGS: readonly Heading[] = [
  heading("intro", 2, "Intro"),
  heading("setup", 3, "Setup"),
  heading("setup-keys", 5, "Keys"),
  heading("faq", 2, "FAQ"),
  heading("faq-links", 3, "Links"),
];

// The canonical fast lane (§8.5): one named callback reused at every depth.
// The callback output carries no keys: TocList and TocGroup author each key
// from the group id.
const outlineItem = (group: HeadingGroup): React.ReactElement =>
  React.createElement(
    TocItem,
    null,
    React.createElement(TocLink, { targetId: group.id }, group.title),
    React.createElement(TocGroup, { group, children: outlineItem }),
  );

const renderWithTocGroup = (): string =>
  renderToStaticMarkup(
    React.createElement(
      TocRoot,
      { headings: GROUP_HEADINGS },
      React.createElement(TocList, { children: outlineItem }),
    ),
  );

// The manual mirror of the part: the guarded nesting a consumer authors
// without TocGroup, keyed as the consumer's own arrays require.
const manualOutlineItem = (group: HeadingGroup): React.ReactElement =>
  React.createElement(
    TocItem,
    { key: group.id },
    React.createElement(TocLink, { targetId: group.id }, group.title),
    group.children.length > 0
      ? React.createElement(TocList, null, group.children.map((child) => manualOutlineItem(child)))
      : null,
  );

describe("TocGroup", () => {
  test("maps child groups through one callback: items, links, and nested lists at every depth", () => {
    const markup = renderWithTocGroup();

    expect(markup.startsWith("<nav")).toBe(true);
    expect(markup).toContain(`aria-label="Table of contents"`);
    // One item and one link per heading.
    expect((markup.match(/data-slot="toc-item"/g) ?? []).length).toBe(5);
    expect((markup.match(/data-slot="toc-link"/g) ?? []).length).toBe(5);
    // One nested list per group with children (intro, setup, faq) plus the top list.
    expect((markup.match(/data-slot="toc-list"/g) ?? []).length).toBe(4);
    // Hrefs appear in outline order: intro > setup > setup-keys, then faq > faq-links.
    const fragmentPositions = ["#intro", "#setup", "#setup-keys", "#faq", "#faq-links"].map((fragment) =>
      markup.indexOf(`href="${fragment}"`),
    );
    expect(fragmentPositions.every((position) => position >= 0)).toBe(true);
    expect(fragmentPositions).toEqual([...fragmentPositions].sort((a, b) => a - b));
    // A leaf group renders no nested list: the part owns the empty-`<ol>` guard.
    expect(markup).toContain(`<li data-slot="toc-item"><a data-slot="toc-link" href="#setup-keys">Keys</a></li>`);
    // The callback output carries no keys, yet the tree equals the keyed
    // manual mirror: the library authors every key from the group ids.
    const keyedViaFunctionChildren = renderToStaticMarkup(
      React.createElement(
        TocRoot,
        { headings: GROUP_HEADINGS },
        React.createElement(TocList, { children: manualOutlineItem }),
      ),
    );
    expect(markup).toBe(keyedViaFunctionChildren);
  });

  test("renders nothing for a childless group, and the child callback never runs", () => {
    let childCalls = 0;
    const markup = renderToStaticMarkup(
      React.createElement(
        TocRoot,
        { targetIds: ["leaf"] },
        React.createElement(
          TocList,
          null,
          React.createElement(TocGroup, {
            group: { id: "leaf", title: "Leaf", level: 2, children: [] },
            children: (child: HeadingGroup) => {
              childCalls += 1;
              return React.createElement(TocItem, null, React.createElement(TocLink, { targetId: child.id }, child.title));
            },
          }),
        ),
      ),
    );

    // Only the consumer's top-level list exists: the childless group adds no
    // `<ol>`, which also holds in the targetIds lane because the part reads
    // no context.
    expect((markup.match(/data-slot="toc-list"/g) ?? []).length).toBe(1);
    expect(childCalls).toBe(0);
  });

  test("equals the manual nested TocList/TocItem/TocLink rendering of the same outline", () => {
    const withTocGroup = renderWithTocGroup();
    // The manual mirror maps the outline with plain children, the way a
    // consumer authors the nesting without TocGroup or function children.
    const manual = renderToStaticMarkup(
      React.createElement(
        TocRoot,
        { headings: GROUP_HEADINGS },
        React.createElement(TocList, null, buildOutline(GROUP_HEADINGS).map((group) => manualOutlineItem(group))),
      ),
    );

    // The part is exactly the guarded manual composition, so the markup
    // matches attribute for attribute.
    expect(manual.length).toBeGreaterThan(0);
    expect(withTocGroup).toBe(manual);
  });

  test("throws on non-function children, before the empty guard", () => {
    // A JS caller can set `children` that TS consumers cannot type: the
    // function-children boundary rejects it at render, before the empty
    // guard can return null (§10).
    const nonFunctionChildrenProps = (group: HeadingGroup) =>
      ({
        group,
        children: React.createElement(TocItem, null, "Not a mapping function"),
      }) as unknown as TocGroupProps;

    const childfulGroup: HeadingGroup = {
      id: "intro",
      title: "Intro",
      level: 2,
      children: [{ id: "setup", title: "Setup", level: 3, children: [] }],
    };
    const childlessGroup: HeadingGroup = { id: "leaf", title: "Leaf", level: 2, children: [] };

    expect(() =>
      renderToStaticMarkup(
        React.createElement(
          TocRoot,
          { targetIds: ["intro", "setup"] },
          React.createElement(
            TocList,
            null,
            React.createElement(TocGroup, nonFunctionChildrenProps(childfulGroup)),
          ),
        ),
      ),
    ).toThrow("TocGroup receives function children mapping each child group.");

    expect(() =>
      renderToStaticMarkup(
        React.createElement(
          TocRoot,
          { targetIds: ["leaf"] },
          React.createElement(
            TocList,
            null,
            React.createElement(TocGroup, nonFunctionChildrenProps(childlessGroup)),
          ),
        ),
      ),
    ).toThrow("TocGroup receives function children mapping each child group.");
  });
});

describe("useTocOutline SSR", () => {
  test("returns the empty headings/outline pair on a null scope", () => {
    const probe = () => {
      const { headings, outline } = useTocOutline(null);
      return React.createElement("span", null, `${headings.length}:${outline.length}`);
    };

    expect(renderToStaticMarkup(React.createElement(probe))).toContain(">0:0<");
  });
});
