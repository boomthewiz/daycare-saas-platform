"use client"

type ConstructionPageProps = {
  title: string
  icon: string
  description: string
}

function ConstructionPage({
  title,
  icon,
  description,
}: ConstructionPageProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-blue-100 to-yellow-100 p-6">
      <div className="max-w-3xl mx-auto">

        {/* 🫧 Header Card */}
        <div className="bg-white rounded-3xl shadow-xl p-10 text-center">

          <div className="text-6xl mb-4">
            {icon}
          </div>

          <h1 className="text-3xl font-bold text-gray-800 mb-3">
            {title}
          </h1>

          <p className="text-gray-500 text-lg mb-6">
            {description}
          </p>

          <div className="inline-block px-6 py-3 rounded-2xl bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 text-white font-semibold shadow-lg">
            🚧 Feature Under Construction
          </div>

          <p className="text-sm text-gray-400 mt-6">
            This section is being built as part of the ReJoyce Workflow System
          </p>

          {/* 🎈 Bubble Footer */}
          <div className="flex justify-center gap-3 mt-8">
            <div className="w-4 h-4 rounded-full bg-pink-300"></div>
            <div className="w-3 h-3 rounded-full bg-blue-300"></div>
            <div className="w-5 h-5 rounded-full bg-yellow-300"></div>
            <div className="w-3 h-3 rounded-full bg-purple-300"></div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ConstructionPage