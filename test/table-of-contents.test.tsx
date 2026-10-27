import * as React from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
    groupHeadings,
    parseTargetCollection,
    useTocHeadings,
    type Heading,
    type TocLinkProps,
    TocItem,
    TocLink,
    TocList,
    TocRoot,
    TocValue,
} from "../src/table-of-contents";

describe("parseTargetCollection", () => {
    const parse = (targetIds: readonly unknown[]) => () =>
        parseTargetCollection(targetIds);

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

const heading = (
    id: string,
    level: Heading["level"],
    title: string,
): Heading => ({ id, level, title });

describe("groupHeadings", () => {
    test("grouping: nests deeper entries under the nearest preceding shallower entry", () => {
        const tree = groupHeadings([
            heading("intro", 2, "Intro"),
            heading("setup", 3, "Setup"),
            heading("config", 3, "Config"),
        ]);

        expect(tree).toEqual([
            {
                ...heading("intro", 2, "Intro"),
                children: [
                    { ...heading("setup", 3, "Setup"), children: [] },
                    { ...heading("config", 3, "Config"), children: [] },
                ],
            },
        ]);
    });

    test("grouping: groups equal-level entries as siblings under the same parent", () => {
        const tree = groupHeadings([
            heading("root", 1, "Root"),
            heading("part-a", 2, "A"),
            heading("part-b", 2, "B"),
            heading("detail", 3, "Detail under B"),
        ]);

        expect(tree).toEqual([
            {
                ...heading("root", 1, "Root"),
                children: [
                    { ...heading("part-a", 2, "A"), children: [] },
                    {
                        ...heading("part-b", 2, "B"),
                        children: [
                            {
                                ...heading("detail", 3, "Detail under B"),
                                children: [],
                            },
                        ],
                    },
                ],
            },
        ]);
    });

    test("grouping: nests across skipped levels without synthetic nodes", () => {
        const tree = groupHeadings([
            heading("h2", 2, "Two"),
            heading("h4", 4, "Four"),
        ]);

        expect(tree).toEqual([
            {
                ...heading("h2", 2, "Two"),
                children: [{ ...heading("h4", 4, "Four"), children: [] }],
            },
        ]);
    });

    test("grouping: roots a deep first heading as a top-level group", () => {
        const tree = groupHeadings([
            heading("deep", 4, "Deep"),
            heading("shallow", 2, "Shallow"),
        ]);

        expect(tree).toEqual([
            { ...heading("deep", 4, "Deep"), children: [] },
            { ...heading("shallow", 2, "Shallow"), children: [] },
        ]);
    });

    test("grouping: starts a new top-level group for a later shallower heading and never re-parents", () => {
        const tree = groupHeadings([
            heading("a2", 2, "A"),
            heading("b3", 3, "B"),
            heading("c3", 3, "C"),
            heading("d2", 2, "D"),
            heading("e4", 4, "E"),
        ]);

        expect(tree).toEqual([
            {
                ...heading("a2", 2, "A"),
                children: [
                    { ...heading("b3", 3, "B"), children: [] },
                    { ...heading("c3", 3, "C"), children: [] },
                ],
            },
            {
                ...heading("d2", 2, "D"),
                children: [{ ...heading("e4", 4, "E"), children: [] }],
            },
        ]);
    });

    test("output: always gives every node a children array", () => {
        const tree = groupHeadings([
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
        walk(tree);
    });

    test("purity: returns an empty array for empty input and does not mutate the input", () => {
        const input: Heading[] = [];
        expect(groupHeadings(input)).toEqual([]);

        const input2 = [
            heading("one", 2, "One"),
            heading("two", 3, "Two"),
        ] as Heading[];
        const snapshot = JSON.stringify(input2);
        groupHeadings(input2);
        expect(JSON.stringify(input2)).toBe(snapshot);
    });

    test("purity: returns fresh output objects that do not alias the input", () => {
        const input: readonly Heading[] = [heading("one", 2, "One")];
        const [firstGroup] = groupHeadings(input);
        expect(firstGroup).not.toBe(input[0]);
        expect(firstGroup?.children).toEqual([]);
    });

    test("throws on an invalid ID, an empty-after-clean title, or a bad level", () => {
        expect(() => groupHeadings([heading("sp ace", 2, "Ok")])).toThrow();
        expect(() => groupHeadings([heading("ok", 2, "   ")])).toThrow();
        // A JS caller can supply junk inside typed fields; the input boundary rejects it.
        expect(() =>
            groupHeadings([
                { ...heading("ok", 2, "Ok"), level: 0 } as unknown as Heading,
            ]),
        ).toThrow();
        expect(() =>
            groupHeadings([
                { ...heading("ok", 2, "Ok"), level: 7 } as unknown as Heading,
            ]),
        ).toThrow();
        expect(() =>
            groupHeadings([
                { ...heading("ok", 2, "Ok"), level: 2.5 } as unknown as Heading,
            ]),
        ).toThrow();
    });

    test("throws on a duplicate ID across the input", () => {
        expect(() =>
            groupHeadings([
                heading("dup", 2, "Dup"),
                heading("dup", 3, "Dup again"),
            ]),
        ).toThrow();
    });

    test("throws on non-heading junk supplied by a JS caller", () => {
        expect(() =>
            groupHeadings([5] as unknown as readonly Heading[]),
        ).toThrow();
        expect(() =>
            groupHeadings([
                { ...heading("a", 2, "A"), level: "2" },
            ] as unknown as readonly Heading[]),
        ).toThrow();
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
                        React.createElement(
                            TocLink,
                            { targetId: "intro" },
                            "Intro",
                        ),
                        React.createElement(
                            TocList,
                            null,
                            React.createElement(
                                TocItem,
                                null,
                                React.createElement(
                                    TocLink,
                                    { targetId: "deep-id" },
                                    "Deep",
                                ),
                            ),
                        ),
                    ),
                    React.createElement(
                        TocItem,
                        null,
                        React.createElement(
                            TocLink,
                            { targetId: "café" },
                            "Café",
                        ),
                    ),
                ),
            ),
        );

        expect(markup).toContain(`aria-label="Table of contents"`);
        expect(markup).toContain(`href="#intro"`);
        expect(markup).toContain(`href="#deep-id"`);
        expect(markup).toContain('href="#caf%C3%A9"');
        expect(markup).not.toContain(`aria-current`);
        expect(markup).not.toContain("data-current");
        // No suppressable state-derived attribute.
        expect(markup).not.toContain("data-current-id");
        expect(markup.startsWith("<nav")).toBe(true);
        expect(markup).toContain("<ol");
        expect(markup).toContain("<li");
    });

    test("renders the empty collection as an empty landmark", () => {
        const markup = renderToStaticMarkup(
            React.createElement(TocRoot, { targetIds: [] }),
        );

        expect(markup.startsWith("<nav")).toBe(true);
        expect(markup).toContain(`aria-label="Table of contents"`);
    });
});

