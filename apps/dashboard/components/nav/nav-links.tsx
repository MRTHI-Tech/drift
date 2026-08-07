"use client"

/**
 * Runs, Findings, Conventions (AGENTS.md section 5). Nothing else goes here:
 * every other page in Drift is reached from one of these three.
 */

import Link from "next/link"
import { usePathname } from "next/navigation"
import { RiFileList2Line, RiPulseLine, RiRulerLine } from "@remixicon/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const ITEMS = [
  { href: "/runs", label: "Runs", Icon: RiPulseLine },
  { href: "/findings", label: "Findings", Icon: RiFileList2Line },
  { href: "/conventions", label: "Conventions", Icon: RiRulerLine },
] as const

export function NavLinks({ openFindings }: { openFindings: number }) {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-0.5">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`)

        return (
          <Button
            key={href}
            variant={active ? "secondary" : "ghost"}
            className="justify-start"
            render={<Link href={href} />}
            aria-current={active ? "page" : undefined}
          >
            <Icon data-icon="inline-start" />
            <span className="flex-1 text-left">{label}</span>
            {href === "/findings" && openFindings > 0 ? (
              <Badge>{openFindings}</Badge>
            ) : null}
          </Button>
        )
      })}
    </nav>
  )
}
