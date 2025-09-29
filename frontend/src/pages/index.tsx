import { useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

export default function Home() {
  const [searchTerm, setSearchTerm] = useState('')
  const router = useRouter()

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchTerm.trim()) {
      router.push(`/product/${encodeURIComponent(searchTerm)}`)
    }
  }

  const featuredProducts = [
    { sku: 'SAMPLE-SKU-001', name: 'Sample Smart Speaker', score: 75, grade: 'B' },
    { sku: 'HONDA-CIVIC-2022', name: '2022 Honda Civic', score: 82, grade: 'B' },
    { sku: 'LAPTOP-XPS-13', name: 'Dell XPS 13 Laptop', score: 88, grade: 'A' },
  ]

  const getGradeColor = (grade: string) => {
    const colors: Record<string, string> = {
      A: 'text-green-600 bg-green-100',
      B: 'text-lime-600 bg-lime-100',
      C: 'text-yellow-600 bg-yellow-100',
      D: 'text-orange-600 bg-orange-100',
      F: 'text-red-600 bg-red-100',
    }
    return colors[grade] || 'text-gray-600 bg-gray-100'
  }

  return (
    <>
      <Head>
        <title>Trust as a Service - Product Trust Scores</title>
        <meta name="description" content="Check trust scores for products, companies, and services" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex justify-between items-center">
              <h1 className="text-3xl font-bold text-gray-900">Trust as a Service</h1>
              <nav className="space-x-4">
                <a href="/api-docs" className="text-gray-600 hover:text-gray-900">API</a>
                <a href="/about" className="text-gray-600 hover:text-gray-900">About</a>
              </nav>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-4xl font-bold mb-4">
                Make Informed Purchasing Decisions
              </h2>
              <p className="text-xl mb-8">
                Check trust scores based on recalls, complaints, warranties, and reviews
              </p>

              {/* Search Bar */}
              <form onSubmit={handleSearch} className="max-w-2xl mx-auto">
                <div className="flex rounded-lg overflow-hidden shadow-lg">
                  <input
                    type="text"
                    placeholder="Enter product SKU or name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1 px-6 py-4 text-gray-900 placeholder-gray-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-8 py-4 bg-blue-500 hover:bg-blue-600 text-white font-semibold transition-colors"
                  >
                    Search
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* Featured Products */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h3 className="text-2xl font-bold text-gray-900 mb-6">Featured Products</h3>
          <div className="grid md:grid-cols-3 gap-6">
            {featuredProducts.map((product) => (
              <div
                key={product.sku}
                className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => router.push(`/product/${product.sku}`)}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900">{product.name}</h4>
                    <p className="text-sm text-gray-500">{product.sku}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${getGradeColor(product.grade)}`}>
                    {product.grade}
                  </span>
                </div>
                <div className="flex items-center">
                  <div className="flex-1 bg-gray-200 rounded-full h-3 mr-3">
                    <div
                      className={`h-3 rounded-full ${
                        product.score >= 85 ? 'bg-green-500' :
                        product.score >= 70 ? 'bg-lime-500' :
                        product.score >= 55 ? 'bg-yellow-500' :
                        product.score >= 40 ? 'bg-orange-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${product.score}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-700">{product.score}/100</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How It Works */}
        <div className="bg-white py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">How It Works</h3>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">🔍</span>
                </div>
                <h4 className="text-lg font-semibold mb-2">Data Collection</h4>
                <p className="text-gray-600">
                  We aggregate data from NHTSA, CPSC, CFPB, and other public sources
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">📊</span>
                </div>
                <h4 className="text-lg font-semibold mb-2">Score Calculation</h4>
                <p className="text-gray-600">
                  Our algorithm weighs recalls, complaints, warranties, and reviews
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">✅</span>
                </div>
                <h4 className="text-lg font-semibold mb-2">Trust Score</h4>
                <p className="text-gray-600">
                  Get an explainable trust score with evidence and recommendations
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="bg-gray-800 text-white py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <p className="mb-2">© 2025 Trust as a Service. All rights reserved.</p>
              <div className="space-x-4 text-sm">
                <a href="/privacy" className="hover:text-gray-300">Privacy Policy</a>
                <a href="/terms" className="hover:text-gray-300">Terms of Service</a>
                <a href="/api-docs" className="hover:text-gray-300">API Documentation</a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}