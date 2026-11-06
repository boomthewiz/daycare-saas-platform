"use client"
import type { ReactNode } from "react"
import Link from "next/link"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"

/** Presentation boundary only. SQL independently gates every clinical record. */
export default function ClinicalAccessBoundary({ children }: { children: ReactNode }) {
 const {data,loading,error,refresh}=useEffectiveCapabilities()
 if(loading)return <p role="status" className="p-6">Checking access…</p>
 if(!data?.clinical)return <div className="p-6" role="status"><p>This workspace is unavailable for your current access.</p>{error&&<button className="rj-button" onClick={()=>void refresh()}>Retry access check</button>}<Link className="block underline mt-3" href="/my-sessions">Return to scheduled work</Link></div>
 return children
}
