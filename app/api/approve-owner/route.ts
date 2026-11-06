import { NextResponse } from "next/server"

/** Retired: legacy daycare_id creation is incompatible with organization onboarding. */
export async function POST() {
 return NextResponse.json({error:"Legacy owner approval is retired. Use current organization onboarding."},
  {status:410,headers:{"Cache-Control":"private, no-store"}})
}