describe("SSR render boundaries", () => {
    test("throws at the Root for an invalid targetIds entry", () => {
        expect(() =>
            renderToStaticMarkup(
                React.createElement(TocRoot, { targetIds: ["sp ace"] }),
            ),
        ).toThrow();
    });

    test("throws at the Root for a duplicate targetIds entry", () => {
        expect(() =>
            renderToStaticMarkup(
                React.createElement(TocRoot, { targetIds: ["intro", "intro"] }),
            ),
        ).toThrow();
    });

    test("throws at the Root when both tracking lanes are provided", () => {
        expect(() =>
            renderToStaticMarkup(
                React.createElement(TocRoot, {
                    targetIds: ["intro"],
                    headings: [heading("intro", 2, "Intro")],
                }),
            ),
        ).toThrow();
    });

    test("throws at the Root when no tracking lane is provided", () => {
        expect(() =>
            renderToStaticMarkup(React.createElement(TocRoot, {})),
        ).toThrow();
    });

    test("throws at the Root for a non-finite or negative activationOffset", () => {
        expect(() =>
            renderToStaticMarkup(
                React.createElement(TocRoot, {
                    targetIds: ["intro"],
                    activationOffset: Number.NaN,
                }),
            ),
        ).toThrow();
        expect(() =>
            renderToStaticMarkup(
                React.createElement(TocRoot, {
                    targetIds: ["intro"],
                    activationOffset: Infinity,
                }),
            ),
        ).toThrow();
        expect(() =>
            renderToStaticMarkup(
                React.createElement(TocRoot, {
                    targetIds: ["intro"],
                    activationOffset: -1,
                }),
            ),
        ).toThrow();
    });

    test("throws at the Link render for an invalid targetId", () => {
        expect(() =>
            renderToStaticMarkup(
                React.createElement(
                    TocRoot,
                    { targetIds: ["intro"] },
                    React.createElement(
                        TocLink,
                        { targetId: "sp ace" },
                        "Intro",
                    ),
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
                    React.createElement(
                        TocLink,
                        { targetId: "other" },
                        "Other",
                    ),
                ),
            ),
        ).toThrow();
    });

    test("throws for a TocLink outside any TocRoot", () => {
        expect(() =>
            renderToStaticMarkup(
                React.createElement(TocLink, { targetId: "intro" }, "Intro"),
            ),
        ).toThrow();
    });

    test("component-owned href and aria-current beat conflicting consumer values", () => {
        // A JS caller can pass component-owned props; the component values must win at runtime.
        const conflictingProps = {
            targetId: "intro",
            href: "#conflict",
            "aria-current": "page",
        } as unknown as TocLinkProps;
        const markup = renderToStaticMarkup(
            React.createElement(
                TocRoot,
                { targetIds: ["intro"] },
                React.createElement(TocLink, conflictingProps, "Intro"),
            ),
        );
        expect(markup).toContain(`href="#intro"`);
        expect(markup).not.toContain(`href="#conflict"`);
        expect(markup).not.toContain(`aria-current="page"`);
    });

    test("a consumer aria-label overrides the default landmark label", () => {
        const markup = renderToStaticMarkup(
            React.createElement(TocRoot, {
                targetIds: ["intro"],
                "aria-label": "Consumer label",
            }),
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
            React.createElement(
                TocRoot,
                { headings: LANE_HEADINGS },
                laneEntries(),
            ),
        );
        const targetIdsMarkup = renderToStaticMarkup(
            React.createElement(
                TocRoot,
                { targetIds: LANE_HEADINGS.map((entry) => entry.id) },
                laneEntries(),
            ),
        );

        expect(headingsMarkup).toBe(targetIdsMarkup);
        expect(headingsMarkup).toContain(`href="#intro"`);
        expect(headingsMarkup).toContain('href="#cookbook"');
    });

    test("renders an empty headings list as an empty landmark", () => {
        const markup = renderToStaticMarkup(
            React.createElement(TocRoot, { headings: [] }),
        );

        expect(markup.startsWith("<nav")).toBe(true);
        expect(markup).toContain(`aria-label="Table of contents"`);
        expect(markup).not.toContain("href=");
    });
});

