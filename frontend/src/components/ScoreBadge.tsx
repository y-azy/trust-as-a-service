interface ScoreBadgeProps {
  score: number
  grade: string
  confidence: number
}

export default function ScoreBadge({ score, grade, confidence }: ScoreBadgeProps) {
  const getGradeColor = () => {
    switch (grade) {
      case 'A': return 'bg-green-500'
      case 'B': return 'bg-lime-500'
      case 'C': return 'bg-yellow-500'
      case 'D': return 'bg-orange-500'
      case 'F': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const getGradeTextColor = () => {
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
    <div className="flex flex-col items-center p-6 bg-white rounded-xl shadow-lg border-2 border-gray-200">
      <div className={`w-32 h-32 rounded-full ${getGradeColor()} flex items-center justify-center mb-4`}>
        <span className="text-6xl font-bold text-white">{grade}</span>
      </div>
      <div className="text-center">
        <p className="text-3xl font-bold text-gray-900">{score}/100</p>
        <p className="text-sm text-gray-600 mt-1">Trust Score</p>
        <div className="mt-3">
          <div className="flex items-center">
            <span className="text-xs text-gray-500 mr-2">Confidence:</span>
            <div className="w-20 bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full"
                style={{ width: `${confidence * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-600 ml-2">{Math.round(confidence * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}