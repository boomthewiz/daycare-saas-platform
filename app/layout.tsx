import type { Metadata } from "next"
import { Fredoka, Nunito } from "next/font/google"
import "./globals.css"

const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-fredoka",
})

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
})

export const metadata: Metadata = {
  title: "ReJoyce",
  description: "Mobile-first care workflow software",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${fredoka.variable} ${nunito.variable}`}
    >
      <head>
        {/* 📱 Progressive Web App */}
        <link rel="manifest" href="/manifest.json" />

        <meta
          name="theme-color"
          content="#7BC6CF"
        />

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />

        <meta
          name="mobile-web-app-capable"
          content="yes"
        />

        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="default"
        />
      </head>

      <body>
        {children}
      </body>
    </html>
  )
}