/**
 * Rendering one target: navigate, still the page, wait for it to settle,
 * screenshot it, walk it. Everything here is per target, so a throw takes down
 * one route and not the run (AGENTS.md section 7).
 */
import { VIEWPORT_SIZES } from "@drift/core"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright"

import { buildExtraction, collectElements, walkerOptions, type Extraction } from "./extract"
import type { Logger } from "./logger"
import { targetUrl, type RenderTarget } from "./targets"

/** Motion off, so two runs of the same screen cannot differ by timing alone. */
export const MOTION_OFF_CSS =
  "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}"

const NAVIGATION_TIMEOUT_MS = 30_000
const NETWORK_IDLE_TIMEOUT_MS = 15_000
const FONTS_TIMEOUT_MS = 5_000

/** What every target of a run shares. */
export interface RenderSettings {
  previewUrl: string
  /** Cookie name from the project's config, null when its routes are public. */
  authCookieName: string | null
  /** Value from the environment. Never logged. */
  authCookieValue: string | null
}

export interface Capture {
  url: string
  status: number
  screenshot: Buffer
  extraction: Extraction
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch()
}

/**
 * One target, start to finish. The caller owns the browser; this owns the
 * context, and closes it whether or not the target worked.
 */
export async function captureTarget(
  browser: Browser,
  target: RenderTarget,
  settings: RenderSettings,
  logger: Logger,
): Promise<Capture> {
  const url = targetUrl(settings.previewUrl, target.route)
  const context = await createContext(browser, target, settings)

  try {
    const page = await context.newPage()
    const status = await navigate(page, url, logger)

    await stillPage(page)
    await settle(page, logger)

    const screenshot = await page.screenshot({
      fullPage: true,
      type: "png",
      animations: "disabled",
      caret: "hide",
    })
    logger.log("render.screenshot_taken", { bytes: screenshot.byteLength })

    const raw = await page.evaluate(collectElements, walkerOptions())
    const extraction = buildExtraction(raw)
    logger.log("extract.done", {
      elements: extraction.elementCount,
      textElements: Object.keys(extraction.text).length,
      truncated: extraction.truncated,
    })

    return { url, status, screenshot, extraction }
  } finally {
    await context.close()
  }
}

async function createContext(
  browser: Browser,
  target: RenderTarget,
  settings: RenderSettings,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: VIEWPORT_SIZES[target.viewport],
    deviceScaleFactor: 1,
    // Pinned rather than inherited: the host's own settings must not change
    // what a run records.
    colorScheme: "light",
    reducedMotion: "reduce",
  })
  context.setDefaultTimeout(NAVIGATION_TIMEOUT_MS)

  if (settings.authCookieName && settings.authCookieValue) {
    await context.addCookies([
      {
        name: settings.authCookieName,
        value: settings.authCookieValue,
        url: settings.previewUrl,
      },
    ])
  }

  // Applied before any of the page's own script runs, so an animation cannot
  // start in the gap between load and the stylesheet landing.
  await context.addInitScript(injectMotionOff, MOTION_OFF_CSS)

  return context
}

/** Runs inside the page, on every document, before anything else. */
function injectMotionOff(css: string): void {
  // See the same shim in extract.ts: esbuild's `keepNames` helper does not
  // exist inside the page.
  const scope = globalThis as unknown as { __name?: (value: unknown) => unknown }
  scope.__name ??= (value) => value

  const install = (): void => {
    const style = document.createElement("style")
    style.setAttribute("data-drift", "motion-off")
    style.textContent = css
    document.head.appendChild(style)
  }
  if (document.head) {
    install()
  } else {
    document.addEventListener("DOMContentLoaded", install, { once: true })
  }
}

async function navigate(page: Page, url: string, logger: Logger): Promise<number> {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: NAVIGATION_TIMEOUT_MS,
  })
  if (!response) {
    throw new Error(`${url} returned no response`)
  }

  const status = response.status()
  if (status >= 400) {
    throw new Error(`${url} returned HTTP ${status}`)
  }

  logger.log("render.navigated", { url, status })
  return status
}

/** The init script covers new documents; this covers the one already open. */
async function stillPage(page: Page): Promise<void> {
  await page.addStyleTag({ content: MOTION_OFF_CSS })
}

/**
 * Network idle, then webfonts. Neither is fatal: an app that polls never goes
 * idle, and waiting forever would cost the route for no gain. A route that
 * really is broken fails at navigation or at extraction instead.
 */
async function settle(page: Page, logger: Logger): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS })
  } catch {
    logger.log("render.network_idle_timeout", { afterMs: NETWORK_IDLE_TIMEOUT_MS })
  }

  try {
    await page.waitForFunction(() => document.fonts.status === "loaded", undefined, {
      timeout: FONTS_TIMEOUT_MS,
    })
  } catch {
    logger.log("render.fonts_timeout", { afterMs: FONTS_TIMEOUT_MS })
  }
}

/** The cookie value a run uses, from the environment (AGENTS.md section 8). */
export function authCookieValue(): string | null {
  const value = process.env.PREVIEW_AUTH_COOKIE_VALUE
  return value && value.length > 0 ? value : null
}

/** Everything a target needs to render, or a clear reason it cannot. */
export function renderSettings(
  previewUrl: string,
  authCookieName: string | null,
): RenderSettings {
  const value = authCookieValue()
  if (authCookieName && !value) {
    // Without the cookie every signed-in route renders a login page under the
    // route's own name, which would poison every later comparison.
    throw new Error(
      `The config sets authCookieName "${authCookieName}" but PREVIEW_AUTH_COOKIE_VALUE is empty.`,
    )
  }
  return { previewUrl, authCookieName, authCookieValue: authCookieName ? value : null }
}
