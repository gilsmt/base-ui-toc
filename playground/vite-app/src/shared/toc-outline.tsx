import {
  TocList,
  TocItem,
  TocLink,
  type HeadingGroup,
} from "../../../../src/table-of-contents";

/** The one node type consumers need when presenting an outline. */
export type { HeadingGroup };

/**
 * The README Anatomy renderer: the outline data renders as nested lists, one
 * item per node with a nested list of its children.
 */
export function TocOutline({ outline }: { outline: readonly HeadingGroup[] }) {
  return (
    <TocList>
      {outline.map((group) => (
        <OutlineItem key={group.id} group={group} />
      ))}
    </TocList>
  );
}

// Every node carries its children array, so the nested list renders
// unconditionally and a leaf list stays empty.
function OutlineItem({ group }: { group: HeadingGroup }) {
  return (
    <TocItem>
      <TocLink targetId={group.id}>{group.title}</TocLink>
      <TocList>
        {group.children.map((child) => (
          <OutlineItem key={child.id} group={child} />
        ))}
      </TocList>
    </TocItem>
  );
}
