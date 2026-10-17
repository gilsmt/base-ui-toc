import type * as React from "react";
import { DocsSidebar } from "./variants/docs-sidebar";
import { ScrollContainer } from "./variants/scroll-container";
import { RenderEvents } from "./variants/render-events";
import { DynamicTargets } from "./variants/dynamic-targets";

/** One worked use case; the element is a singleton of its variant component. */
export interface VariantEntry {
  id: string;
  label: string;
  description: string;
  element: React.ReactElement;
}

// The single source of truth for the playground: App reads this registry and
// no variant appears anywhere else.
export const variants: VariantEntry[] = [
  {
    id: "docs-sidebar",
    label: "Document scroll",
    description: "useTocOutline snapshot + document viewport tracking",
    element: <DocsSidebar />,
  },
  {
    id: "scroll-container",
    label: "Embedded scroll area",
    description: "static headings data + element scrollport",
    element: <ScrollContainer />,
  },
  {
    id: "render-events",
    label: "Custom render + events",
    description: "onCurrentChange, activationOffset, render prop, actionsRef.refresh()",
    element: <RenderEvents />,
  },
  {
    id: "dynamic-targets",
    label: "Dynamic targets",
    description: "manual discovery commits, unavailable targets",
    element: <DynamicTargets />,
  },
];
