import { useState, useEffect } from 'react'
import axios from 'axios'

interface PolicySummaryProps {
  productSku: string
  policyUrl?: string
  warranty?: {
    months: number
    transferable: boolean
    coverage: string[]
    exclusions: string[]
    confidence: number
  }
  termsAndConditions?: {
    summary: string
    keyPoints: string[]
    importantClauses: string[]
  }
}

export default function PolicySummary({
  productSku,
  policyUrl,
  warranty,
  termsAndConditions
}: PolicySummaryProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)

  const toggleSection = (section: string) => {
    setExpanded(expanded === section ? null : section)
  }

  const generateAISummary = async () => {
    if (aiSummary || !policyUrl) return

    setLoadingSummary(true)
    try {
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/api/policy/summarize`,
        {
          url: policyUrl,
          sku: productSku
        },
        {
          headers: {
            'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme'
          }
        }
      )
      setAiSummary(response.data.summary)
    } catch (error) {
      console.error('Failed to generate AI summary:', error)
      setAiSummary('Unable to generate summary at this time.')
    } finally {
      setLoadingSummary(false)
    }
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600 bg-green-50'
    if (confidence >= 0.6) return 'text-yellow-600 bg-yellow-50'
    return 'text-orange-600 bg-orange-50'
  }

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 space-y-4">
      <h2 className="text-xl font-bold text-gray-900 flex items-center">
        <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Policies & Warranties
      </h2>

      {/* Warranty Section */}
      {warranty && (
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('warranty')}
            className="w-full px-4 py-3 bg-gradient-to-r from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-150 transition-colors flex justify-between items-center"
          >
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
              <span className="font-semibold text-gray-800">Warranty Information</span>
            </div>
            <div className="flex items-center space-x-3">
              <span className="text-sm font-medium text-blue-700">
                {warranty.months} months
              </span>
              {warranty.transferable && (
                <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                  Transferable
                </span>
              )}
              <svg
                className={`w-5 h-5 text-gray-400 transform transition-transform ${
                  expanded === 'warranty' ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {expanded === 'warranty' && (
            <div className="p-4 bg-gray-50">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium text-gray-600">Duration:</span>
                  <span className="text-sm text-gray-900 font-semibold">{warranty.months} months</span>
                </div>

                <div className="flex items-start justify-between">
                  <span className="text-sm font-medium text-gray-600">Transferable:</span>
                  <span className="text-sm text-gray-900">{warranty.transferable ? 'Yes' : 'No'}</span>
                </div>

                {warranty.coverage && warranty.coverage.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-2">Coverage:</p>
                    <ul className="space-y-1">
                      {warranty.coverage.map((item, idx) => (
                        <li key={idx} className="flex items-start">
                          <svg className="w-4 h-4 mr-2 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          <span className="text-sm text-gray-700">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {warranty.exclusions && warranty.exclusions.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-2">Exclusions:</p>
                    <ul className="space-y-1">
                      {warranty.exclusions.map((item, idx) => (
                        <li key={idx} className="flex items-start">
                          <svg className="w-4 h-4 mr-2 text-red-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                          <span className="text-sm text-gray-700">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3 pt-3 border-t">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getConfidenceColor(warranty.confidence)}`}>
                    Data confidence: {Math.round(warranty.confidence * 100)}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Terms & Conditions Section */}
      {termsAndConditions && (
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection('terms')}
            className="w-full px-4 py-3 bg-gradient-to-r from-purple-50 to-purple-100 hover:from-purple-100 hover:to-purple-150 transition-colors flex justify-between items-center"
          >
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="font-semibold text-gray-800">Terms & Conditions</span>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transform transition-transform ${
                expanded === 'terms' ? 'rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expanded === 'terms' && (
            <div className="p-4 bg-gray-50">
              {termsAndConditions.summary && (
                <div className="mb-4">
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {termsAndConditions.summary}
                  </p>
                </div>
              )}

              {termsAndConditions.keyPoints && termsAndConditions.keyPoints.length > 0 && (
                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-600 mb-2">Key Points:</p>
                  <ul className="space-y-2">
                    {termsAndConditions.keyPoints.map((point, idx) => (
                      <li key={idx} className="flex items-start">
                        <span className="text-blue-500 mr-2">•</span>
                        <span className="text-sm text-gray-700">{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {termsAndConditions.importantClauses && termsAndConditions.importantClauses.length > 0 && (
                <div className="p-3 bg-yellow-50 rounded-lg">
                  <p className="text-sm font-medium text-yellow-800 mb-2 flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    Important Clauses
                  </p>
                  <ul className="space-y-1">
                    {termsAndConditions.importantClauses.map((clause, idx) => (
                      <li key={idx} className="text-sm text-yellow-700">• {clause}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* AI Summary Section */}
      {policyUrl && (
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => {
              toggleSection('ai-summary')
              if (!aiSummary) generateAISummary()
            }}
            className="w-full px-4 py-3 bg-gradient-to-r from-indigo-50 to-indigo-100 hover:from-indigo-100 hover:to-indigo-150 transition-colors flex justify-between items-center"
          >
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span className="font-semibold text-gray-800">AI-Generated Summary</span>
            </div>
            <div className="flex items-center space-x-2">
              {loadingSummary && (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
              )}
              <span className="text-xs text-indigo-600">Powered by AI</span>
              <svg
                className={`w-5 h-5 text-gray-400 transform transition-transform ${
                  expanded === 'ai-summary' ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {expanded === 'ai-summary' && (
            <div className="p-4 bg-gradient-to-br from-indigo-50 to-purple-50">
              {loadingSummary ? (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">Generating AI summary...</p>
                </div>
              ) : aiSummary ? (
                <div className="prose prose-sm max-w-none text-gray-700">
                  {aiSummary}
                </div>
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">
                  Click to generate an AI-powered summary of the policy document
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* View Full Policy Link */}
      {policyUrl && (
        <div className="flex justify-center pt-2">
          <a
            href={policyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center"
          >
            View Full Policy Document
            <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      )}
    </div>
  )
}