import { useRouter } from 'next/router'

interface ProductCardProps {
  sku: string
  name: string
  brand?: string
  category?: string
  score: number
  grade: string
  policyScore?: number | null
  companyScore?: number | null
  price?: number
  imageUrl?: string
  confidence?: number
  warrantyMonths?: number
  buyLinks?: Array<{
    platform: string
    url: string
    price: number
  }>
}

export default function ProductCard({
  sku,
  name,
  brand,
  category,
  score,
  grade,
  policyScore,
  companyScore,
  price,
  imageUrl,
  confidence = 0.8,
  warrantyMonths,
  buyLinks
}: ProductCardProps) {
  const router = useRouter()

  const getScoreColor = (score: number) => {
    if (score >= 85) return 'from-green-500 to-green-600'
    if (score >= 70) return 'from-lime-500 to-lime-600'
    if (score >= 55) return 'from-yellow-500 to-yellow-600'
    if (score >= 40) return 'from-orange-500 to-orange-600'
    return 'from-red-500 to-red-600'
  }

  const getGradeBadgeColor = (grade: string) => {
    const colors: Record<string, string> = {
      A: 'bg-green-100 text-green-800 border-green-300',
      B: 'bg-lime-100 text-lime-800 border-lime-300',
      C: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      D: 'bg-orange-100 text-orange-800 border-orange-300',
      F: 'bg-red-100 text-red-800 border-red-300',
    }
    return colors[grade] || 'bg-gray-100 text-gray-800 border-gray-300'
  }

  const handleCardClick = () => {
    router.push(`/product/${encodeURIComponent(sku)}`)
  }

  const handleBuyClick = (e: React.MouseEvent, url: string) => {
    e.stopPropagation()
    window.open(url, '_blank')
  }

  return (
    <div
      className="group relative bg-white rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 cursor-pointer overflow-hidden"
      onClick={handleCardClick}
    >
      {/* Score gradient band */}
      <div className={`h-2 bg-gradient-to-r ${getScoreColor(score)}`} />

      <div className="p-6">
        {/* Header with badge */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            {brand && (
              <p className="text-sm text-gray-500 font-medium mb-1">{brand}</p>
            )}
            <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-2">
              {name}
            </h3>
            {category && (
              <span className="inline-block mt-2 px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
                {category}
              </span>
            )}
          </div>
          <div className={`ml-3 px-3 py-1 rounded-lg border font-bold text-lg ${getGradeBadgeColor(grade)}`}>
            {grade}
          </div>
        </div>

        {/* Product image (if available) */}
        {imageUrl && (
          <div className="mb-4 h-48 bg-gray-50 rounded-lg overflow-hidden">
            <img
              src={imageUrl}
              alt={name}
              className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
            />
          </div>
        )}

        {/* Main Trust Score */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">Trust Score</span>
            <span className="text-2xl font-bold text-gray-900">{score}/100</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full bg-gradient-to-r ${getScoreColor(score)} transition-all duration-500`}
              style={{ width: `${score}%` }}
            />
          </div>
          {confidence && (
            <p className="text-xs text-gray-500 mt-1">
              Confidence: {Math.round(confidence * 100)}%
            </p>
          )}
        </div>

        {/* Sub-scores Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {policyScore !== null && policyScore !== undefined && (
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="text-xs text-gray-600">Policy</p>
              <p className="text-sm font-bold text-gray-900">{Math.round(policyScore)}/100</p>
            </div>
          )}
          {companyScore !== null && companyScore !== undefined && (
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="text-xs text-gray-600">Company</p>
              <p className="text-sm font-bold text-gray-900">{Math.round(companyScore)}/100</p>
            </div>
          )}
          {warrantyMonths && (
            <div className="bg-blue-50 rounded-lg p-2">
              <p className="text-xs text-blue-600">Warranty</p>
              <p className="text-sm font-bold text-blue-900">{warrantyMonths} mo</p>
            </div>
          )}
          {price && (
            <div className="bg-green-50 rounded-lg p-2">
              <p className="text-xs text-green-600">Price</p>
              <p className="text-sm font-bold text-green-900">${price.toFixed(0)}</p>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex gap-2">
          <button
            onClick={handleCardClick}
            className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            View Details
          </button>
          {buyLinks && buyLinks.length > 0 && (
            <button
              onClick={(e) => handleBuyClick(e, buyLinks[0].url)}
              className="px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              Buy Now
            </button>
          )}
        </div>

        {/* Hover effect overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-blue-600/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      </div>
    </div>
  )
}