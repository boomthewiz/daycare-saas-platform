"use client"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { useSessionContext } from "@/components/SessionContextChoices"
export default function SessionTags({sessionId}:{sessionId:string}){
 const {data:caps}=useEffectiveCapabilities()
 const {data,error}=useSessionContext(caps?.sessions===true,sessionId)
 if(!caps?.sessions)return null
 return <section className="rj-card space-y-2 p-4"><h2 className="font-semibold">Recorded activity context</h2>{error?<p role="alert">{error}</p>:<p>{data?.tags.length?data.tags.map(tag=>`${tag.label} (${tag.domain})`).join(" · "):"No activity tags recorded."}</p>}<p className="text-sm">Context labels do not verify parent training, attendance or clinical outcomes. Saved labels reflect the creation-time selection.</p></section>
}
