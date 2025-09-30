import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import axios from 'axios'
import ProductCard from '@/components/ProductCard'
import SearchFilter from '@/components/SearchFilter'
import ScoreVisualization from '@/components/ScoreVisualization'
import SearchResults from '@/components/SearchResults'
import { useSearch } from '@/hooks/useSearch'

interface Product {
  sku: string
  name: string
  brand?: string
  score: number
  grade: string
  policyScore?: number | null
  companyScore?: number | null
  price?: number
  warrantyMonths?: number
  imageUrl?: string
}

export default function Home() {
  const router = useRouter()
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([])
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Use resolver-based search hook
  const { results: resolverResults, loading: resolverLoading, error: resolverError, search: searchWithResolver } = useSearch()

  useEffect(() => {
    fetchFeaturedProducts()
  }, [])

  const fetchFeaturedProducts = async () => {
    try {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/api/products/featured`,
        {
          headers: {
            'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme'
          }
        }
      )
      setFeaturedProducts(response.data)
    } catch (error) {
      console.error('Failed to fetch featured products:', error)
      // Use mock data for demonstration
      setFeaturedProducts([
        {
          sku: 'IPHONE-13-PRO-MAX',
          name: 'iPhone 13 Pro Max',
          brand: 'Apple',
          score: 88,
          grade: 'A',
          policyScore: 90,
          companyScore: 92,
          price: 1099,
          warrantyMonths: 12
        },
        {
          sku: 'BOSE-QC45',
          name: 'Bose QuietComfort 45',
          brand: 'Bose',
          score: 85,
          grade: 'A',
          policyScore: 82,
          companyScore: 88,
          price: 329,
          warrantyMonths: 12
        },
        {
          sku: 'SAMSUNG-WF45',
          name: 'Samsung Washer WF45',
          brand: 'Samsung',
          score: 82,
          grade: 'B',
          policyScore: 78,
          companyScore: 80,
          price: 899,
          warrantyMonths: 24
        }
      ])
    }
  }

  const handleSearch = async (query: string, filters: any) => {
    setSearchQuery(query)
    setShowSearchResults(true)

    // Use resolver-based search for simple queries
    if (query && !filters.minScore && !filters.categories?.length && !filters.brands?.length) {
      searchWithResolver(query)
      return
    }

    // Fallback to old search for filtered queries
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query) params.append('q', query)
      if (filters.minScore) params.append('minScore', filters.minScore.toString())
      if (filters.maxScore) params.append('maxScore', filters.maxScore.toString())
      if (filters.categories?.length) params.append('categories', filters.categories.join(','))
      if (filters.brands?.length) params.append('brands', filters.brands.join(','))
      if (filters.sortBy) params.append('sortBy', filters.sortBy)
      if (filters.sortOrder) params.append('sortOrder', filters.sortOrder)

      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/api/products/search?${params.toString()}`,
        {
          headers: {
            'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme'
          }
        }
      )
      setSearchResults(response.data.results || [])
    } catch (error) {
      console.error('Search failed:', error)
      // For demo, filter featured products
      setSearchResults(
        featuredProducts.filter(p =>
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          p.brand?.toLowerCase().includes(query.toLowerCase())
        )
      )
    } finally {
      setLoading(false)
    }
  }

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
        {/* Header - Responsive */}
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6">
            <div className="flex flex-col sm:flex-row justify-between items-center">
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3 sm:mb-0">
                Trust as a Service
              </h1>
              <nav className="flex space-x-2 sm:space-x-4">
                <a
                  href="/compare"
                  className="px-3 py-1 text-sm md:text-base text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Compare
                </a>
                <a
                  href="/dashboard"
                  className="px-3 py-1 text-sm md:text-base text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Dashboard
                </a>
                <a
                  href="/api-docs"
                  className="px-3 py-1 text-sm md:text-base text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  API
                </a>
              </nav>
            </div>
          </div>
        </header>

        {/* Hero Section - Responsive */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white py-12 md:py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
                Make Informed Purchasing Decisions
              </h2>
              <p className="text-lg md:text-xl mb-8 px-4 md:px-0">
                Check trust scores based on recalls, complaints, warranties, and reviews
              </p>

              {/* Search Component - Full Featured */}
              <div className="max-w-4xl mx-auto">
                <SearchFilter
                  onSearch={handleSearch}
                  placeholder="Search products, brands, or enter SKU..."
                  showAdvanced={true}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Search Results or Featured Products - Responsive Grid */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
          {/* Resolver-based search results */}
          {showSearchResults && resolverResults && (
            <div className="mb-8">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl md:text-2xl font-bold text-gray-900">
                  Search Results for "{searchQuery}"
                </h3>
                <button
                  onClick={() => {
                    setShowSearchResults(false)
                    setSearchQuery('')
                  }}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Clear Search
                </button>
              </div>
              {resolverError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <p className="text-red-700">{resolverError}</p>
                </div>
              )}
              <SearchResults results={resolverResults} loading={resolverLoading} />
            </div>
          )}

          {/* Old search results fallback (only when not using resolver) */}
          {!resolverResults && (
            showSearchResults && searchResults.length > 0 ? (
              <>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl md:text-2xl font-bold text-gray-900">
                    {loading ? 'Searching...' : `Search Results (${searchResults.length})`}
                  </h3>
                  <button
                    onClick={() => setShowSearchResults(false)}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    ← Back to Featured
                  </button>
                </div>

                {loading ? (
                  <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500">No products found matching your criteria</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                    {searchResults.map((product) => (
                      <ProductCard key={product.sku} {...product} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Featured Products</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {featuredProducts.map((product) => (
                    <ProductCard key={product.sku} {...product} />
                  ))}
                </div>
              </>
            )
          )}
        </div>

        {/* Stats Section - Responsive */}
        <div className="bg-white py-8 md:py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-6 text-center">
              Trust Score Statistics
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-2xl md:text-3xl font-bold text-blue-600">156+</p>
                <p className="text-sm md:text-base text-gray-600 mt-1">Products Analyzed</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-2xl md:text-3xl font-bold text-green-600">72</p>
                <p className="text-sm md:text-base text-gray-600 mt-1">Avg Trust Score</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-2xl md:text-3xl font-bold text-yellow-600">1.2K+</p>
                <p className="text-sm md:text-base text-gray-600 mt-1">Data Sources</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-2xl md:text-3xl font-bold text-purple-600">98%</p>
                <p className="text-sm md:text-base text-gray-600 mt-1">Accuracy Rate</p>
              </div>
            </div>
          </div>
        </div>

        {/* How It Works - Responsive */}
        <div className="bg-gradient-to-br from-gray-50 to-white py-8 md:py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-8 text-center">How It Works</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
              <div className="text-center px-4">
                <div className="w-14 h-14 md:w-16 md:h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl md:text-3xl">🔍</span>
                </div>
                <h4 className="text-base md:text-lg font-semibold mb-2">Data Collection</h4>
                <p className="text-sm md:text-base text-gray-600">
                  We aggregate data from NHTSA, CPSC, CFPB, and other public sources
                </p>
              </div>
              <div className="text-center px-4">
                <div className="w-14 h-14 md:w-16 md:h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl md:text-3xl">📊</span>
                </div>
                <h4 className="text-base md:text-lg font-semibold mb-2">Score Calculation</h4>
                <p className="text-sm md:text-base text-gray-600">
                  Our algorithm weighs recalls, complaints, warranties, and reviews
                </p>
              </div>
              <div className="text-center px-4">
                <div className="w-14 h-14 md:w-16 md:h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl md:text-3xl">✅</span>
                </div>
                <h4 className="text-base md:text-lg font-semibold mb-2">Trust Score</h4>
                <p className="text-sm md:text-base text-gray-600">
                  Get an explainable trust score with evidence and recommendations
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA Section - Responsive */}
        <div className="bg-blue-600 text-white py-8 md:py-12">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h3 className="text-2xl md:text-3xl font-bold mb-4">
              For Businesses & Developers
            </h3>
            <p className="text-base md:text-lg mb-6 px-4">
              Integrate trust scores into your platform with our comprehensive API
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => router.push('/dashboard')}
                className="px-6 py-3 bg-white text-blue-600 rounded-lg hover:bg-gray-100 font-semibold transition-colors"
              >
                View B2B Dashboard
              </button>
              <button
                onClick={() => router.push('/api-docs')}
                className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-400 font-semibold transition-colors"
              >
                API Documentation
              </button>
            </div>
          </div>
        </div>

        {/* Footer - Responsive */}
        <footer className="bg-gray-800 text-white py-6 md:py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <p className="mb-3">© 2025 Trust as a Service. All rights reserved.</p>
              <div className="flex flex-wrap justify-center gap-4 text-sm">
                <a href="/privacy" className="hover:text-gray-300">Privacy Policy</a>
                <a href="/terms" className="hover:text-gray-300">Terms of Service</a>
                <a href="/api-docs" className="hover:text-gray-300">API Documentation</a>
                <a href="/contact" className="hover:text-gray-300">Contact Us</a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}