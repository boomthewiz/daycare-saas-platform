export const defaultTerms = {
  client_singular: "Client", client_plural: "Clients",
  frontline_singular: "Team Member", frontline_plural: "Team Members",
  session_singular: "Session", session_plural: "Sessions",
  target_singular: "Target", target_plural: "Targets",
}
export type PortalTerms = typeof defaultTerms
export type PortalTheme = "rejoyce" | "ocean" | "lavender"
export const themes: { id: PortalTheme; name: string; description: string }[] = [
  { id: "rejoyce", name: "ReJoyce", description: "Familiar mint and teal with soft rounded cards." },
  { id: "ocean", name: "Ocean", description: "Crisp blue accents and a calm professional feel." },
  { id: "lavender", name: "Lavender", description: "Warm violet accents and welcoming soft surfaces." },
]
export const vocabularyPresets: { id: string; name: string; terms: PortalTerms }[] = [
  { id: "general", name: "General services", terms: defaultTerms },
  { id: "education", name: "Education", terms: { ...defaultTerms, client_singular: "Student", client_plural: "Students", frontline_singular: "Teacher", frontline_plural: "Teachers", session_singular: "Lesson", session_plural: "Lessons", target_singular: "Goal", target_plural: "Goals" } },
  { id: "childcare", name: "Childcare", terms: { ...defaultTerms, client_singular: "Child", client_plural: "Children", frontline_singular: "Educator", frontline_plural: "Educators", session_singular: "Activity", session_plural: "Activities", target_singular: "Goal", target_plural: "Goals" } },
  { id: "therapy", name: "Therapy", terms: { ...defaultTerms, frontline_singular: "Therapist", frontline_plural: "Therapists", session_singular: "Appointment", session_plural: "Appointments", target_singular: "Goal", target_plural: "Goals" } },
]
export function normalizeTerms(value: Record<string, unknown> | null): PortalTerms {
  return Object.fromEntries(Object.entries(defaultTerms).map(([key, fallback]) => [key,
    typeof value?.[key] === "string" && (value[key] as string).trim() ? value[key] : fallback,
  ])) as PortalTerms
}
/** One pass avoids translating a customer's vocabulary a second time. Never use for data or roles. */
export function translatePortalText(text: string, terms: PortalTerms): string {
  const replacements: Record<string, string> = {
    clients: terms.client_plural, client: terms.client_singular,
    "team members": terms.frontline_plural, "team member": terms.frontline_singular,
    "frontline workers": terms.frontline_plural, "frontline worker": terms.frontline_singular,
    sessions: terms.session_plural, session: terms.session_singular,
    targets: terms.target_plural, target: terms.target_singular,
  }
  return text.replace(/\b(team members|team member|frontline workers|frontline worker|clients|client|sessions|session|targets|target)\b/gi, word => {
    const replacement = replacements[word.toLowerCase()]
    return word === word.toLowerCase() ? replacement.toLowerCase() : word === word.toUpperCase() ? replacement.toUpperCase() : replacement
  })
}
