"use client"

/**
 * Who is signed in, and the way out. One user, so there is nothing else in
 * here: no roles, no invitations, no teams (AGENTS.md section 1).
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { RiLogoutBoxRLine, RiMoreLine } from "@remixicon/react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function AccountMenu({
  name,
  email,
  picture,
}: {
  name: string | null
  email: string | null
  picture: string | null
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)

  async function signOut() {
    setPending(true)
    await fetch("/api/auth/session", { method: "DELETE" })
    router.replace("/login")
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-auto w-full justify-start px-2 py-2"
          />
        }
      >
        <Avatar className="size-6">
          {picture ? <AvatarImage src={picture} alt="" /> : null}
          <AvatarFallback>
            {(name ?? email ?? "?").slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate text-left text-xs">
          {email ?? name ?? "Signed in"}
        </span>
        <RiMoreLine className="text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={signOut} disabled={pending}>
          <RiLogoutBoxRLine data-icon="inline-start" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
