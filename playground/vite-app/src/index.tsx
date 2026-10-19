import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

// index.html authors the root element; a missing root is a misconfigured page, so the lookup asserts instead of branching.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
