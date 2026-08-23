/**
 * Turning component divergences into `findings` documents, through the same
 * dedupe gate token findings go through.
 *
 * These are pattern findings, because they answer to a convention rather than
 * to the token file, and they carry the convention's id like any other. What
 * makes them different from the pattern findings the judgment phase raises is
 * that no model was involved at any point: `screenComponents` reads the value
 * off the extraction record, counting decides what the kind agrees on, and
 * comparison finds the instance that departs. There is nothing for the
 * reconciliation gate (AGENTS.md section 3) to verify, because nothing was
 * proposed. The gate stands where a model speaks, and no model speaks here.
 *
 * Which means the evidence sentence is written here rather than by a flow. It
 * is composed from three things that were all counted, in the register
 * AGENTS.md section 6 asks for: what this control renders, and how much of the
 * product renders something else.
 */

import { dedupeKey } from "../dedupe"
import type { FindingRepository } from "../repositories/findings"
import type { NewEntity } from "../repositories/document"
import type { Finding } from "../types"
import type { StyleProperty } from "../constants"
import {
  COMPONENT_ASPECT,
  COMPONENT_KIND_LABEL,
  COMPONENT_KIND_SINGULAR,
  componentProperty,
  type ComponentDivergence,
} from "./components"

/**
 * How loud a component finding is, by the property it is about.
 *
 * Fixed per property and never asked for, the same way pattern severity is.
 * Set here rather than beside `PATTERN_SEVERITY` because that table is keyed
 * by profile property and read by the judgment phase, and this one is keyed by
 * CSS property and read by core. A colour or a type size is something a person
 * sees; a border style is something they see on a second look.
 */
export const COMPONENT_SEVERITY: Partial<Record<StyleProperty, number>> = {
  color: 2,
  "background-color": 2,
  "font-size": 2,
  "font-weight": 2,
  padding: 2,
  "border-radius": 1,
  "border-width": 1,
  "border-style": 1,
}

/** Severity of a property with no entry above. */
export const DEFAULT_COMPONENT_SEVERITY = 1

export interface ComponentFindingInput {
  projectId: string
  runId: string
  route: string
  divergence: ComponentDivergence
  createdAt?: Date
}

/**
 * One divergence as a finding document. Pure: the same divergence always
 * yields the same document apart from its timestamp, which is what makes the
 * dedupe key stable across runs.
 *
 * `siblingScreenIds` is left empty on purpose. On a pattern finding it means
 * the screens rendering the expected value, and a component convention's
 * siblings are instances rather than screens: the same screen can hold one
 * button that agrees and one that does not, so a list of screen ids would be
 * a list that contradicts itself. The counts are in the sentence instead.
 */
export function componentFinding(input: ComponentFindingInput): NewEntity<Finding> {
  const { divergence } = input
  const property = componentProperty(divergence.kind, divergence.property)

  return {
    projectId: input.projectId,
    runId: input.runId,
    type: "pattern",
    screenId: divergence.screenId,
    conventionId: divergence.conventionId,
    evidence: {
      selector: divergence.selector,
      property,
      observedValue: divergence.observedValue,
      expectedValue: divergence.expectedValue,
      expectedSource: COMPONENT_KIND_LABEL[divergence.kind],
      siblingScreenIds: [],
      sentence: componentSentence(divergence),
    },
    severity: COMPONENT_SEVERITY[divergence.property as StyleProperty] ?? DEFAULT_COMPONENT_SEVERITY,
    status: "open",
    dedupeKey: componentDedupeKey(input.projectId, input.route, divergence),
    prNumber: null,
    createdAt: input.createdAt ?? new Date(),
    resolvedAt: null,
  }
}

/**
 * The key a component finding dedupes on: project, route, property, observed
 * value (AGENTS.md section 2).
 *
 * The property carried into the key is the dotted one, so a button and a
 * radio rendering the same wrong radius on the same route stay two findings.
 * They are two: one kind of control looking wrong is not evidence about the
 * other. Two buttons on one route rendering it are one finding, cited at the
 * first in document order, exactly as a hardcoded colour inherited across a
 * screen is one finding.
 */
export function componentDedupeKey(
  projectId: string,
  route: string,
  divergence: ComponentDivergence,
): string {
  return dedupeKey({
    projectId,
    route,
    property: componentProperty(divergence.kind, divergence.property),
    observedValue: divergence.observedValue,
  })
}

/**
 * The finding in one line: what this control renders, and what the rest of its
 * kind renders. Evidence first, exact values, exact counts, no verdict about
 * which of the two is right (AGENTS.md section 6).
 */
export function componentSentence(divergence: ComponentDivergence): string {
  const aspect = COMPONENT_ASPECT[divergence.property as StyleProperty] ?? divergence.property
  const one = COMPONENT_KIND_SINGULAR[divergence.kind]
  const many = COMPONENT_KIND_LABEL[divergence.kind].toLowerCase()

  return (
    `This ${one} has a ${aspect} of ${divergence.observedValue}. ` +
    `${divergence.agreeing} of ${divergence.considered} ${many} in this product ` +
    `have ${divergence.expectedValue}.`
  )
}

export interface PersistComponentFindingsInput extends Omit<ComponentFindingInput, "divergence" | "route"> {
  findings: FindingRepository
  divergences: readonly ComponentDivergence[]
  /** The route each divergent screen sits on, by screen id. */
  routes: ReadonlyMap<string, string>
}

export interface ComponentFindingsResult {
  /** Findings this run wrote. */
  created: Finding[]
  /** Divergences an existing finding already covers, of any status. */
  alreadyKnown: number
}

/**
 * Writes every divergence that is not already a finding, in order. A
 * divergence on a screen whose route is unknown is skipped rather than written
 * under a guessed one: the route is half the dedupe key, and a wrong key is a
 * finding that raises itself again on every run forever.
 */
export async function persistComponentFindings(
  input: PersistComponentFindingsInput,
): Promise<ComponentFindingsResult> {
  const created: Finding[] = []
  let alreadyKnown = 0

  for (const divergence of input.divergences) {
    const route = input.routes.get(divergence.screenId)
    if (route === undefined) continue

    const result = await input.findings.createIfNew(
      componentFinding({ ...input, route, divergence }),
    )
    if (result.created) created.push(result.finding)
    else alreadyKnown += 1
  }

  return { created, alreadyKnown }
}
