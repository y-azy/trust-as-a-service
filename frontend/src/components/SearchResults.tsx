import Link from 'next/link';

interface SearchResultsProps {
  results: {
    ok: boolean;
    source: string;
    resolverResult: {
      resolved: boolean;
      type?: string;
      id?: string;
      name?: string;
      sku?: string;
      candidates: Array<{
        type: string;
        id: string;
        name: string;
        sku?: string;
        companyName?: string;
        score: number;
        matchType: string;
      }>;
    };
    product?: {
      id: string;
      name: string;
      sku: string;
      companyId?: string;
      companyName?: string;
      category?: string;
    } | null;
    trust?: {
      score: number;
      grade: string;
      breakdown: any;
      confidence: number;
      evidenceIds: string;
      createdAt: string;
    } | null;
  };
  loading?: boolean;
}

export default function SearchResults({ results, loading }: SearchResultsProps) {
  if (loading) {
    return (
      <div className="p-6 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
        <p className="mt-2 text-gray-600">Searching...</p>
      </div>
    );
  }

  if (!results) {
    return null;
  }

  const getGradeColor = (grade: string) => {
    const colors: Record<string, string> = {
      A: 'text-green-600 bg-green-100 border-green-300',
      B: 'text-lime-600 bg-lime-100 border-lime-300',
      C: 'text-yellow-600 bg-yellow-100 border-yellow-300',
      D: 'text-orange-600 bg-orange-100 border-orange-300',
      F: 'text-red-600 bg-red-100 border-red-300',
    };
    return colors[grade] || colors.F;
  };

  const getMatchTypeBadge = (matchType: string) => {
    const colors: Record<string, string> = {
      exact: 'bg-blue-100 text-blue-800',
      contains: 'bg-purple-100 text-purple-800',
      fuzzy: 'bg-gray-100 text-gray-800',
      semantic: 'bg-indigo-100 text-indigo-800',
    };
    return colors[matchType] || colors.fuzzy;
  };

  // If we have a resolved product with trust score
  if (results.product && results.trust) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-xl font-semibold text-gray-900">
                {results.product.name}
              </h3>
              <span className={`px-3 py-1 rounded-full text-sm font-bold border ${getGradeColor(results.trust.grade)}`}>
                {results.trust.grade}
              </span>
            </div>
            <p className="text-sm text-gray-600 mb-1">
              SKU: {results.product.sku}
            </p>
            {results.product.companyName && (
              <p className="text-sm text-gray-600 mb-3">
                Company: {results.product.companyName}
              </p>
            )}
            <div className="flex items-center gap-4 mb-4">
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {results.trust.score.toFixed(1)}
                </p>
                <p className="text-xs text-gray-500">Trust Score</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-700">
                  {Math.round(results.trust.confidence * 100)}%
                </p>
                <p className="text-xs text-gray-500">Confidence</p>
              </div>
            </div>
            <Link
              href={`/product/${results.product.sku}`}
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              View Details
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // If we have candidates but no resolved product
  if (results.resolverResult?.candidates && results.resolverResult.candidates.length > 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Search Results ({results.resolverResult.candidates.length} matches)
        </h3>
        <div className="space-y-3">
          {results.resolverResult.candidates.slice(0, 5).map((candidate, index) => (
            <div
              key={`${candidate.id}-${index}`}
              className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-gray-900">{candidate.name}</h4>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${getMatchTypeBadge(candidate.matchType)}`}>
                      {candidate.matchType}
                    </span>
                  </div>
                  {candidate.sku && (
                    <p className="text-sm text-gray-600 mb-1">SKU: {candidate.sku}</p>
                  )}
                  {candidate.companyName && (
                    <p className="text-sm text-gray-600 mb-2">{candidate.companyName}</p>
                  )}
                  <p className="text-xs text-gray-500">
                    Match score: {Math.round(candidate.score * 100)}%
                  </p>
                </div>
                {candidate.sku && (
                  <Link
                    href={`/product/${candidate.sku}`}
                    className="ml-4 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    View
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // No results found
  return (
    <div className="bg-white rounded-lg shadow-lg p-6 text-center">
      <p className="text-gray-600">No products found. Try a different search term.</p>
    </div>
  );
}
