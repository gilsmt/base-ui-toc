import * as React from "react";
import { afterAll, describe, expect, test } from "bun:test";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";

// The client renderer and the server renderer each install React's dispatcher
// at module scope, so they cannot share a process. This file runs on its own
// (see the `test:client` script); the server-side tests run in the default
// `bun test` process.

// The client-side behavior of the parts needs a DOM. happy-dom has no layout,
// so the geometry is faked: every target sits at the top that the test gives it.
const win = new Window({ url: "http://localhost/" });

const globals = globalThis as unknown as Record<string, unknown>;
const previousGlobals = new Map<string, unknown>();
function setGlobal(name: string, value: unknown) {
    previousGlobals.set(name, globals[name]);
    globals[name] = value;
}

setGlobal("window", win);
setGlobal("document", win.document);
setGlobal("HTMLElement", win.HTMLElement);
setGlobal("Element", win.Element);
setGlobal("Node", win.Node);
setGlobal("getComputedStyle", win.getComputedStyle.bind(win));
setGlobal("requestAnimationFrame", win.requestAnimationFrame.bind(win));
setGlobal("cancelAnimationFrame", win.cancelAnimationFrame.bind(win));
setGlobal("ResizeObserver", win.ResizeObserver);
setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const headingTops = new Map<string, number>();

// happy-dom has its own DOM types, so the prototype is patched through a
// loosely typed view of it.
const elementPrototype = win.Element.prototype as unknown as Record<
    string,
    unknown
>;

elementPrototype["getBoundingClientRect"] = function getBoundingClientRect(
    this: Element,
) {
    const id = this.getAttribute("id");
    const top = id === null ? 0 : (headingTops.get(id) ?? 0);
    return {
        top,
        bottom: top + 24,
        left: 0,
        right: 0,
        width: 0,
        height: 24,
        x: 0,
        y: top,
        toJSON: () => ({}),
    };
};

elementPrototype["getClientRects"] = function getClientRects(this: Element) {
    return [this.getBoundingClientRect()];
};

let scrollListenerAdds = 0;
const originalAddEventListener = win.addEventListener.bind(win);
win.addEventListener = ((
    type: string,
    listener: unknown,
    options?: unknown,
): void => {
    if (type === "scroll") scrollListenerAdds += 1;
    originalAddEventListener(
        type as never,
        listener as never,
        options as never,
    );
}) as unknown as typeof win.addEventListener;

afterAll(() => {
    for (const [name, value] of previousGlobals) {
        if (value === undefined) delete globals[name];
        else globals[name] = value;
    }
    win.close();
});

const { act } = await import("react");
const { TocItem, TocLink, TocList, TocRoot, TocValue, discoverHeadings } =
    await import("../../src/table-of-contents");

// The reports are logged once per message, so each test starts with a clean slate.
const { reset } = await import("@base-ui/utils/createLogOnce");

async function captureWarnings(
    run: () => void | Promise<void>,
): Promise<string[]> {
    reset();
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
    };
    try {
        await run();
    } finally {
        console.warn = originalWarn;
    }
    return warnings;
}

const HEADINGS = ["intro", "scope"];

// A collection the consumer keeps stable across renders.
const STABLE_IDS = HEADINGS;
const STABLE_ONE_ID = ["intro"];

function addHeadings(ids: readonly string[]) {
    for (const id of ids) {
        const heading = win.document.createElement("h2");
        heading.id = id;
        heading.textContent = id;
        win.document.body.append(heading);
        headingTops.set(id, 0);
    }
}

type HappyElement = InstanceType<typeof win.HTMLElement>;

async function mount(
    node: React.ReactNode,
    container: HappyElement = win.document.createElement("div"),
) {
    win.document.body.append(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => {
        root.render(node);
    });
    return {
        container,
        async rerender(next: React.ReactNode) {
            await act(async () => {
                root.render(next);
            });
        },
        async unmount() {
            await act(async () => {
                root.unmount();
            });
            container.remove();
        },
    };
}

class TestErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { errorMessage: string | null }
> {
    override state: { errorMessage: string | null } = { errorMessage: null };

    static getDerivedStateFromError(error: unknown) {
        return {
            errorMessage:
                error instanceof Error ? error.message : "Unknown error",
        };
    }

    override render() {
        if (this.state.errorMessage !== null)
            return <span>{this.state.errorMessage}</span>;
        return this.props.children;
    }
}

// The tracker measures in an animation frame, so a test waits for one.
async function flushFrames() {
    await act(async () => {
        await new Promise((resolve) => {
            setTimeout(resolve, 40);
        });
    });
}

function scroll() {
    win.dispatchEvent(new win.Event("scroll"));
}

describe("collection identity", () => {
    test("a stable collection leaves the tracker alone across parent renders", async () => {
        addHeadings(HEADINGS);
        let linkRenders = 0;

        const children = (
            <TocList>
                <TocItem>
                    <TocLink
                        targetId="intro"
                        render={(props) => {
                            linkRenders += 1;
                            return <a {...props} />;
                        }}
                    />
                </TocItem>
            </TocList>
        );

        function App({ tick }: { tick: number }) {
            return (
                <TocRoot targetIds={STABLE_IDS}>
                    {children}
                    <span>{tick}</span>
                </TocRoot>
            );
        }

        const { rerender, unmount } = await mount(<App tick={0} />);
        await flushFrames();
        const rendersAfterMount = linkRenders;
        const listenerAddsAfterMount = scrollListenerAdds;

        await rerender(<App tick={1} />);

        expect(linkRenders - rendersAfterMount).toBe(0);
        expect(scrollListenerAdds - listenerAddsAfterMount).toBe(0);

        await unmount();
    });

    test("a replaced collection reconfigures the tracker", async () => {
        addHeadings(HEADINGS);
        let linkRenders = 0;

        const children = (
            <TocList>
                <TocItem>
                    <TocLink
                        targetId="intro"
                        render={(props) => {
                            linkRenders += 1;
                            return <a {...props} />;
                        }}
                    />
                </TocItem>
            </TocList>
        );

        function App({ ids }: { ids: readonly string[] }) {
            return <TocRoot targetIds={ids}>{children}</TocRoot>;
        }

        const { rerender, unmount } = await mount(<App ids={["intro"]} />);
        await flushFrames();
        const rendersAfterMount = linkRenders;

        await rerender(<App ids={["intro", "scope"]} />);
        await flushFrames();

        expect(linkRenders - rendersAfterMount).toBeGreaterThan(0);

        await unmount();
    });
    test("a second lane is rejected after the first one was tracked", async () => {
        addHeadings(HEADINGS);

        // The collection stays stable, so only the added lane changes.
        function App({ ids, entries }: { ids?: readonly string[]; entries?: readonly { id: string; title: string; level: 2 }[] }) {
            return (
                <TocRoot targetIds={ids} headings={entries}>
                    <TocList>
                        <TocItem>
                            <TocLink targetId="intro">Intro</TocLink>
                        </TocItem>
                    </TocList>
                </TocRoot>
            );
        }

        const { rerender } = await mount(<App ids={STABLE_ONE_ID} />);
        await flushFrames();

        await expect(
            rerender(
                <App
                    ids={STABLE_ONE_ID}
                    entries={[{ id: "intro", title: "Intro", level: 2 }]}
                />,
            ),
        ).rejects.toThrow();

        await flushFrames();
    });
});

