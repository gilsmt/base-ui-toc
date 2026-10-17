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
        <section>
          <h2 id="overview">Overview</h2>
          <p>
            The outline on the left lists the sections of this document and
            the tracker keeps one current location while the reader scrolls.
          </p>
          <FillerParagraphs count={3} />
          <section>
            <h3 id="coverage">What this document covers</h3>
            <p>
              This section group shows how a heading of one level collects the
              deeper headings that follow it.
            </p>
            <FillerParagraphs count={2} />
            <section>
              <h4 id="coverage-scope">Scope</h4>
              <FillerParagraphs count={2} />
            </section>
            <section>
              <h4 id="coverage-audience">Audience</h4>
              <FillerParagraphs count={2} />
            </section>
          </section>
        </section>
        <section>
          <h2 id="setup">Setup</h2>
          <FillerParagraphs count={2} />
          <section>
            <h3 id="setup-requirements">Requirements</h3>
            <p>
              The page needs a modern browser and a long article; nothing else
              is shared with the outline.
            </p>
            <FillerParagraphs count={2} />
          </section>
          <section>
            <h3 id="setup-environment">Environment</h3>
            <FillerParagraphs count={2} />
          </section>
        </section>
        <section>
          <h2 id="configuration">Configuration</h2>
          <FillerParagraphs count={2} />
          <section>
            <h3 id="configuration-options">Options</h3>
            <FillerParagraphs count={2} />
            <section>
              <h4 id="configuration-options-offsets">Offsets</h4>
              <p>
                The stylesheet lands anchors below the sticky header with a
                scroll margin on the headings.
              </p>
              <FillerParagraphs count={2} />
            </section>
            <section>
              <h4 id="configuration-options-fallbacks">Fallbacks</h4>
              <FillerParagraphs count={2} />
            </section>
          </section>
          <section>
            <h3 id="configuration-cancellation">Cancellation</h3>
            <FillerParagraphs count={2} />
          </section>
        </section>
        <section>
          <h2 id="events">Events</h2>
          <FillerParagraphs count={3} />
          <section>
            <h3 id="events-lifecycle">Lifecycle</h3>
            <FillerParagraphs count={2} />
          </section>
        </section>
        <section>
          <h2 id="accessibility">Accessibility</h2>
          <FillerParagraphs count={2} />
          <section>
            <h3 id="accessibility-keyboard">Keyboard</h3>
            <FillerParagraphs count={2} />
          </section>
          <section>
            <h3 id="accessibility-screen-readers">Screen readers</h3>
            <FillerParagraphs count={2} />
          </section>
        </section>
        <section>
          <h2 id="troubleshooting">Troubleshooting</h2>
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
