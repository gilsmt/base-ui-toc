import * as React from "react";
import {
  TocRoot,
  TocList,
  TocGroup,
  type Heading,
} from "../../../../src/table-of-contents";
import "./scroll-container.css";

// Hard-coded source data: discovery is skipped so the grouping edge cases
// (README §buildOutline) are visible without page content.
const HEADINGS: readonly Heading[] = [
  { id: "getting-started", title: "Getting started", level: 2 },
  { id: "getting-started-install", title: "Install", level: 3 },
  { id: "getting-started-requirements", title: "Requirements", level: 3 },
  { id: "api", title: "API", level: 2 },
  // A skipped level: the h4 nests directly under the h2 above, with no h3.
  { id: "api-internals", title: "Internals", level: 4 },
  { id: "api-rendering", title: "Rendering", level: 3 },
  { id: "api-rendering-content", title: "Content", level: 4 },
  { id: "api-rendering-changes", title: "Changes", level: 4 },
  // A later heading shallower than the branch above starts a new top group.
  { id: "notes", title: "Notes", level: 2 },
  { id: "notes-keyboard", title: "Keyboard", level: 3 },
  { id: "standards", title: "Standards", level: 2 },
  { id: "standards-tracing", title: "Tracing", level: 3 },
  { id: "standards-tracing-history", title: "History", level: 4 },
  { id: "colophon", title: "Colophon", level: 2 },
];

const FILLER_PARAGRAPH =
  "This body text fills the scrollbox so several headings travel past the activation line in one scroll.";

export function ScrollContainer() {
  const [scrollElement, setScrollElement] = React.useState<HTMLDivElement | null>(null);
  // The scrollport reaches the tracker through callback-ref state: if the box
  // unmounts and reattaches, the new element resumes tracking (README §4).
  const attachScrollElement = React.useCallback((element: HTMLDivElement | null) => {
    setScrollElement(element);
  }, []);

  return (
    <div className="pg-scroll">
      <aside className="pg-scroll-sidebar">
        <TocRoot headings={HEADINGS} scrollElement={scrollElement} className="pg-scroll-nav">
          <TocList>
            {(group) => <TocGroup key={group.id} group={group} />}
          </TocList>
        </TocRoot>
      </aside>
      <div className="pg-scroll-view" ref={attachScrollElement}>
        {HEADINGS.map((heading) => (
          <ScrollSection key={heading.id} heading={heading} />
        ))}
        <div className="pg-scroll-end">End of the box</div>
      </div>
    </div>
  );
}

function ScrollSection({ heading }: { heading: Heading }) {
  return (
    <section className="pg-scroll-section">
      <SectionHeading heading={heading} />
      <p>{FILLER_PARAGRAPH}</p>
    </section>
  );
}

// The tracker validates no tag names: the heading carries the anchor id and
// mirrors the entry level.
function SectionHeading({ heading }: { heading: Heading }) {
  switch (heading.level) {
    case 2:
      return <h2 id={heading.id}>{heading.title}</h2>;
    case 3:
      return <h3 id={heading.id}>{heading.title}</h3>;
    case 4:
      return <h4 id={heading.id}>{heading.title}</h4>;
    // The static data holds only levels 2-4; the Heading annotation permits
    // any level, so the assumption is explicit.
    default:
      throw new Error(`The scroll-container data holds level ${heading.level}, but the sections render levels 2-4`);
  }
}
