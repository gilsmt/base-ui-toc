import * as React from "react";
import {
  TocRoot,
  TocList,
  TocItem,
  TocLink,
  discoverHeadings,
  type Heading,
} from "../../../../src/table-of-contents";
import "./dynamic-targets.css";

interface TargetSection {
  id: string;
  title: string;
}

const INITIAL_TARGET_SECTIONS: readonly TargetSection[] = [
  { id: "introduction", title: "Introduction" },
  { id: "containers", title: "Containers" },
  { id: "hidden-target", title: "The hidden target" },
  { id: "limits", title: "Limits" },
];

// Hiding leaves the heading in the DOM, so discovery keeps it and the tracker meets it as unavailable, not as an error.
const HIDDEN_SECTION_ID = "hidden-target";

const ADDED_SECTION_ID_PREFIX = "added";
const ADDED_SECTION_TITLE_PREFIX = "Added section";

const FILLER_PARAGRAPH =
  "The section holds filler text so the document scrolls while the collection changes.";

export function DynamicTargets() {
  const articleRef = React.useRef<HTMLElement | null>(null);
  const [targetSections, setTargetSections] = React.useState<readonly TargetSection[]>(
    INITIAL_TARGET_SECTIONS,
  );
  const [addedSectionOrdinal, setAddedSectionOrdinal] = React.useState(0);
  const [hiddenSectionId, setHiddenSectionId] = React.useState<string | null>(null);
  const [headings, setHeadings] = React.useState<readonly Heading[]>([]);

  // Manual discovery: section content mutates under the same article element,
  // and the snapshot hook re-discovers only on a scope identity change.
  React.useLayoutEffect(() => {
    const article = articleRef.current;
    if (article === null) {
      return;
    }
    setHeadings(discoverHeadings(article));
  }, [targetSections]);

  return (
    <div className="pg-dt">
      <aside className="pg-dt-sidebar">
        <div className="pg-dt-controls">
          <button type="button" onClick={handleAddSection}>Add section</button>
          <button type="button" onClick={handleRemoveLastSection}>Remove last</button>
          <button type="button" onClick={handleToggleHidden}>Toggle hidden</button>
        </div>
        <TocRoot headings={headings} className="pg-dt-nav">
          {/* One flat map in document order; the part authors the keys from the entry ids. */}
          <TocList>
            {(entry: Heading) => (
              <TocItem style={{ paddingInlineStart: `${(entry.level - 2) * 0.75}rem` }}>
                <TocLink targetId={entry.id}>{entry.title}</TocLink>
              </TocItem>
            )}
          </TocList>
        </TocRoot>
        <p className="pg-dt-note">
          The hidden section keeps its heading in the DOM, so it stays in the
          list and its link stays a plain anchor; the tracker reports it as
          unavailable. Removing the current target reports null right away, and
          the next scroll picks the new location.
        </p>
      </aside>
      <article className="pg-dt-article" ref={articleRef}>
        {targetSections.map((targetSection) => {
          const isHiddenTarget = targetSection.id === hiddenSectionId;
          return (
            <section
              key={targetSection.id}
              className={isHiddenTarget ? "pg-dt-section pg-dt-section-hidden" : "pg-dt-section"}
            >
              <h2 id={targetSection.id}>{targetSection.title}</h2>
              <p>{FILLER_PARAGRAPH}</p>
              <p>{FILLER_PARAGRAPH}</p>
            </section>
          );
        })}
      </article>
    </div>
  );

  function handleAddSection() {
    const nextOrdinal = addedSectionOrdinal + 1;
    // The ordinal only grows, so an added section keeps an id distinct from every id the page has printed.
    setAddedSectionOrdinal(nextOrdinal);
    setTargetSections((currentSections) => [
      ...currentSections,
      {
        id: `${ADDED_SECTION_ID_PREFIX}-${nextOrdinal}`,
        title: `${ADDED_SECTION_TITLE_PREFIX} ${nextOrdinal}`,
      },
    ]);
  }

  function handleRemoveLastSection() {
    setTargetSections((currentSections) => currentSections.slice(0, -1));
  }

  function handleToggleHidden() {
    setHiddenSectionId((currentHiddenId) =>
      currentHiddenId === HIDDEN_SECTION_ID ? null : HIDDEN_SECTION_ID,
    );
  }
}
