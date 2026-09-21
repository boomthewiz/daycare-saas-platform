"use client"

import Link from "next/link"
import { Branch } from "@/lib/branches"

export default function ClientBranchPicker({ branches, value, onChange, disabled = false }: {
  branches: Branch[]
  value: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  const options = branches.filter(branch => branch.active || value.includes(branch.id))
  const selectedNames = branches.filter(branch => value.includes(branch.id)).map(branch => branch.name)
  return <fieldset disabled={disabled} className="min-w-0">
    <legend className="rj-label">Branches</legend>
    <p className="rj-caption my-2">Choose one or more branches where this client receives services.</p>
    {options.length ? <details className="rounded-xl border border-[var(--rj-border)] bg-white">
      <summary className="cursor-pointer px-4 py-3 font-medium">
        {selectedNames.length ? selectedNames.join(", ") : "Select branches"}
      </summary>
      <div className="max-h-60 space-y-1 overflow-y-auto border-t border-[var(--rj-border)] p-2">
        {options.map(branch => <label key={branch.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-3 hover:bg-gray-50">
          <input type="checkbox" checked={value.includes(branch.id)}
            onChange={event => onChange(event.target.checked ? [...value, branch.id] : value.filter(id => id !== branch.id))}
            className="h-4 w-4 accent-teal-700" />
          <span>{branch.name}{!branch.active && <span className="ml-2 text-sm text-gray-500">(inactive)</span>}</span>
        </label>)}
      </div>
    </details> : <p className="rounded-xl bg-amber-50 p-3 text-sm">
      Add an active branch in <Link href="/operations" className="font-semibold underline">Operations → Branches</Link> before creating a client.
    </p>}
  </fieldset>
}
