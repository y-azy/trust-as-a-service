import { useState, useEffect } from 'react'
import Head from 'next/head'
import axios from 'axios'
import { useRouter } from 'next/router'
import ScoreVisualization from '@/components/ScoreVisualization'

interface DashboardStats {
  totalProducts: number
  avgTrustScore: number
  topProducts: Array<{
    sku: string
    name: string
    score: number
    grade: string
  }>
  scoreDistribution: {
    A: number
    B: number
    C: number
    D: number
    F: number
  }
  recentAlerts: Array<{
    id: string
    type: 'recall' | 'complaint' | 'policy'
    product: string
    severity: 'high' | 'medium' | 'low'
    date: string
    message: string
  }>
  trendData: Array<{
    date: string
    avgScore: number
    productCount: number
  }>
}

export default function Dashboard() {
  const router = useRouter()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | '1y'>('30d')
  const [exportFormat, setExportFormat] = useState<'csv' | 'json' | 'pdf'>('csv')

  useEffect(() => {
    fetchDashboardStats()
  }, [dateRange])

  const fetchDashboardStats = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/api/dashboard/stats?range=${dateRange}`,
        {
          headers: {
            'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme'
          }
        }
      )
      setStats(response.data)
    } catch (err) {
      console.error('Failed to fetch dashboard stats:', err)
      setError('Failed to load dashboard statistics. Please try again later.')
      setStats(null)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/api/dashboard/export?format=${exportFormat}&range=${dateRange}`,
        {
          headers: {
            'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme'
          },
          responseType: exportFormat === 'json' ? 'json' : 'blob'
        }
      )

      // Create download link
      const url = window.URL.createObjectURL(
        new Blob([exportFormat === 'json' ? JSON.stringify(response.data, null, 2) : response.data])
      )
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `trust-scores-${dateRange}.${exportFormat}`)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (error) {
      console.error('Export failed:', error)
      alert('Export functionality will be available once backend endpoint is implemented')
    }
  }

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'recall':
        return '⚠️'
      case 'complaint':
        return '📢'
      case 'policy':
        return '📋'
      default:
        return '📌'
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'bg-red-100 text-red-700 border-red-200'
      case 'medium':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      case 'low':
        return 'bg-blue-100 text-blue-700 border-blue-200'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  return (
    <>
      <Head>
        <title>B2B Dashboard - Trust as a Service</title>
        <meta name="description" content="Business dashboard for trust score analytics" />
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
                  TaaS Dashboard
                </h1>
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                  Business
                </span>
              </div>
              <nav className="flex items-center space-x-4">
                <select
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as any)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                  <option value="90d">Last 90 Days</option>
                  <option value="1y">Last Year</option>
                </select>
                <button
                  onClick={() => router.push('/')}
                  className="px-4 py-2 text-gray-600 hover:text-gray-900"
                >
                  Back to Search
                </button>
              </nav>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          )}

          {/* Error State */}
          {!loading && error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
              <p className="text-red-700 mb-4">{error}</p>
              <button
                onClick={fetchDashboardStats}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Content - Only show if not loading and no error */}
          {!loading && !error && stats && (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Total Products</span>
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <p className="text-3xl font-bold text-gray-900">{stats?.totalProducts || 0}</p>
              <p className="text-sm text-green-600 mt-2">↑ 12% from last period</p>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Avg Trust Score</span>
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-3xl font-bold text-gray-900">{stats?.avgTrustScore || 0}</p>
              <p className="text-sm text-green-600 mt-2">↑ 3 points improvement</p>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">High Risk Products</span>
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-3xl font-bold text-gray-900">{stats?.scoreDistribution.F || 0}</p>
              <p className="text-sm text-red-600 mt-2">Requires attention</p>
            </div>

            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Recent Alerts</span>
                <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <p className="text-3xl font-bold text-gray-900">{stats?.recentAlerts.length || 0}</p>
              <p className="text-sm text-yellow-600 mt-2">New this week</p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Score Distribution */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Score Distribution</h2>
              <div className="space-y-4">
                {stats && Object.entries(stats.scoreDistribution).map(([grade, count]) => (
                  <div key={grade} className="flex items-center">
                    <span className={`w-12 text-center font-bold text-lg ${
                      grade === 'A' ? 'text-green-600' :
                      grade === 'B' ? 'text-lime-600' :
                      grade === 'C' ? 'text-yellow-600' :
                      grade === 'D' ? 'text-orange-600' : 'text-red-600'
                    }`}>
                      {grade}
                    </span>
                    <div className="flex-1 mx-4">
                      <div className="w-full bg-gray-200 rounded-full h-8">
                        <div
                          className={`h-8 rounded-full flex items-center justify-end pr-2 text-white text-sm font-medium ${
                            grade === 'A' ? 'bg-green-500' :
                            grade === 'B' ? 'bg-lime-500' :
                            grade === 'C' ? 'bg-yellow-500' :
                            grade === 'D' ? 'bg-orange-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${(count / stats.totalProducts) * 100}%` }}
                        >
                          {count}
                        </div>
                      </div>
                    </div>
                    <span className="text-sm text-gray-600 w-12 text-right">
                      {((count / stats.totalProducts) * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Products */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Top Rated Products</h2>
              <div className="space-y-3">
                {stats?.topProducts.map((product, idx) => (
                  <div
                    key={product.sku}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
                    onClick={() => router.push(`/product/${product.sku}`)}
                  >
                    <div className="flex items-center space-x-3">
                      <span className="text-2xl font-bold text-gray-400">#{idx + 1}</span>
                      <div>
                        <p className="font-semibold text-gray-900">{product.name}</p>
                        <p className="text-sm text-gray-500">{product.sku}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="text-lg font-bold text-gray-700">{product.score}</span>
                      <span className={`px-2 py-1 rounded font-bold ${
                        product.grade === 'A' ? 'bg-green-100 text-green-700' :
                        product.grade === 'B' ? 'bg-lime-100 text-lime-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {product.grade}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent Alerts */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-900">Recent Alerts & Updates</h2>
              <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                View All →
              </button>
            </div>
            <div className="space-y-3">
              {stats?.recentAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-start p-4 rounded-lg border ${getSeverityColor(alert.severity)}`}
                >
                  <span className="text-2xl mr-3">{getAlertIcon(alert.type)}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-semibold text-gray-900">{alert.product}</p>
                      <span className="text-xs text-gray-500">
                        {new Date(alert.date).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{alert.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Export Section */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Export Data</h2>
            <div className="flex items-center space-x-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Format
                </label>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as any)}
                  className="px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                  <option value="pdf">PDF Report</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  &nbsp;
                </label>
                <button
                  onClick={handleExport}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export Data
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              Export trust score data for the selected time period in your preferred format
            </p>
          </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}