// Mixed levels: a skipped level nests the h5 under the h3 above it.
const GROUP_HEADINGS: readonly Heading[] = [
    heading("intro", 2, "Intro"),
    heading("setup", 3, "Setup"),
    heading("setup-keys", 5, "Keys"),
    heading("faq", 2, "FAQ"),
    heading("faq-links", 3, "Links"),
];

// The callback output carries no key: TocList authors it from the entry id.
const flatItemForEntry = (entry: Heading): React.ReactElement =>
    React.createElement(
        TocItem,
        null,
        React.createElement(TocLink, { targetId: entry.id }, entry.title),
    );

describe("SSR TocList function children", () => {
    test("maps the parsed entries into one flat list in document order", () => {
        const receivedIds: string[] = [];
        const markup = renderToStaticMarkup(
            React.createElement(
                TocRoot,
                { headings: GROUP_HEADINGS },
                <TocList>
                    {(entry: Heading) => {
                        receivedIds.push(entry.id);
                        return flatItemForEntry(entry);
                    }}
                </TocList>,
            ),
        );

        expect(receivedIds).toEqual([
            "intro",
            "setup",
            "setup-keys",
            "faq",
            "faq-links",
        ]);
        expect((markup.match(/<ol/g) ?? []).length).toBe(1);
        expect((markup.match(/<li/g) ?? []).length).toBe(5);
        expect((markup.match(/<a /g) ?? []).length).toBe(5);
        const fragmentPositions = [
            "#intro",
            "#setup",
            "#setup-keys",
            "#faq",
            "#faq-links",
        ].map((fragment) => markup.indexOf(`href="${fragment}"`));
        expect(fragmentPositions.every((position) => position >= 0)).toBe(true);
        expect(fragmentPositions).toEqual(
            [...fragmentPositions].sort((a, b) => a - b),
        );
    });

    test("authors keys for the mapped children", () => {
        const consoleErrorCalls: unknown[][] = [];
        const originalConsoleError = console.error;
        console.error = (...args: unknown[]) => {
            consoleErrorCalls.push(args);
        };
        try {
            // The part authors the keys, so no missing-key warning may reach console.error.
            renderToStaticMarkup(
                React.createElement(
                    TocRoot,
                    { headings: GROUP_HEADINGS },
                    <TocList>{flatItemForEntry}</TocList>,
                ),
            );
        } finally {
            console.error = originalConsoleError;
        }

        expect(consoleErrorCalls).toEqual([]);
    });

    test("renders an empty headings list as an empty list and never calls the callback", () => {
        let callbackCalls = 0;
        const markup = renderToStaticMarkup(
            React.createElement(
                TocRoot,
                { headings: [] },
                <TocList>
                    {(entry: Heading) => {
                        callbackCalls += 1;
                        return flatItemForEntry(entry);
                    }}
                </TocList>,
            ),
        );

        expect((markup.match(/<ol/g) ?? []).length).toBe(1);
        expect(markup).not.toContain("href=");
        expect(callbackCalls).toBe(0);
    });

    test("throws in the targetIds lane, which owns no headings", () => {
        expect(() =>
            renderToStaticMarkup(
                React.createElement(
                    TocRoot,
                    { targetIds: ["intro"] },
                    <TocList>{(entry: Heading) => entry.id}</TocList>,
                ),
            ),
        ).toThrow(
            "TocList receives function children only when TocRoot owns headings; pass `headings` to TocRoot.",
        );
    });
});

describe("useTocHeadings SSR", () => {
    test("returns no headings on a null scope", () => {
        const probe = () => {
            const headings = useTocHeadings(null);
            return React.createElement("span", null, `${headings.length}`);
        };

        expect(renderToStaticMarkup(React.createElement(probe))).toContain(
            ">0<",
        );
    });
});

describe("TocValue", () => {
    test("throws outside a TocRoot", () => {
        expect(() =>
            renderToStaticMarkup(React.createElement(TocValue, null)),
        ).toThrow();
    });

    test("renders no element of its own", () => {
        const markup = renderToStaticMarkup(
            React.createElement(
                TocRoot,
                { headings: [heading("intro", 2, "Intro")] },
                React.createElement(TocValue, null),
            ),
        );

        expect(markup.startsWith("<nav")).toBe(true);
        expect(markup).not.toContain("<span");
        expect(markup).not.toContain("Intro");
    });

    test("passes the value to a children function", () => {
        const markup = renderToStaticMarkup(
            React.createElement(
                TocRoot,
                { headings: [heading("intro", 2, "Intro")] },
                <TocValue>
                    {(value: string | null) => `value:${value ?? "none"}`}
                </TocValue>,
            ),
        );

        expect(markup).toContain("value:none");
    });
});
