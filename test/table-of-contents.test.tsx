import * as React from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildOutline,
  cleanHeadingTitle,
  isValidActivationOffset,
  isValidTargetId,
  selectCurrentTargetId,
  validateTargetCollection,
  type TocGeometrySample,
  type TocTargetGeometry,
  type Heading,
  type TocLinkProps,
  TocItem,
  TocLink,
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

describe("validateTargetCollection", () => {
  const collect = (targetIds: readonly unknown[]) => () => validateTargetCollection(targetIds);

  test("passes a valid unique collection, including the empty collection", () => {
    expect(collect([])).not.toThrow();
    expect(collect(["intro", "faq"])).not.toThrow();
    expect(collect(["café", "😀", "Ид"])).not.toThrow();
  });

  test("throws on a duplicate entry", () => {
    expect(collect(["intro", "faq", "intro"])).toThrow();
    expect(collect(["intro", "intro"])).toThrow();
  });

  test("throws on an invalid entry (invalid ID or non-string)", () => {
    expect(collect(["intro", "sp ace"])).toThrow();
    expect(collect(["intro", ""])).toThrow();
    expect(collect(["intro", 5])).toThrow();
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
