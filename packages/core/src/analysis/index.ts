/**
 * The deterministic analysis layer: token diffing and signature construction.
 * Nothing here calls a model, and nothing here may (AGENTS.md section 4). The
 * judgment phase reads what this produces; it never replaces it.
 */

export * from "./color"
export * from "./components"
export * from "./copy"
export * from "./findings"
export * from "./hash"
export * from "./length"
export * from "./literal"
export * from "./screens"
export * from "./signature"
export * from "./token-diff"
export * from "./tokens"
