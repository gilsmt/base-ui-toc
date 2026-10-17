import * as React from "react";
import {
  TocRoot,
  TocList,
  TocItem,
  TocLink,
  TocGroup,
  discoverHeadings,
  type Heading,
  type HeadingGroup,
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

// Hiding sets display: none on one subtree: its heading stays in the DOM, so
// discovery keeps including it and the tracker meets it as unavailable
// instead of as an error (README §target IDs).
const HIDDEN_SECTION_ID = "hidden-target";

const ADDED_SECTION_ID_PREFIX = "added";
const ADDED_SECTION_TITLE_PREFIX = "Added section";

const FILLER_PARAGRAPH =
  "The section holds filler text so the document scrolls while the collection changes.";

// One render callback reused at every depth: the item and the link for one
// group, and TocGroup feeding the child groups back into it. Keys are
// library-authored from the group ids.
const outlineItem = (group: HeadingGroup): React.ReactElement => (
  <TocItem>
    <TocLink targetId={group.id}>{group.title}</TocLink>
    <TocGroup group={group}>{outlineItem}</TocGroup>
  </TocItem>
);

export function DynamicTargets() {
  const articleRef = React.useRef<HTMLElement | null>(null);
  const [targetSections, setTargetSections] = React.useState<readonly TargetSection[]>(
    INITIAL_TARGET_SECTIONS,
  );
  const [addedSectionOrdinal, setAddedSectionOrdinal] = React.useState(0);
  const [hiddenSectionId, setHiddenSectionId] = React.useState<string | null>(null);
  const [headings, setHeadings] = React.useState<readonly Heading[]>([]);

  // Discovery re-runs per committed collection change; the hidden class does
  // not change the snapshot, because hidden headings are still discovered.
  // Manual discovery stays here: the section content mutates under the same
  // article element, and the snapshot hook re-discovers only on a scope
  // identity change (README §Server rendering).
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
          <TocList>{outlineItem}</TocList>
        </TocRoot>
        <p className="pg-dt-note">
          The hidden section keeps its heading in the DOM, so it stays in the
          outline and its link stays a plain anchor; the tracker reports it as
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
    // The ordinal only grows, so a section added after a removal keeps an
    // id distinct from every id the page has ever printed.
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
