import { useState, useEffect } from 'react'

interface SearchFilterProps {
  onSearch: (query: string, filters: FilterOptions) => void
  placeholder?: string
  showAdvanced?: boolean
}

interface FilterOptions {
  minScore?: number
  maxScore?: number
  categories?: string[]
  brands?: string[]
  priceRange?: [number, number]
  warrantyMin?: number
  sortBy?: 'score' | 'price' | 'warranty' | 'name'
  sortOrder?: 'asc' | 'desc'
}

const CATEGORIES = [
  'Electronics',
  'Appliances',
  'Automotive',
  'Home & Garden',
  'Sports & Outdoors',
  'Fashion',
  'Health & Beauty',
  'Toys & Games',
  'Other'
]

const BRANDS = [
  'Apple',
  'Samsung',
  'Sony',
  'LG',
  'Honda',
  'Toyota',
  'Nike',
  'Adidas',
  'Bose',
  'Dell',
  'HP',
  'Microsoft',
  'Google',
  'Amazon',
  'Other'
]

export default function SearchFilter({
  onSearch,
  placeholder = 'Search products, brands, or categories...',
  showAdvanced = true
}: SearchFilterProps) {
  const [query, setQuery] = useState('')
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [filters, setFilters] = useState<FilterOptions>({
    minScore: 0,
    maxScore: 100,
    categories: [],
    brands: [],
    priceRange: [0, 10000],
    warrantyMin: 0,
    sortBy: 'score',
    sortOrder: 'desc'
  })

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault()
    onSearch(query, filters)
  }

  const handleFilterChange = (key: keyof FilterOptions, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const toggleCategory = (category: string) => {
    setFilters(prev => ({
      ...prev,
      categories: prev.categories?.includes(category)
        ? prev.categories.filter(c => c !== category)
        : [...(prev.categories || []), category]
    }))
  }

  const toggleBrand = (brand: string) => {
    setFilters(prev => ({
      ...prev,
      brands: prev.brands?.includes(brand)
        ? prev.brands.filter(b => b !== brand)
        : [...(prev.brands || []), brand]
    }))
  }

  const resetFilters = () => {
    setFilters({
      minScore: 0,
      maxScore: 100,
      categories: [],
      brands: [],
      priceRange: [0, 10000],
      warrantyMin: 0,
      sortBy: 'score',
      sortOrder: 'desc'
    })
    setQuery('')
  }

  const getScoreGradeLabel = (score: number) => {
    if (score >= 85) return 'A'
    if (score >= 70) return 'B'
    if (score >= 55) return 'C'
    if (score >= 40) return 'D'
    return 'F'
  }

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      {/* Main Search Bar */}
      <form onSubmit={handleSearch} className="mb-4">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full px-5 py-3 pr-32 text-gray-900 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center space-x-2">
            {showAdvanced && (
              <button
                type="button"
                onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                className={`p-2 rounded-lg transition-colors ${
                  isAdvancedOpen
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                title="Advanced Filters"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </button>
            )}
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Search
            </button>
          </div>
        </div>
      </form>

      {/* Advanced Filters */}
      {showAdvanced && isAdvancedOpen && (
        <div className="border-t pt-4 space-y-4">
          {/* Score Range */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">
              Trust Score Range
            </label>
            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={filters.minScore}
                  onChange={(e) => handleFilterChange('minScore', parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Min: {filters.minScore} ({getScoreGradeLabel(filters.minScore || 0)})</span>
                </div>
              </div>
              <span className="text-gray-400">to</span>
              <div className="flex-1">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={filters.maxScore}
                  onChange={(e) => handleFilterChange('maxScore', parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Max: {filters.maxScore} ({getScoreGradeLabel(filters.maxScore || 100)})</span>
                </div>
              </div>
            </div>
          </div>

          {/* Categories */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">
              Categories
            </label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(category => (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    filters.categories?.includes(category)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          {/* Brands */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">
              Brands
            </label>
            <div className="flex flex-wrap gap-2">
              {BRANDS.map(brand => (
                <button
                  key={brand}
                  type="button"
                  onClick={() => toggleBrand(brand)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    filters.brands?.includes(brand)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {brand}
                </button>
              ))}
            </div>
          </div>

          {/* Price Range */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">
              Price Range
            </label>
            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <input
                  type="number"
                  placeholder="Min"
                  value={filters.priceRange?.[0] || ''}
                  onChange={(e) =>
                    handleFilterChange('priceRange', [
                      parseInt(e.target.value) || 0,
                      filters.priceRange?.[1] || 10000
                    ])
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <span className="text-gray-400">-</span>
              <div className="flex-1">
                <input
                  type="number"
                  placeholder="Max"
                  value={filters.priceRange?.[1] || ''}
                  onChange={(e) =>
                    handleFilterChange('priceRange', [
                      filters.priceRange?.[0] || 0,
                      parseInt(e.target.value) || 10000
                    ])
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Warranty Minimum */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">
              Minimum Warranty (months)
            </label>
            <input
              type="number"
              min="0"
              value={filters.warrantyMin}
              onChange={(e) => handleFilterChange('warrantyMin', parseInt(e.target.value) || 0)}
              className="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Sort Options */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-gray-700 mb-2 block">
                Sort By
              </label>
              <select
                value={filters.sortBy}
                onChange={(e) => handleFilterChange('sortBy', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="score">Trust Score</option>
                <option value="price">Price</option>
                <option value="warranty">Warranty</option>
                <option value="name">Name</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-gray-700 mb-2 block">
                Order
              </label>
              <select
                value={filters.sortOrder}
                onChange={(e) => handleFilterChange('sortOrder', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="desc">High to Low</option>
                <option value="asc">Low to High</option>
              </select>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between pt-4 border-t">
            <button
              type="button"
              onClick={resetFilters}
              className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            >
              Reset Filters
            </button>
            <button
              type="button"
              onClick={handleSearch}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Apply Filters
            </button>
          </div>
        </div>
      )}

      {/* Active Filters Display */}
      {(filters.categories?.length || filters.brands?.length ||
        filters.minScore! > 0 || filters.maxScore! < 100) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-600">Active filters:</span>

          {filters.minScore! > 0 && (
            <span className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
              Min Score: {filters.minScore}
              <button
                onClick={() => handleFilterChange('minScore', 0)}
                className="ml-2 hover:text-blue-900"
              >
                ×
              </button>
            </span>
          )}

          {filters.maxScore! < 100 && (
            <span className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
              Max Score: {filters.maxScore}
              <button
                onClick={() => handleFilterChange('maxScore', 100)}
                className="ml-2 hover:text-blue-900"
              >
                ×
              </button>
            </span>
          )}

          {filters.categories?.map(category => (
            <span key={category} className="inline-flex items-center px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">
              {category}
              <button
                onClick={() => toggleCategory(category)}
                className="ml-2 hover:text-green-900"
              >
                ×
              </button>
            </span>
          ))}

          {filters.brands?.map(brand => (
            <span key={brand} className="inline-flex items-center px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm">
              {brand}
              <button
                onClick={() => toggleBrand(brand)}
                className="ml-2 hover:text-purple-900"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}