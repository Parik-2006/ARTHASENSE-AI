import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p>
          ArthaSense AI is a decision-support and research project. Forecasts are uncertain and are not
          investment advice.
        </p>
        <p className="flex gap-4">
          <Link href="/methodology" className="hover:text-ink">
            Methodology
          </Link>
          <Link href="/design" className="hover:text-ink">
            Design system
          </Link>
        </p>
      </div>
    </footer>
  );
}
