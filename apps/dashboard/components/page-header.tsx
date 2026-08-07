/**
 * The heading every page opens with. Sentence case, one line of what the page
 * is for, no decoration (AGENTS.md sections 5 and 6).
 */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-heading text-lg">{title}</h1>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}