describe("current change notification", () => {
    test("a parent re-render does not re-notify", async () => {
        addHeadings(HEADINGS);
        headingTops.set("intro", 0);
        headingTops.set("scope", 400);

        const observed: (string | null)[] = [];

        function App({ tick }: { tick: number }) {
            return (
                <TocRoot
                    targetIds={HEADINGS}
                    onCurrentChange={(id) => {
                        observed.push(id);
                    }}
                >
                    <TocList>
                        <TocItem>
                            <TocLink targetId="intro">Intro</TocLink>
                        </TocItem>
                    </TocList>
                    <span>{tick}</span>
                </TocRoot>
            );
        }

        const { rerender } = await mount(<App tick={0} />);
        await flushFrames();

        await rerender(<App tick={1} />);
        await flushFrames();

        expect(observed).toEqual(["intro"]);
    });

    test("StrictMode notifies the measured value once", async () => {
        addHeadings(HEADINGS);
        headingTops.set("intro", 0);
        headingTops.set("scope", 400);

        const observed: (string | null)[] = [];

        await mount(
            <React.StrictMode>
                <TocRoot
                    targetIds={HEADINGS}
                    onCurrentChange={(id) => {
                        observed.push(id);
                    }}
                >
                    <TocList>
                        <TocItem>
                            <TocLink targetId="intro">Intro</TocLink>
                        </TocItem>
                    </TocList>
                </TocRoot>
            </React.StrictMode>,
        );
        await flushFrames();

        expect(observed).toEqual(["intro"]);
    });

    test("the callback runs after the commit, so the DOM shows the new current link", async () => {
        addHeadings(HEADINGS);
        headingTops.set("intro", 0);
        headingTops.set("scope", 400);

        const container = win.document.createElement("div");
        const observed: { id: string | null; ariaCurrent: string | null }[] = [];

        const { unmount } = await mount(
            <TocRoot
                targetIds={HEADINGS}
                onCurrentChange={(id) => {
                    observed.push({
                        id,
                        ariaCurrent:
                            container
                                .querySelector('a[href="#intro"]')
                                ?.getAttribute("aria-current") ?? null,
                    });
                }}
            >
                <TocList>
                    <TocItem>
                        <TocLink targetId="intro">Intro</TocLink>
                    </TocItem>
                    <TocItem>
                        <TocLink targetId="scope">Scope</TocLink>
                    </TocItem>
                </TocList>
            </TocRoot>,
            container,
        );
        await flushFrames();

        expect(observed).toEqual([{ id: "intro", ariaCurrent: "location" }]);

        await unmount();
    });

    test("the callback runs once per change", async () => {
        addHeadings(HEADINGS);
        headingTops.set("intro", 0);
        headingTops.set("scope", 400);

        const observed: (string | null)[] = [];

        await mount(
            <TocRoot
                targetIds={HEADINGS}
                onCurrentChange={(id) => {
                    observed.push(id);
                }}
            >
                <TocList>
                    <TocItem>
                        <TocLink targetId="intro">Intro</TocLink>
                    </TocItem>
                    <TocItem>
                        <TocLink targetId="scope">Scope</TocLink>
                    </TocItem>
                </TocList>
            </TocRoot>,
        );
        await flushFrames();

        // Scrolling past the second heading moves the current target.
        headingTops.set("scope", -10);
        scroll();
        await flushFrames();

        expect(observed).toEqual(["intro", "scope"]);
    });

    test("a removed current target reports null at once", async () => {
        addHeadings(HEADINGS);
        headingTops.set("intro", 0);
        headingTops.set("scope", -10);

        const observed: (string | null)[] = [];

        function App({ ids }: { ids: readonly string[] }) {
            return (
                <TocRoot
                    targetIds={ids}
                    onCurrentChange={(id) => {
                        observed.push(id);
                    }}
                >
                    <TocList>
                        {ids.map((id) => (
                            <TocItem key={id}>
                                <TocLink targetId={id}>{id}</TocLink>
                            </TocItem>
                        ))}
                    </TocList>
                </TocRoot>
            );
        }

        const { rerender } = await mount(<App ids={["intro"]} />);
        await flushFrames();

        await rerender(<App ids={["scope"]} />);
        await flushFrames();

        expect(observed).toEqual(["intro", null, "scope"]);
    });

    test("refresh() picks up a moved target without a scroll event", async () => {
        addHeadings(HEADINGS);
        headingTops.set("intro", 400);
        headingTops.set("scope", 800);

        const observed: (string | null)[] = [];
        const actionsRef = React.createRef<
            { refresh(): void } | null
        >() as React.RefObject<{ refresh(): void } | null>;

        await mount(
            <TocRoot
                targetIds={HEADINGS}
                actionsRef={actionsRef}
                onCurrentChange={(id) => {
                    observed.push(id);
                }}
            >
                <TocList>
                    <TocItem>
                        <TocLink targetId="intro">Intro</TocLink>
                    </TocItem>
                    <TocItem>
                        <TocLink targetId="scope">Scope</TocLink>
                    </TocItem>
                </TocList>
            </TocRoot>,
        );
        await flushFrames();

        expect(observed).toEqual([]);

        headingTops.set("intro", -10);
        await act(async () => {
            actionsRef.current?.refresh();
        });
        await flushFrames();

        expect(observed).toEqual(["intro"]);
    });

    test("unmounting stops the notifications", async () => {
        addHeadings(HEADINGS);
        headingTops.set("intro", 0);
        headingTops.set("scope", 400);

        const observed: (string | null)[] = [];

        const { unmount } = await mount(
            <TocRoot
                targetIds={HEADINGS}
                onCurrentChange={(id) => {
                    observed.push(id);
                }}
            >
                <TocList>
                    <TocItem>
                        <TocLink targetId="intro">Intro</TocLink>
                    </TocItem>
                    <TocItem>
                        <TocLink targetId="scope">Scope</TocLink>
                    </TocItem>
                </TocList>
            </TocRoot>,
        );
        await flushFrames();
        await unmount();

        headingTops.set("scope", -10);
        scroll();
        await flushFrames();

        expect(observed).toEqual(["intro"]);
    });
});

