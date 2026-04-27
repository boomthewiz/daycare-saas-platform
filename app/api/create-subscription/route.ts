import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json({
    message: "Create subscription route is ready for Stripe setup",
    success: true,
  })
}