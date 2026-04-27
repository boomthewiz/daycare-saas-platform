import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json({
    message: "Stripe webhook route is ready for event handling",
    success: true,
  })
}