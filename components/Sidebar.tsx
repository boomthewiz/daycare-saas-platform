'use client'

import Link from 'next/link'

export default function Sidebar() {
  return (
    <div className="w-64 h-screen bg-gray-900 text-white p-6 flex flex-col gap-4">

      <h1 className="text-xl font-bold mb-6">Daycare Manager</h1>

      <Link href="/dashboard" className="hover:text-gray-300">
        Dashboard
      </Link>

      <Link href="/teachers" className="hover:text-gray-300">
        Teachers
      </Link>

      <Link href="/children" className="hover:text-gray-300">
        Children
      </Link>

      <Link href="/templates" className="hover:text-gray-300">
        Task Templates
      </Link>

      <Link href="/reports" className="hover:text-gray-300">
        Reports
      </Link>

    </div>
  )
}