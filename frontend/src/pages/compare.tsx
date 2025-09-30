import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import axios from 'axios'
import ComparisonGrid from '@/components/ComparisonGrid'
import ProductCard from '@/components/ProductCard'
import SearchFilter from '@/components/SearchFilter'

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

export default function ComparePage() {
  const router = useRouter()
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [availableProducts, setAvailableProducts] = useState<Product[]>([])
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [compareMode, setCompareMode] = useState<'select' | 'comparing'>('select')

  useEffect(() => {
    // Check if SKUs passed via query params
    if (router.query.skus) {
      const skus = Array.isArray(router.query.skus)
        ? router.query.skus
        : router.query.skus.split(',')
      setSelectedProducts(skus)
      setCompareMode('comparing')
    } else {
      fetchPopularProducts()
    }
  }, [router.query])

  const fetchPopularProducts = async () => {
    setLoading(true)
    try {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/api/products/popular`,
        {
          headers: {
            'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme'
          }
        }
      )
      setAvailableProducts(response.data)
      setSearchResults(response.data)
    } catch (error) {
      console.error('Failed to fetch products:', error)
      // Use mock data for demonstration
      const mockProducts: Product[] = [
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
        },
        {
          sku: 'SONY-WH1000XM5',
          name: 'Sony WH-1000XM5',
          brand: 'Sony',
          score: 86,
          grade: 'A',
          policyScore: 84,
          companyScore: 85,
          price: 399,
          warrantyMonths: 12
        },
        {
          sku: 'LG-OLED-C3',
          name: 'LG OLED C3 TV',
          brand: 'LG',
          score: 84,
          grade: 'B',
          policyScore: 82,
          companyScore: 83,
          price: 1499,
          warrantyMonths: 12
        }
      ]
      setAvailableProducts(mockProducts)
      setSearchResults(mockProducts)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (query: string, filters: any) => {
    let filtered = [...availableProducts]

    // Apply search query
    if (query) {
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.brand?.toLowerCase().includes(query.toLowerCase()) ||
        p.sku.toLowerCase().includes(query.toLowerCase())
      )
    }

    // Apply score filters
    if (filters.minScore) {
      filtered = filtered.filter(p => p.score >= filters.minScore)
    }
    if (filters.maxScore) {
      filtered = filtered.filter(p => p.score <= filters.maxScore)
    }

    // Apply sorting
    if (filters.sortBy) {
      filtered.sort((a, b) => {
        const order = filters.sortOrder === 'asc' ? 1 : -1
        switch (filters.sortBy) {
          case 'score':
            return (b.score - a.score) * order
          case 'price':
            return ((a.price || 0) - (b.price || 0)) * order
          case 'warranty':
            return ((b.warrantyMonths || 0) - (a.warrantyMonths || 0)) * order
          default:
            return a.name.localeCompare(b.name) * order
        }
      })
    }

    setSearchResults(filtered)
  }

  const toggleProduct = (sku: string) => {
    setSelectedProducts(prev =>
      prev.includes(sku)
        ? prev.filter(s => s !== sku)
        : [...prev, sku]
    )
  }

  const startComparison = () => {
    if (selectedProducts.length >= 2) {
      setCompareMode('comparing')
      // Update URL with selected SKUs
      router.push({
        pathname: '/compare',
        query: { skus: selectedProducts.join(',') }
      }, undefined, { shallow: true })
    }
  }

  const resetComparison = () => {
    setSelectedProducts([])
    setCompareMode('select')
    router.push('/compare', undefined, { shallow: true })
  }

  return (
    <>
      <Head>
        <title>Compare Products - Trust as a Service</title>
        <meta name="description" content="Compare trust scores and features of multiple products" />
      </Head>

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <div className="flex items-center space-x-4">
                <h1
                  className="text-2xl font-bold text-gray-900 cursor-pointer"
                  onClick={() => router.push('/')}
                >
                  Trust as a Service
                </h1>
                <span className="text-gray-400">/</span>
                <span className="text-lg font-medium text-gray-700">Compare Products</span>
              </div>
              <nav className="flex items-center space-x-4">
                <button
                  onClick={() => router.push('/dashboard')}
                  className="px-4 py-2 text-gray-600 hover:text-gray-900"
                >
                  Dashboard
                </button>
                <button
                  onClick={() => router.push('/')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  New Search
                </button>
              </nav>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {compareMode === 'select' ? (
            <>
              {/* Selection Mode */}
              <div className="mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-2">
                  Select Products to Compare
                </h2>
                <p className="text-gray-600">
                  Choose 2-5 products to see a detailed side-by-side comparison
                </p>
              </div>

              {/* Selected Products Bar */}
              {selectedProducts.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-blue-900 mb-2">
                        Selected Products ({selectedProducts.length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedProducts.map(sku => {
                          const product = availableProducts.find(p => p.sku === sku)
                          return product ? (
                            <span
                              key={sku}
                              className="inline-flex items-center px-3 py-1 bg-white text-blue-700 rounded-full text-sm border border-blue-300"
                            >
                              {product.name}
                              <button
                                onClick={() => toggleProduct(sku)}
                                className="ml-2 text-blue-500 hover:text-blue-700"
                              >
                                ×
                              </button>
                            </span>
                          ) : null
                        })}
                      </div>
                    </div>
                    <button
                      onClick={startComparison}
                      disabled={selectedProducts.length < 2}
                      className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                        selectedProducts.length >= 2
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      Compare ({selectedProducts.length}/5)
                    </button>
                  </div>
                </div>
              )}

              {/* Search and Filter */}
              <div className="mb-8">
                <SearchFilter onSearch={handleSearch} />
              </div>

              {/* Product Grid */}
              {loading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {searchResults.map(product => (
                    <div key={product.sku} className="relative">
                      {/* Selection Checkbox */}
                      <div className="absolute top-4 right-4 z-10">
                        <input
                          type="checkbox"
                          checked={selectedProducts.includes(product.sku)}
                          onChange={() => toggleProduct(product.sku)}
                          disabled={!selectedProducts.includes(product.sku) && selectedProducts.length >= 5}
                          className="w-6 h-6 text-blue-600 rounded focus:ring-blue-500"
                        />
                      </div>
                      <ProductCard {...product} />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Comparison Mode */}
              <div className="mb-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-3xl font-bold text-gray-900">
                    Product Comparison
                  </h2>
                  <div className="flex space-x-3">
                    <button
                      onClick={() => setCompareMode('select')}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                      ← Add More
                    </button>
                    <button
                      onClick={resetComparison}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      New Comparison
                    </button>
                  </div>
                </div>
              </div>

              {/* Comparison Grid */}
              <ComparisonGrid skus={selectedProducts} highlightBest={true} />

              {/* Quick Actions */}
              <div className="mt-8 bg-gray-100 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Next Steps
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    onClick={() => window.print()}
                    className="flex items-center justify-center px-4 py-3 bg-white rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Print Comparison
                  </button>
                  <button
                    onClick={() => {
                      const url = window.location.href
                      navigator.clipboard.writeText(url)
                      alert('Comparison link copied!')
                    }}
                    className="flex items-center justify-center px-4 py-3 bg-white rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m9.032 4.026a9.001 9.001 0 01-7.432 0m9.032-4.026A9.001 9.001 0 0112 3c-4.474 0-8.268 3.12-9.032 7.326m0 0A9.001 9.001 0 0012 21c4.474 0 8.268-3.12 9.032-7.326" />
                    </svg>
                    Share Comparison
                  </button>
                  <button
                    onClick={() => alert('Export feature coming soon!')}
                    className="flex items-center justify-center px-4 py-3 bg-white rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Export as PDF
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}