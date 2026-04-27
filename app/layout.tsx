import "./globals.css"

export const metadata = {
  title: "ReJoyce Workflow System",
  description: "Operational workflow management for care and education businesses",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* 📱 PWA + Mobile Setup */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#111827" />
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

      <body className="bg-gray-50">
        {/* 🧱 App Content Only */}
        {children}
      </body>
    </html>
  )
}