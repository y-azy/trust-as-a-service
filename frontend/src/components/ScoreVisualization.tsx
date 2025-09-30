import { useEffect, useRef } from 'react'

interface ScoreVisualizationProps {
  score: number
  grade: string
  breakdown?: Array<{
    metric: string
    value: number
    weight: number
    normalized: number
  }>
  type?: 'radial' | 'segmented' | 'combined'
  size?: 'small' | 'medium' | 'large'
}

export default function ScoreVisualization({
  score,
  grade,
  breakdown = [],
  type = 'radial',
  size = 'medium'
}: ScoreVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const sizeConfig = {
    small: { width: 150, height: 150, fontSize: 24 },
    medium: { width: 200, height: 200, fontSize: 32 },
    large: { width: 250, height: 250, fontSize: 40 }
  }

  const config = sizeConfig[size]

  const getScoreColor = (score: number) => {
    if (score >= 85) return '#10B981' // green-500
    if (score >= 70) return '#84CC16' // lime-500
    if (score >= 55) return '#EAB308' // yellow-500
    if (score >= 40) return '#F97316' // orange-500
    return '#EF4444' // red-500
  }

  const getGradeColors = (grade: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      A: { bg: '#10B981', text: '#065F46' },
      B: { bg: '#84CC16', text: '#365314' },
      C: { bg: '#EAB308', text: '#713F12' },
      D: { bg: '#F97316', text: '#7C2D12' },
      F: { bg: '#EF4444', text: '#7F1D1D' }
    }
    return colors[grade] || { bg: '#9CA3AF', text: '#1F2937' }
  }

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, config.width, config.height)

    if (type === 'radial' || type === 'combined') {
      drawRadialChart(ctx)
    }
  }, [score, grade, type, config])

  const drawRadialChart = (ctx: CanvasRenderingContext2D) => {
    const centerX = config.width / 2
    const centerY = config.height / 2
    const radius = (Math.min(config.width, config.height) / 2) - 20

    // Draw background circle
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI)
    ctx.strokeStyle = '#E5E7EB'
    ctx.lineWidth = 20
    ctx.stroke()

    // Draw score arc
    const scoreAngle = (score / 100) * 2 * Math.PI - Math.PI / 2
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, scoreAngle)
    ctx.strokeStyle = getScoreColor(score)
    ctx.lineWidth = 20
    ctx.lineCap = 'round'
    ctx.stroke()

    // Draw inner circle background
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius - 30, 0, 2 * Math.PI)
    ctx.fillStyle = '#FFFFFF'
    ctx.fill()

    // Draw grade
    const gradeColors = getGradeColors(grade)
    ctx.font = `bold ${config.fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = gradeColors.text
    ctx.fillText(grade, centerX, centerY - 10)

    // Draw score text
    ctx.font = `${config.fontSize * 0.5}px sans-serif`
    ctx.fillStyle = '#6B7280'
    ctx.fillText(`${score}/100`, centerX, centerY + 20)
  }

  if (type === 'segmented') {
    return (
      <div className="space-y-4">
        {/* Main Score Bar */}
        <div>
          <div className="flex justify-between items-end mb-2">
            <div>
              <span className="text-3xl font-bold text-gray-900">{score}</span>
              <span className="text-lg text-gray-500">/100</span>
            </div>
            <span
              className="text-4xl font-bold"
              style={{ color: getGradeColors(grade).bg }}
            >
              {grade}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-6 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${score}%`,
                background: `linear-gradient(90deg, ${getScoreColor(Math.max(0, score - 20))}, ${getScoreColor(score)})`
              }}
            />
          </div>
        </div>

        {/* Breakdown Segments */}
        {breakdown.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
              Score Components
            </h4>
            {breakdown.map((metric, idx) => (
              <div key={idx}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium text-gray-700 capitalize">
                    {metric.metric.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                  <div className="flex items-center space-x-2 text-xs">
                    <span className="text-gray-500">
                      {Math.round(metric.normalized)}
                    </span>
                    <span className="text-gray-400">×</span>
                    <span className="font-semibold text-gray-600">
                      {(metric.weight * 100).toFixed(0)}%
                    </span>
                    <span className="text-gray-400">=</span>
                    <span className="font-bold text-gray-700">
                      {Math.round(metric.normalized * metric.weight)}
                    </span>
                  </div>
                </div>
                <div className="flex space-x-1">
                  <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${metric.normalized}%`,
                        backgroundColor: getScoreColor(metric.normalized)
                      }}
                    />
                  </div>
                  <div className="w-16 bg-blue-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${metric.weight * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (type === 'combined') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Radial Chart */}
        <div className="flex flex-col items-center">
          <canvas
            ref={canvasRef}
            width={config.width}
            height={config.height}
            className="mb-2"
          />
          <p className="text-sm text-gray-600">Overall Trust Score</p>
        </div>

        {/* Metrics Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
            Detailed Breakdown
          </h4>
          {breakdown.slice(0, 5).map((metric, idx) => (
            <div key={idx} className="flex items-center">
              <span className="text-xs font-medium text-gray-600 w-24 truncate">
                {metric.metric.replace(/([A-Z])/g, ' $1').trim()}
              </span>
              <div className="flex-1 mx-2">
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${metric.normalized}%`,
                      backgroundColor: getScoreColor(metric.normalized)
                    }}
                  />
                </div>
              </div>
              <span className="text-xs font-bold text-gray-700 w-8 text-right">
                {Math.round(metric.normalized * metric.weight)}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Default radial chart
  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        width={config.width}
        height={config.height}
        className="mb-2"
      />
      <p className="text-sm text-gray-600">Trust Score</p>
    </div>
  )
}