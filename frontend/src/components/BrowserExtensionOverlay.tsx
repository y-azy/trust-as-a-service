import { useState, useEffect } from 'react'
import axios from 'axios'

interface BrowserExtensionOverlayProps {
  productIdentifier: string // SKU, ASIN, or product name
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
  mode?: 'compact' | 'expanded'
  onClose?: () => void
}

interface TrustData {
  sku: string
  name: string
  score: number
  grade: string
  confidence: number
  policyScore: number | null
  companyScore: number | null
  alternatives?: Array<{
    sku: string
    name: string
    score: number
    grade: string
  }>
}

export default function BrowserExtensionOverlay({
  productIdentifier,
  position = 'top-right',
  mode: initialMode = 'compact',
  onClose
}: BrowserExtensionOverlayProps) {
  const [trustData, setTrustData] = useState<TrustData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState(initialMode)
  const [showAlternatives, setShowAlternatives] = useState(false)

  useEffect(() => {
    fetchTrustData()
  }, [productIdentifier])

  const fetchTrustData = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/api/trust/product/${productIdentifier}`,
        {
          headers: {
            'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme'
          }
        }
      )
      setTrustData(response.data)
    } catch (err) {
      console.error('Failed to fetch trust data:', err)
      setError('Unable to fetch trust score')
      // Mock data for demonstration
      setTrustData({
        sku: productIdentifier,
        name: 'Product Name',
        score: 82,
        grade: 'B',
        confidence: 0.85,
        policyScore: 78,
        companyScore: 80,
        alternatives: [
          { sku: 'ALT-1', name: 'Better Alternative', score: 88, grade: 'A' },
          { sku: 'ALT-2', name: 'Budget Option', score: 75, grade: 'B' }
        ]
      })
    } finally {
      setLoading(false)
    }
  }

  const getPositionClasses = () => {
    const base = 'fixed z-[999999]'
    switch (position) {
      case 'top-left':
        return `${base} top-4 left-4`
      case 'bottom-left':
        return `${base} bottom-4 left-4`
      case 'bottom-right':
        return `${base} bottom-4 right-4`
      default: // top-right
        return `${base} top-4 right-4`
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 85) return '#10B981' // green
    if (score >= 70) return '#84CC16' // lime
    if (score >= 55) return '#EAB308' // yellow
    if (score >= 40) return '#F97316' // orange
    return '#EF4444' // red
  }

  const getGradeColor = (grade: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      A: { bg: '#DCFCE7', text: '#166534' },
      B: { bg: '#ECFCCB', text: '#3F6212' },
      C: { bg: '#FEF3C7', text: '#78350F' },
      D: { bg: '#FED7AA', text: '#7C2D12' },
      F: { bg: '#FEE2E2', text: '#991B1B' }
    }
    return colors[grade] || { bg: '#F3F4F6', text: '#1F2937' }
  }

  if (loading) {
    return (
      <div className={`${getPositionClasses()} bg-white rounded-lg shadow-2xl p-4`}>
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          <span className="text-sm text-gray-600">Loading trust score...</span>
        </div>
      </div>
    )
  }

  if (!trustData && error) {
    return (
      <div className={`${getPositionClasses()} bg-white rounded-lg shadow-2xl p-4`}>
        <div className="text-sm text-red-600">{error}</div>
      </div>
    )
  }

  if (!trustData) return null

  const gradeColors = getGradeColor(trustData.grade)

  // Compact Mode
  if (mode === 'compact') {
    return (
      <div
        className={`${getPositionClasses()} bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden transition-all duration-300 hover:scale-105 cursor-pointer`}
        onClick={() => setMode('expanded')}
        style={{ minWidth: '200px' }}
      >
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase">Trust Score</span>
            {onClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            )}
          </div>

          <div className="flex items-center space-x-3">
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg"
              style={{ backgroundColor: gradeColors.bg, color: gradeColors.text }}
            >
              {trustData.grade}
            </div>

            <div className="flex-1">
              <div className="text-2xl font-bold text-gray-900">{trustData.score}/100</div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                <div
                  className="h-2 rounded-full transition-all duration-500"
                  style={{
                    width: `${trustData.score}%`,
                    backgroundColor: getScoreColor(trustData.score)
                  }}
                />
              </div>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              Confidence: {Math.round(trustData.confidence * 100)}%
            </span>
            <span className="text-xs text-blue-600 font-medium">
              Click for details →
            </span>
          </div>
        </div>
      </div>
    )
  }

  // Expanded Mode
  return (
    <div
      className={`${getPositionClasses()} bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden transition-all duration-300`}
      style={{ width: '360px', maxHeight: '80vh', overflowY: 'auto' }}
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-lg">Trust Score Analysis</h3>
          <div className="flex space-x-2">
            <button
              onClick={() => setMode('compact')}
              className="text-white/80 hover:text-white"
              title="Minimize"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="text-white/80 hover:text-white"
                title="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-white/90">{trustData.name}</p>
      </div>

      {/* Main Score */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center font-bold text-2xl"
              style={{ backgroundColor: gradeColors.bg, color: gradeColors.text }}
            >
              {trustData.grade}
            </div>
            <div>
              <div className="text-3xl font-bold text-gray-900">{trustData.score}</div>
              <div className="text-sm text-gray-500">Trust Score</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500 mb-1">Confidence</div>
            <div className="text-sm font-semibold text-gray-700">
              {Math.round(trustData.confidence * 100)}%
            </div>
          </div>
        </div>

        <div className="mt-4 w-full bg-gray-200 rounded-full h-3">
          <div
            className="h-3 rounded-full transition-all duration-500"
            style={{
              width: `${trustData.score}%`,
              backgroundColor: getScoreColor(trustData.score)
            }}
          />
        </div>
      </div>

      {/* Sub-scores */}
      <div className="p-4 space-y-3 border-b">
        <h4 className="text-sm font-semibold text-gray-700 uppercase">Score Breakdown</h4>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Product Score</span>
            <span className="text-sm font-semibold text-gray-900">{trustData.score}/100</span>
          </div>

          {trustData.policyScore !== null && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Policy Score</span>
              <span className="text-sm font-semibold text-gray-900">
                {Math.round(trustData.policyScore)}/100
              </span>
            </div>
          )}

          {trustData.companyScore !== null && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Company Score</span>
              <span className="text-sm font-semibold text-gray-900">
                {Math.round(trustData.companyScore)}/100
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Alternatives Section */}
      {trustData.alternatives && trustData.alternatives.length > 0 && (
        <div className="p-4 border-b">
          <button
            onClick={() => setShowAlternatives(!showAlternatives)}
            className="w-full flex items-center justify-between text-sm font-semibold text-gray-700"
          >
            <span className="uppercase">Better Alternatives</span>
            <svg
              className={`w-4 h-4 transition-transform ${showAlternatives ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showAlternatives && (
            <div className="mt-3 space-y-2">
              {trustData.alternatives.map((alt) => (
                <div
                  key={alt.sku}
                  className="p-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{alt.name}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-bold text-gray-700">{alt.score}</span>
                      <span
                        className="px-2 py-0.5 rounded text-xs font-bold"
                        style={{
                          backgroundColor: getGradeColor(alt.grade).bg,
                          color: getGradeColor(alt.grade).text
                        }}
                      >
                        {alt.grade}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="p-4 bg-gray-50">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => window.open(`${process.env.NEXT_PUBLIC_APP_URL}/product/${trustData.sku}`, '_blank')}
            className="px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            View Full Report
          </button>
          <button
            onClick={() => window.open(`${process.env.NEXT_PUBLIC_APP_URL}/compare?skus=${trustData.sku}`, '_blank')}
            className="px-3 py-2 bg-gray-600 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            Compare
          </button>
        </div>

        <div className="mt-3 text-center">
          <a
            href={process.env.NEXT_PUBLIC_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Powered by Trust as a Service
          </a>
        </div>
      </div>
    </div>
  )
}