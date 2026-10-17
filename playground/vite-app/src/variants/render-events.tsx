import * as React from "react";
import {
  TocRoot,
  TocList,
  TocItem,
  TocLink,
  buildOutline,
  discoverHeadings,
  type Heading,
  type TocActions,
} from "../../../../src/table-of-contents";
import type { HeadingGroup } from "../shared/toc-outline";
import "./render-events.css";

const ACTIVATION_OFFSET_MIN_PX = 0;
const ACTIVATION_OFFSET_MAX_PX = 240;
const ACTIVATION_OFFSET_STEP_PX = 8;

const FILLER_PARAGRAPH =
  "These rows exist so scrolling moves several headings past the activation line while the controls run.";

export function RenderEvents() {
  const articleRef = React.useRef<HTMLElement | null>(null);
  const actionsRef = React.useRef<TocActions | null>(null);
  const [headings, setHeadings] = React.useState<readonly Heading[]>([]);
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [activationOffsetPx, setActivationOffsetPx] = React.useState(ACTIVATION_OFFSET_MIN_PX);
  const [isBannerMounted, setIsBannerMounted] = React.useState(false);

  // Same discovery contract as docs-sidebar: a DOM read after mount.
  React.useLayoutEffect(() => {
    const article = articleRef.current;
    if (article === null) {
      return;
    }
    setHeadings(discoverHeadings(article));
  }, []);

  const outline = buildOutline(headings);

  return (
    <div className="pg-rv">
      <aside className="pg-rv-sidebar">
        <div className="pg-rv-controls">
          <label className="pg-rv-offset-label" htmlFor="pg-rv-offset">
            Activation offset
          </label>
          <input
            id="pg-rv-offset"
            type="range"
            min={ACTIVATION_OFFSET_MIN_PX}
            max={ACTIVATION_OFFSET_MAX_PX}
            step={ACTIVATION_OFFSET_STEP_PX}
            value={activationOffsetPx}
            onChange={handleOffsetChange}
          />
          <span className="pg-rv-offset-value">{activationOffsetPx} px</span>
          <div className="pg-rv-actions">
            <button type="button" onClick={handleToggleBanner}>
              {isBannerMounted ? "Hide banner" : "Show banner"}
            </button>
            <button type="button" onClick={handleRefresh}>Refresh</button>
          </div>
          <p className="pg-rv-current">
            current: <code>{currentId ?? "none"}</code>
          </p>
        </div>
        <TocRoot
          targetIds={headings.map((heading) => heading.id)}
          activationOffset={activationOffsetPx}
          onCurrentChange={handleCurrentChange}
          actionsRef={actionsRef}
          className="pg-rv-nav"
        >
          <TocList>
            {outline.map((group) => (
              <EventOutlineItem key={group.id} group={group} />
            ))}
          </TocList>
        </TocRoot>
        <p className="pg-rv-note">
          Large offsets can select a target below the fold; the tracker applies
          no clamp. Refresh and the banner toggle re-measure without waiting
          for a scroll.
        </p>
      </aside>
      <div className="pg-rv-main">
        {isBannerMounted && <Banner />}
        <article className="pg-rv-article" ref={articleRef}>
          <section id="session">
            <h2>Session</h2>
            <FillerParagraphs count={3} />
            <section id="session-story">
              <h3>Story</h3>
              <FillerParagraphs count={2} />
            </section>
          </section>
          <section id="gesture">
            <h2>Gesture</h2>
            <FillerParagraphs count={2} />
            <section id="gesture-thresholds">
              <h3>Thresholds</h3>
              <FillerParagraphs count={2} />
              <section id="gesture-thresholds-tuning">
                <h4>Tuning</h4>
                <FillerParagraphs count={2} />
              </section>
            </section>
          </section>
          <section id="records">
            <h2>Records</h2>
            <FillerParagraphs count={3} />
          </section>
        </article>
      </div>
    </div>
  );

  function handleCurrentChange(nextCurrentId: string | null) {
    setCurrentId(nextCurrentId);
  }

  function handleOffsetChange(event: React.ChangeEvent<HTMLInputElement>) {
    setActivationOffsetPx(event.target.valueAsNumber);
  }

  function handleToggleBanner() {
    setIsBannerMounted((wasMounted) => !wasMounted);
  }

  // The banner mounts above the article, so every heading moves; the tracker
  // keeps its last location until an explicit refresh() re-measures it.
  function handleRefresh() {
    actionsRef.current?.refresh();
  }
}

// A custom renderer: the part merges href, aria-current, and data-* into the
// props, this element spreads them, and the state prefix is a marker.
function EventOutlineItem({ group }: { group: HeadingGroup }) {
  return (
    <TocItem>
      <TocLink
        targetId={group.id}
        render={(props, state) => (
          <a
            {...props}
            className={state.current ? "pg-rv-link pg-rv-link-current" : "pg-rv-link"}
          >
            {state.current ? "▸ " : ""}
            {props.children}
          </a>
        )}
      >
        {group.title}
      </TocLink>
      <TocList>
        {group.children.map((child) => (
          <EventOutlineItem key={child.id} group={child} />
        ))}
      </TocList>
    </TocItem>
  );
}

function Banner() {
  return (
    <div className="pg-rv-banner">
      <p>Tall banner</p>
      <p>The banner shifts every heading down while it is mounted.</p>
    </div>
  );
}

// A tiny local helper keeps the article long without a content dependency.
function FillerParagraphs({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <p key={index}>{FILLER_PARAGRAPH}</p>
  ));
}
