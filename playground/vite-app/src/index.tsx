import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

// index.html authors the root element; a missing root means the page itself
// is misconfigured, so the lookup is asserted instead of branched on.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
