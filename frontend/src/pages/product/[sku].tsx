import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import Head from 'next/head'
import axios from 'axios'
import ScoreBadge from '@/components/ScoreBadge'
import EvidenceList from '@/components/EvidenceList'
import CompareRibbon from '@/components/CompareRibbon'
import PlatformLinksTable from '@/components/PlatformLinksTable'
import ScoreVisualization from '@/components/ScoreVisualization'
import PolicySummary from '@/components/PolicySummary'

interface ProductTrust {
  sku: string
  name: string
  score: number
  grade: string
  confidence: number
  policyScore: number | null
  companyScore: number | null
  breakdown: any[]
  evidence: any[]
  platformLinks: any[]
  lastUpdated: string
}

export default function ProductPage() {
  const router = useRouter()
  const { sku } = router.query
  const [product, setProduct] = useState<ProductTrust | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sku && typeof sku === 'string') {
      fetchProductData(sku)
    }
  }, [sku])

  const fetchProductData = async (productSku: string) => {
    setLoading(true)
    setError(null)

    try {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/api/trust/product/${productSku}`,
        {
          headers: {
            'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme'
          }
        }
      )
      setProduct(response.data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to fetch product data')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading product data...</p>
        </div>
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Product Not Found</h2>
          <p className="text-gray-600 mb-4">{error || 'The requested product could not be found.'}</p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>{product.name} - Trust Score | TaaS</title>
        <meta name="description" content={`Trust score and analysis for ${product.name}`} />
      </Head>

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex justify-between items-center">
              <h1
                className="text-2xl font-bold text-gray-900 cursor-pointer"
                onClick={() => router.push('/')}
              >
                Trust as a Service
              </h1>
              <nav className="space-x-4">
                <button
                  onClick={() => router.push('/')}
                  className="text-gray-600 hover:text-gray-900"
                >
                  Search
                </button>
              </nav>
            </div>
          </div>
        </header>

        {/* Product Info */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white rounded-lg shadow-lg p-6">
            {/* Product Header */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">{product.name}</h1>
                <p className="text-gray-500 mb-4">SKU: {product.sku}</p>
                <p className="text-sm text-gray-600">
                  Last Updated: {new Date(product.lastUpdated).toLocaleDateString()}
                </p>
              </div>
              <div className="flex justify-end">
                <ScoreVisualization
                  score={product.score}
                  grade={product.grade}
                  breakdown={product.breakdown}
                  type="radial"
                  size="large"
                />
              </div>
            </div>

            {/* Sub-scores */}
            <div className="grid md:grid-cols-3 gap-4 mb-8">
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-600 mb-1">Product Score</h3>
                <p className="text-2xl font-bold text-gray-900">{product.score}/100</p>
              </div>
              {product.policyScore !== null && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-1">Policy Score</h3>
                  <p className="text-2xl font-bold text-gray-900">{Math.round(product.policyScore)}/100</p>
                </div>
              )}
              {product.companyScore !== null && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-1">Company Score</h3>
                  <p className="text-2xl font-bold text-gray-900">{Math.round(product.companyScore)}/100</p>
                </div>
              )}
            </div>

            {/* Score Breakdown */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Score Breakdown</h2>
              <div className="space-y-3">
                {product.breakdown.map((metric: any, index: number) => (
                  <div key={index} className="flex items-center">
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700">
                          {metric.metric.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                        <span className="text-sm text-gray-500">
                          {Math.round(metric.normalized)}/100 × {(metric.weight * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full"
                          style={{ width: `${metric.normalized}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Evidence */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Evidence</h2>
              <EvidenceList evidence={product.evidence} />
            </div>

            {/* Platform Links */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Where to Buy</h2>
              <PlatformLinksTable links={product.platformLinks} />
            </div>

            {/* Compare Alternatives */}
            <CompareRibbon sku={product.sku} />
          </div>
        </div>
      </div>
    </>
  )
}