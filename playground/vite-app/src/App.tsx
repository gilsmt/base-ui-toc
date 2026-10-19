import * as React from "react";
import { variants } from "./variants";

export function App() {
  // The registry always holds entries, so the first is the initial variant.
  const [selectedId, setSelectedId] = React.useState(variants[0].id);

  // A switch replaces the main area; the next variant's page must not inherit the previous document scroll.
  React.useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [selectedId]);

  const selected = variants.find((variant) => variant.id === selectedId);
  // The button ids and the state share one registry, so the selection always resolves.
  if (selected === undefined) {
    throw new Error(`No variant is registered for the id "${selectedId}"`);
  }

  return (
    <>
      <header className="pg-header">
        <h1 className="pg-title">base-ui-toc playground</h1>
      </header>
      <div className="pg-body">
        <nav aria-label="Playground variants" className="pg-nav">
          <ul className="pg-nav-list">
            {variants.map((variant) => {
              const isSelected = variant.id === selected.id;
              return (
                <li key={variant.id}>
                  <button
                    type="button"
                    aria-current={isSelected ? "true" : undefined}
                    className="pg-nav-button"
                    onClick={() => selectVariant(variant.id)}
                  >
                    <span className="pg-nav-label">{variant.label}</span>
                    <span className="pg-nav-description">{variant.description}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="pg-main">{selected.element}</main>
      </div>
    </>
  );

  function selectVariant(nextId: string) {
    setSelectedId(nextId);
  }
}