describe("heading discovery", () => {
    test("returns an empty array for a null scope", () => {
        expect(discoverHeadings(null)).toEqual([]);
    });

    test("leaves out a heading that cannot be represented and reports it", async () => {
        const scope = win.document.createElement("article");
        const headings = [
            { id: "kept", text: "Kept" },
            { id: null, text: "No id" },
            { id: "kept", text: "Duplicate id" },
            { id: "empty", text: "" },
        ];
        for (const heading of headings) {
            const element = win.document.createElement("h2");
            if (heading.id !== null) element.id = heading.id;
            element.textContent = heading.text;
            scope.append(element);
        }

        const warnings = await captureWarnings(() => {
            const discovered = discoverHeadings(scope as unknown as Element);
            expect(discovered).toEqual([
                { id: "kept", title: "Kept", level: 2 },
            ]);
        });

        expect(warnings).toHaveLength(3);
        expect(warnings[0]).toContain("no valid id");
        expect(warnings[1]).toContain("already belongs");
        expect(warnings[2]).toContain("no text");
    });

    test("keeps the heading that owns the id when a later one repeats it", async () => {
        const scope = win.document.createElement("article");
        for (const text of ["First", "Second"]) {
            const element = win.document.createElement("h2");
            element.id = "shared";
            element.textContent = text;
            scope.append(element);
        }

        await captureWarnings(() => {
            expect(discoverHeadings(scope as unknown as Element)).toEqual([
                { id: "shared", title: "First", level: 2 },
            ]);
        });
    });

    test("does not emit a visible heading when a hidden heading owns its id", async () => {
        const scope = win.document.createElement("article");
        const hiddenHeading = win.document.createElement("h2");
        hiddenHeading.id = "shared";
        hiddenHeading.textContent = "Hidden";
        hiddenHeading.hidden = true;
        scope.append(hiddenHeading);

        const visibleHeading = win.document.createElement("h2");
        visibleHeading.id = "shared";
        visibleHeading.textContent = "Visible";
        scope.append(visibleHeading);

        const warnings = await captureWarnings(() => {
            expect(discoverHeadings(scope as unknown as Element)).toEqual([]);
        });

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("already belongs");
    });

    test("excludes headings inside an aria-hidden shadow host", async () => {
        const host = win.document.createElement("div");
        host.setAttribute("aria-hidden", "true");
        const shadowRoot = host.attachShadow({ mode: "open" });
        const scope = win.document.createElement("article");
        const heading = win.document.createElement("h2");
        heading.id = "hidden-shadow-heading";
        heading.textContent = "Hidden";
        scope.append(heading);
        shadowRoot.append(scope);
        win.document.body.append(host);

        try {
            const warnings = await captureWarnings(() => {
                expect(discoverHeadings(scope as unknown as Element)).toEqual(
                    [],
                );
            });

            expect(warnings).toHaveLength(0);
        } finally {
            host.remove();
        }
    });
});

