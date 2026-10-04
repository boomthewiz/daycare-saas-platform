"use client"

import { useState } from "react"
import { validateSessionTypeDuration } from "@/lib/session-type-duration"

export default function SessionTypeDurationField({ value, onChange, error }: {
  value: string
  onChange: (value: string) => void
  error: string | null
}) {
  const [touched, setTouched] = useState(false)
  const feedback = error || (touched ? validateSessionTypeDuration(value) : null)
  return (
    <div>
      <label htmlFor="session-type-duration" className="rj-label">Default duration (minutes)</label>
      <div className="mt-2 flex items-center gap-3">
        <input
          id="session-type-duration"
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-required="true"
          aria-invalid={!!feedback}
          aria-describedby="session-type-duration-help session-type-duration-error"
          className="rj-input min-w-0"
        />
        <span className="rj-caption shrink-0">minutes</span>
      </div>
      <p id="session-type-duration-help" className="rj-caption mt-2">Required. Whole minutes from 1 to 1,440 (24 hours).</p>
      <p id="session-type-duration-error" role="alert" className="mt-2 text-sm text-[var(--rj-danger)]">{feedback}</p>
    </div>
  )
}
