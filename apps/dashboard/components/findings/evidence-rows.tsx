/**
 * The evidence, in plain language and with the exact values named
 * (AGENTS.md section 6).
 *
 * Every row is read straight off the stored `evidence` record. Nothing is
 * recomputed here and nothing is rounded: the observed value is the string the
 * extractor read out of the rendered screen, which is the same string the
 * reconciliation gate checked before this finding was allowed to exist.
 */

import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { count } from "@/lib/format"
import type { FindingEvidence } from "@drift/core/types"

export function EvidenceRows({
  evidence,
  kind,
  archetypeLabel,
}: {
  evidence: FindingEvidence
  kind: "pattern" | "token"
  archetypeLabel: string | null
}) {
  const rows: [string, React.ReactNode][] = [
    [
      "Property",
      <span key="property" className="font-mono">
        {evidence.property}
      </span>,
    ],
    [
      "This screen renders",
      <span key="observed" className="font-mono">
        {evidence.observedValue}
      </span>,
    ],
    [
      kind === "token" ? "The nearest token is" : "The other screens render",
      <span key="expected" className="font-mono">
        {evidence.expectedValue.length > 0
          ? evidence.expectedValue
          : "nothing on any scale"}
      </span>,
    ],
  ]

  if (evidence.expectedSource) {
    rows.push([
      kind === "token" ? "Declared as" : "Counted as",
      <span key="source" className="font-mono">
        {evidence.expectedSource}
      </span>,
    ])
  }

  if (evidence.selector) {
    rows.push([
      "Seen on",
      <span key="selector" className="font-mono break-all">
        {evidence.selector}
      </span>,
    ])
  }

  if (kind === "pattern") {
    rows.push([
      "Compared against",
      <span key="siblings">
        {count(evidence.siblingScreenIds.length, "sibling screen")}
        {archetypeLabel ? ` of ${archetypeLabel}` : ""}
      </span>,
    ])
  }

  return (
    <Table>
      <TableBody>
        {rows.map(([label, value]) => (
          <TableRow key={label}>
            <TableCell className="w-56 align-top text-muted-foreground">
              {label}
            </TableCell>
            <TableCell className="leading-relaxed">{value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
