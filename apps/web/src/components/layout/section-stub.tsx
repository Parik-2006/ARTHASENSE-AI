import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { NAV_ITEMS } from "@/lib/nav";

/** Placeholder for a section that has no real content yet. Says so plainly. */
export function SectionStub({ href, notice }: { href: string; notice: string }) {
  const item = NAV_ITEMS.find((n) => n.href === href);
  if (!item) throw new Error(`Unknown section ${href}`);
  return (
    <>
      <PageHeader eyebrow={item.label} title={item.label} lede={item.summary} />
      <EmptyState title="Nothing to show yet" milestone={item.milestone}>
        {notice}
      </EmptyState>
    </>
  );
}