describe("element scroller", () => {
    test("rejects a scroller from a different document", async () => {
        const otherWindow = new Window();
        const scroller = otherWindow.document.createElement("div");
        const consoleErrors: unknown[][] = [];
        const originalConsoleError = console.error;
        console.error = (...args: unknown[]) => {
            consoleErrors.push(args);
        };

        try {
            const mounted = await mount(
                <TestErrorBoundary>
                    <TocRoot
                        targetIds={[]}
                        scrollElement={scroller as unknown as Element}
                    />
                </TestErrorBoundary>,
            );
            try {
                expect(mounted.container.textContent).toContain(
                    "same document as TocRoot",
                );
                expect(consoleErrors.flat().map(String).join("\n")).toContain(
                    "same document as TocRoot",
                );
            } finally {
                await mounted.unmount();
            }
        } finally {
            console.error = originalConsoleError;
            otherWindow.close();
        }
    });

    test("leaves out a target outside the scroller and keeps tracking the others", async () => {
        const scroller = win.document.createElement("div");
        Object.defineProperty(scroller, "clientHeight", { value: 400 });
        Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
        win.document.body.append(scroller);

        const inside = win.document.createElement("h2");
        inside.id = "inside";
        inside.textContent = "Inside";
        scroller.append(inside);

        const outside = win.document.createElement("h2");
        outside.id = "outside";
        outside.textContent = "Outside";
        win.document.body.append(outside);

        headingTops.set("inside", 0);
        headingTops.set("outside", 0);

        const observed: (string | null)[] = [];
        const warnings = await captureWarnings(async () => {
            await mount(
                <TocRoot
                    targetIds={["inside", "outside"]}
                    scrollElement={scroller as unknown as Element}
                    onCurrentChange={(id) => {
                        observed.push(id);
                    }}
                >
                    <TocList>
                        <TocItem>
                            <TocLink targetId="inside">Inside</TocLink>
                        </TocItem>
                        <TocItem>
                            <TocLink targetId="outside">Outside</TocLink>
                        </TocItem>
                    </TocList>
                </TocRoot>,
            );
            await flushFrames();
        });

        expect(warnings.join("\n")).toContain("outside its configured scroller");
        expect(observed).toEqual(["inside"]);
    });
});

describe("TocValue", () => {
    test("renders the current heading's title as text", async () => {
        addHeadings(HEADINGS);
        headingTops.set("intro", 0);
        headingTops.set("scope", 400);

        const { container } = await mount(
            <TocRoot headings={[{ id: "intro", title: "Intro", level: 2 }]}>
                <TocValue />
            </TocRoot>,
        );
        await flushFrames();

        expect(container.textContent).toBe("Intro");
    });

    test("renders a static child instead of the current value", async () => {
        addHeadings(HEADINGS);
        headingTops.set("intro", 0);
        headingTops.set("scope", 400);

        const { container } = await mount(
            <TocRoot headings={[{ id: "intro", title: "Intro", level: 2 }]}>
                <TocValue>Custom value</TocValue>
            </TocRoot>,
        );
        await flushFrames();

        expect(container.textContent).toBe("Custom value");
    });

    test("uses the current value when children is null", async () => {
        addHeadings(HEADINGS);
        headingTops.set("intro", 0);
        headingTops.set("scope", 400);

        const { container } = await mount(
            <TocRoot headings={[{ id: "intro", title: "Intro", level: 2 }]}>
                <TocValue>{null}</TocValue>
            </TocRoot>,
        );
        await flushFrames();

        expect(container.textContent).toBe("Intro");
    });
});
