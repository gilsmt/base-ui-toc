import * as React from "react";
import {
  TocRoot,
  buildOutline,
  discoverHeadings,
  type Heading,
} from "../../../../src/table-of-contents";
import { TocOutline } from "../shared/toc-outline";
import "./docs-sidebar.css";

// Repeat one sentence so the article length stays easy to reason about.
const FILLER_PARAGRAPH =
  "The section body holds filler text so the page grows long enough to scroll through several headings in one read.";

export function DocsSidebar() {
  const articleRef = React.useRef<HTMLElement | null>(null);
  const [headings, setHeadings] = React.useState<readonly Heading[]>([]);

  // Discovery is a client-side DOM read (README): run it after mount, never
  // during rendering, and guard on the article being live.
  React.useLayoutEffect(() => {
    const article = articleRef.current;
    if (article === null) {
      return;
    }
    setHeadings(discoverHeadings(article));
  }, []);

  const outline = buildOutline(headings);

  return (
    <div className="pg-docs">
      <aside className="pg-docs-sidebar">
        <TocRoot
          targetIds={headings.map((heading) => heading.id)}
          className="pg-docs-nav"
        >
          <TocOutline outline={outline} />
        </TocRoot>
      </aside>
      {/* Headings carry scroll-margin-top in the stylesheet so fragment
          landings clear the sticky header; the value matches its height. */}
      <article className="pg-docs-article" ref={articleRef}>
        <section id="overview">
          <h2>Overview</h2>
          <p>
            The outline on the left lists the sections of this document and
            the tracker keeps one current location while the reader scrolls.
          </p>
          <FillerParagraphs count={3} />
          <section id="coverage">
            <h3>What this document covers</h3>
            <p>
              This section group shows how a heading of one level collects the
              deeper headings that follow it.
            </p>
            <FillerParagraphs count={2} />
            <section id="coverage-scope">
              <h4>Scope</h4>
              <FillerParagraphs count={2} />
            </section>
            <section id="coverage-audience">
              <h4>Audience</h4>
              <FillerParagraphs count={2} />
            </section>
          </section>
        </section>
        <section id="setup">
          <h2>Setup</h2>
          <FillerParagraphs count={2} />
          <section id="setup-requirements">
            <h3>Requirements</h3>
            <p>
              The page needs a modern browser and a long article; nothing else
              is shared with the outline.
            </p>
            <FillerParagraphs count={2} />
          </section>
          <section id="setup-environment">
            <h3>Environment</h3>
            <FillerParagraphs count={2} />
          </section>
        </section>
        <section id="configuration">
          <h2>Configuration</h2>
          <FillerParagraphs count={2} />
          <section id="configuration-options">
            <h3>Options</h3>
            <FillerParagraphs count={2} />
            <section id="configuration-options-offsets">
              <h4>Offsets</h4>
              <p>
                The stylesheet lands anchors below the sticky header with a
                scroll margin on the headings.
              </p>
              <FillerParagraphs count={2} />
            </section>
            <section id="configuration-options-fallbacks">
              <h4>Fallbacks</h4>
              <FillerParagraphs count={2} />
            </section>
          </section>
          <section id="configuration-cancellation">
            <h3>Cancellation</h3>
            <FillerParagraphs count={2} />
          </section>
        </section>
        <section id="events">
          <h2>Events</h2>
          <FillerParagraphs count={3} />
          <section id="events-lifecycle">
            <h3>Lifecycle</h3>
            <FillerParagraphs count={2} />
          </section>
        </section>
        <section id="accessibility">
          <h2>Accessibility</h2>
          <FillerParagraphs count={2} />
          <section id="accessibility-keyboard">
            <h3>Keyboard</h3>
            <FillerParagraphs count={2} />
          </section>
          <section id="accessibility-screen-readers">
            <h3>Screen readers</h3>
            <FillerParagraphs count={2} />
          </section>
        </section>
        <section id="troubleshooting">
          <h2>Troubleshooting</h2>
          <FillerParagraphs count={3} />
        </section>
      </article>
    </div>
  );
}

// A tiny local helper keeps the article long without a content dependency.
function FillerParagraphs({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <p key={index}>{FILLER_PARAGRAPH}</p>
  ));
}
