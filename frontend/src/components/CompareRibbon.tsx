import { useState, useEffect } from 'react'
import axios from 'axios'

interface CompareRibbonProps {
  sku: string
}

interface Recommendation {
  sku: string
  name: string
  score: number
  grade: string
  price: number
  effectivePrice: number
  warrantyMonths: number
  utility: number
  reasons: string[]
  buyLink: string
}

export default function CompareRibbon({ sku }: CompareRibbonProps) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [mode, setMode] = useState<'trustFirst' | 'priceFirst' | 'effectivePrice'>('trustFirst')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchRecommendations()
  }, [sku, mode])

  const fetchRecommendations = async () => {
    setLoading(true)
    try {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/api/recommendations/${sku}?mode=${mode}`,
        {
          headers: {
            'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme'
          }
        }
      )
      setRecommendations(response.data.recommendations || [])
    } catch (error) {
      console.error('Failed to fetch recommendations:', error)
      setRecommendations([])
    } finally {
      setLoading(false)
    }
  }

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A': return 'text-green-600'
      case 'B': return 'text-lime-600'
      case 'C': return 'text-yellow-600'
      case 'D': return 'text-orange-600'
      case 'F': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-900">Compare Alternatives</h2>
        <div className="flex space-x-2">
          <button
            onClick={() => setMode('trustFirst')}
            className={`px-3 py-1 rounded ${
              mode === 'trustFirst'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700'
            }`}
          >
            Trust First
          </button>
          <button
            onClick={() => setMode('priceFirst')}
            className={`px-3 py-1 rounded ${
              mode === 'priceFirst'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700'
            }`}
          >
            Price First
          </button>
          <button
            onClick={() => setMode('effectivePrice')}
            className={`px-3 py-1 rounded ${
              mode === 'effectivePrice'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700'
            }`}
          >
            Effective Price
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      ) : recommendations.length === 0 ? (
        <p className="text-center text-gray-500 py-8">No alternatives found</p>
      ) : (
        <div className="space-y-4">
          {recommendations.map((rec) => (
            <div key={rec.sku} className="bg-white rounded-lg p-4 shadow">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <h3 className="font-semibold text-gray-900">{rec.name}</h3>
                    <span className={`font-bold ${getGradeColor(rec.grade)}`}>
                      Grade {rec.grade}
                    </span>
                  </div>
                  <div className="flex space-x-4 text-sm text-gray-600 mb-2">
                    <span>Score: {rec.score}/100</span>
                    <span>Price: ${rec.price.toFixed(0)}</span>
                    <span>Effective: ${rec.effectivePrice.toFixed(0)}</span>
                    <span>Warranty: {rec.warrantyMonths} months</span>
                  </div>
                  <div className="text-sm text-gray-500">
                    {rec.reasons.map((reason, i) => (
                      <span key={i}>
                        • {reason}
                        {i < rec.reasons.length - 1 && ' '}
                      </span>
                    ))}
                  </div>
                </div>
                <a
                  href={rec.buyLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  View →
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}