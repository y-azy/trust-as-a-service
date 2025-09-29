interface Evidence {
  id: string
  type: string
  source: string
  severity?: number
  summary: string
  sourceUrl?: string
  date: string
}

interface EvidenceListProps {
  evidence: Evidence[]
}

export default function EvidenceList({ evidence }: EvidenceListProps) {
  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'recall': return '⚠️'
      case 'complaint': return '📝'
      case 'policy': return '📋'
      case 'review': return '⭐'
      case 'court': return '⚖️'
      case 'news': return '📰'
      default: return '📌'
    }
  }

  const getSeverityColor = (severity?: number) => {
    if (!severity) return 'bg-gray-100'
    if (severity >= 4) return 'bg-red-100'
    if (severity >= 3) return 'bg-orange-100'
    if (severity >= 2) return 'bg-yellow-100'
    return 'bg-green-100'
  }

  if (evidence.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No evidence available yet
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {evidence.map((item) => (
        <div
          key={item.id}
          className={`p-4 rounded-lg ${getSeverityColor(item.severity)} border border-gray-200`}
        >
          <div className="flex items-start">
            <span className="text-2xl mr-3">{getTypeIcon(item.type)}</span>
            <div className="flex-1">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-semibold text-gray-900 capitalize">
                    {item.type} - {item.source}
                  </h4>
                  <p className="text-gray-700 mt-1">{item.summary}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {new Date(item.date).toLocaleDateString()}
                  </p>
                </div>
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 text-sm ml-4"
                  >
                    View Source →
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}