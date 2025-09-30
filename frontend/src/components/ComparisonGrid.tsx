import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import axios from 'axios'
import ScoreVisualization from './ScoreVisualization'

interface Product {
  sku: string
  name: string
  brand?: string
  score: number
  grade: string
  policyScore?: number | null
  companyScore?: number | null
  price?: number
  effectivePrice?: number
  warrantyMonths?: number
  pros?: string[]
  cons?: string[]
  features?: Record<string, any>
  imageUrl?: string
}

interface ComparisonGridProps {
  products?: Product[]
  skus?: string[]
  highlightBest?: boolean
}

export default function ComparisonGrid({
  products: initialProducts,
  skus,
  highlightBest = true
}: ComparisonGridProps) {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>(initialProducts || [])
  const [loading, setLoading] = useState(false)
  const [compareMode, setCompareMode] = useState<'overview' | 'detailed'>('overview')

  useEffect(() => {
    if (skus && skus.length > 0 && !initialProducts) {
      fetchProducts(skus)
    }
  }, [skus])

  const fetchProducts = async (productSkus: string[]) => {
    setLoading(true)
    try {
      const promises = productSkus.map(sku =>
        axios.get(
          `${process.env.NEXT_PUBLIC_API_URL}/api/trust/product/${sku}`,
          {
            headers: {
              'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme'
            }
          }
        )
      )
      const responses = await Promise.all(promises)
      setProducts(responses.map(r => r.data))
    } catch (error) {
      console.error('Failed to fetch products:', error)
    } finally {
      setLoading(false)
    }
  }

  const getBestValue = (field: keyof Product, higherIsBetter = true) => {
    const values = products
      .map(p => p[field])
      .filter(v => v !== null && v !== undefined) as number[]

    if (values.length === 0) return null
    return higherIsBetter ? Math.max(...values) : Math.min(...values)
  }

  const isFieldBest = (value: any, field: keyof Product, higherIsBetter = true) => {
    if (!highlightBest) return false
    const bestValue = getBestValue(field, higherIsBetter)
    return value === bestValue
  }

  const getScoreColor = (score: number) => {
    if (score >= 85) return 'text-green-600'
    if (score >= 70) return 'text-lime-600'
    if (score >= 55) return 'text-yellow-600'
    if (score >= 40) return 'text-orange-600'
    return 'text-red-600'
  }

  const getGradeColors = (grade: string) => {
    const colors: Record<string, string> = {
      A: 'bg-green-100 text-green-800 border-green-300',
      B: 'bg-lime-100 text-lime-800 border-lime-300',
      C: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      D: 'bg-orange-100 text-orange-800 border-orange-300',
      F: 'bg-red-100 text-red-800 border-red-300',
    }
    return colors[grade] || 'bg-gray-100 text-gray-800 border-gray-300'
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">No products to compare</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* View Mode Toggle */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Product Comparison</h2>
        <div className="flex space-x-2">
          <button
            onClick={() => setCompareMode('overview')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              compareMode === 'overview'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setCompareMode('detailed')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              compareMode === 'detailed'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Detailed
          </button>
        </div>
      </div>

      {/* Comparison Grid */}
      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-lg shadow-lg overflow-hidden">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">
                Feature
              </th>
              {products.map((product) => (
                <th key={product.sku} className="px-6 py-4 text-center min-w-[200px]">
                  <div className="space-y-2">
                    {product.imageUrl && (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="w-20 h-20 object-contain mx-auto"
                      />
                    )}
                    <div
                      className="font-semibold text-gray-900 cursor-pointer hover:text-blue-600"
                      onClick={() => router.push(`/product/${product.sku}`)}
                    >
                      {product.name}
                    </div>
                    {product.brand && (
                      <div className="text-xs text-gray-500">{product.brand}</div>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {/* Trust Score Row */}
            <tr className="hover:bg-gray-50">
              <td className="px-6 py-4 font-medium text-gray-700">Trust Score</td>
              {products.map((product) => (
                <td key={product.sku} className="px-6 py-4 text-center">
                  <div className="flex flex-col items-center space-y-2">
                    <span className={`inline-flex px-3 py-1 rounded-lg border font-bold text-lg ${getGradeColors(product.grade)}`}>
                      {product.grade}
                    </span>
                    <span
                      className={`text-2xl font-bold ${
                        isFieldBest(product.score, 'score')
                          ? 'text-green-600'
                          : getScoreColor(product.score)
                      }`}
                    >
                      {product.score}
                      {isFieldBest(product.score, 'score') && (
                        <span className="ml-1 text-xs text-green-500">★</span>
                      )}
                    </span>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-500 ${
                          product.score >= 85 ? 'bg-green-500' :
                          product.score >= 70 ? 'bg-lime-500' :
                          product.score >= 55 ? 'bg-yellow-500' :
                          product.score >= 40 ? 'bg-orange-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${product.score}%` }}
                      />
                    </div>
                  </div>
                </td>
              ))}
            </tr>

            {/* Policy Score Row */}
            <tr className="hover:bg-gray-50">
              <td className="px-6 py-4 font-medium text-gray-700">Policy Score</td>
              {products.map((product) => (
                <td key={product.sku} className="px-6 py-4 text-center">
                  {product.policyScore ? (
                    <span className={`text-lg font-semibold ${
                      isFieldBest(product.policyScore, 'policyScore')
                        ? 'text-green-600'
                        : 'text-gray-700'
                    }`}>
                      {Math.round(product.policyScore)}
                      {isFieldBest(product.policyScore, 'policyScore') && (
                        <span className="ml-1 text-xs text-green-500">★</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-400">N/A</span>
                  )}
                </td>
              ))}
            </tr>

            {/* Company Score Row */}
            <tr className="hover:bg-gray-50">
              <td className="px-6 py-4 font-medium text-gray-700">Company Score</td>
              {products.map((product) => (
                <td key={product.sku} className="px-6 py-4 text-center">
                  {product.companyScore ? (
                    <span className={`text-lg font-semibold ${
                      isFieldBest(product.companyScore, 'companyScore')
                        ? 'text-green-600'
                        : 'text-gray-700'
                    }`}>
                      {Math.round(product.companyScore)}
                      {isFieldBest(product.companyScore, 'companyScore') && (
                        <span className="ml-1 text-xs text-green-500">★</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-400">N/A</span>
                  )}
                </td>
              ))}
            </tr>

            {/* Price Row */}
            <tr className="hover:bg-gray-50">
              <td className="px-6 py-4 font-medium text-gray-700">Price</td>
              {products.map((product) => (
                <td key={product.sku} className="px-6 py-4 text-center">
                  {product.price ? (
                    <span className={`text-lg font-semibold ${
                      isFieldBest(product.price, 'price', false)
                        ? 'text-green-600'
                        : 'text-gray-700'
                    }`}>
                      ${product.price.toFixed(0)}
                      {isFieldBest(product.price, 'price', false) && (
                        <span className="ml-1 text-xs text-green-500">★</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-400">N/A</span>
                  )}
                </td>
              ))}
            </tr>

            {/* Warranty Row */}
            <tr className="hover:bg-gray-50">
              <td className="px-6 py-4 font-medium text-gray-700">Warranty</td>
              {products.map((product) => (
                <td key={product.sku} className="px-6 py-4 text-center">
                  {product.warrantyMonths ? (
                    <span className={`text-lg ${
                      isFieldBest(product.warrantyMonths, 'warrantyMonths')
                        ? 'text-green-600 font-semibold'
                        : 'text-gray-700'
                    }`}>
                      {product.warrantyMonths} months
                      {isFieldBest(product.warrantyMonths, 'warrantyMonths') && (
                        <span className="ml-1 text-xs text-green-500">★</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-400">N/A</span>
                  )}
                </td>
              ))}
            </tr>

            {/* Effective Price Row */}
            {products.some(p => p.effectivePrice) && (
              <tr className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-700">
                  <div className="flex items-center">
                    Effective Price
                    <span className="ml-2 text-xs text-gray-500">(Price/Warranty)</span>
                  </div>
                </td>
                {products.map((product) => (
                  <td key={product.sku} className="px-6 py-4 text-center">
                    {product.effectivePrice ? (
                      <span className={`text-lg ${
                        isFieldBest(product.effectivePrice, 'effectivePrice', false)
                          ? 'text-green-600 font-semibold'
                          : 'text-gray-700'
                      }`}>
                        ${product.effectivePrice.toFixed(0)}/mo
                        {isFieldBest(product.effectivePrice, 'effectivePrice', false) && (
                          <span className="ml-1 text-xs text-green-500">★</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-400">N/A</span>
                    )}
                  </td>
                ))}
              </tr>
            )}

            {/* Detailed mode additional rows */}
            {compareMode === 'detailed' && (
              <>
                {/* Pros */}
                <tr className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-700 align-top">Pros</td>
                  {products.map((product) => (
                    <td key={product.sku} className="px-6 py-4">
                      {product.pros && product.pros.length > 0 ? (
                        <ul className="space-y-1">
                          {product.pros.map((pro, idx) => (
                            <li key={idx} className="flex items-start">
                              <span className="text-green-500 mr-2">✓</span>
                              <span className="text-sm text-gray-600">{pro}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-gray-400">N/A</span>
                      )}
                    </td>
                  ))}
                </tr>

                {/* Cons */}
                <tr className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-700 align-top">Cons</td>
                  {products.map((product) => (
                    <td key={product.sku} className="px-6 py-4">
                      {product.cons && product.cons.length > 0 ? (
                        <ul className="space-y-1">
                          {product.cons.map((con, idx) => (
                            <li key={idx} className="flex items-start">
                              <span className="text-red-500 mr-2">✗</span>
                              <span className="text-sm text-gray-600">{con}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-gray-400">N/A</span>
                      )}
                    </td>
                  ))}
                </tr>
              </>
            )}

            {/* Action Row */}
            <tr className="bg-gray-50">
              <td className="px-6 py-4"></td>
              {products.map((product) => (
                <td key={product.sku} className="px-6 py-4 text-center">
                  <button
                    onClick={() => router.push(`/product/${product.sku}`)}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    View Details
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Legend */}
      {highlightBest && (
        <div className="flex justify-center mt-4">
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <span className="text-green-500">★</span>
            <span>Best in category</span>
          </div>
        </div>
      )}
    </div>
  )
}