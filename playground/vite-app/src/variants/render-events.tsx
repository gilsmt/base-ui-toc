import * as React from "react";
import {
  TocRoot,
  TocList,
  TocItem,
  TocLink,
  useTocOutline,
  type Heading,
  type TocActions,
} from "../../../../src/table-of-contents";
import "./render-events.css";

const ACTIVATION_OFFSET_MIN_PX = 0;
const ACTIVATION_OFFSET_MAX_PX = 240;
const ACTIVATION_OFFSET_STEP_PX = 8;

const FILLER_PARAGRAPH =
  "These rows exist so scrolling moves several headings past the activation line while the controls run.";

export function RenderEvents() {
  const [article, setArticle] = React.useState<HTMLElement | null>(null);
  const actionsRef = React.useRef<TocActions | null>(null);
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [activationOffsetPx, setActivationOffsetPx] = React.useState(ACTIVATION_OFFSET_MIN_PX);
  const [isBannerMounted, setIsBannerMounted] = React.useState(false);

  // Mount-time snapshot: discovery runs once per article identity; refresh() re-measures without re-discovery.
  const { headings } = useTocOutline(article);

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
          headings={headings}
          activationOffset={activationOffsetPx}
          onCurrentChange={handleCurrentChange}
          actionsRef={actionsRef}
          className="pg-rv-nav"
        >
          {/* One flat map; the custom render spreads the merged props and marks the current location. */}
          <TocList>
            {(entry: Heading) => (
              <TocItem style={{ paddingInlineStart: `${(entry.level - 2) * 0.75}rem` }}>
                <TocLink
                  targetId={entry.id}
                  render={(props, state) => (
                    <a {...props} className={state.current ? "pg-rv-link pg-rv-link-current" : "pg-rv-link"}>
                      {state.current ? "▸ " : ""}
                      {props.children}
                    </a>
                  )}
                >
                  {entry.title}
                </TocLink>
              </TocItem>
            )}
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
        <article className="pg-rv-article" ref={setArticle}>
          <section>
            <h2 id="session">Session</h2>
            <FillerParagraphs count={3} />
            <section>
              <h3 id="session-story">Story</h3>
              <FillerParagraphs count={2} />
            </section>
          </section>
          <section>
            <h2 id="gesture">Gesture</h2>
            <FillerParagraphs count={2} />
            <section>
              <h3 id="gesture-thresholds">Thresholds</h3>
              <FillerParagraphs count={2} />
              <section>
                <h4 id="gesture-thresholds-tuning">Tuning</h4>
                <FillerParagraphs count={2} />
              </section>
            </section>
          </section>
          <section>
            <h2 id="records">Records</h2>
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

  // The banner shifts every heading; the tracker keeps its location until refresh() re-measures.
  function handleRefresh() {
    actionsRef.current?.refresh();
  }
}

function Banner() {
  return (
    <div className="pg-rv-banner">
      <p>Tall banner</p>
      <p>The banner shifts every heading down while it is mounted.</p>
    </div>
  );
}

function FillerParagraphs({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <p key={index}>{FILLER_PARAGRAPH}</p>
  ));
}
