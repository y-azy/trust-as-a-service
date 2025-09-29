interface PlatformLink {
  platform: string
  url: string
  price?: number | null
  availability: string
  trustScore?: number
}

interface PlatformLinksTableProps {
  links: PlatformLink[]
}

export default function PlatformLinksTable({ links }: PlatformLinksTableProps) {
  if (!links || links.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No platform links available
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full bg-white border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Platform
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Price
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Availability
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Platform Trust
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {links.map((link, index) => (
            <tr key={index} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                {link.platform}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                {link.price ? `$${link.price.toFixed(2)}` : 'Check site'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                {link.availability}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                {link.trustScore && (
                  <div className="flex items-center">
                    <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                      <div
                        className={`h-2 rounded-full ${
                          link.trustScore >= 80
                            ? 'bg-green-500'
                            : link.trustScore >= 60
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                        }`}
                        style={{ width: `${link.trustScore}%` }}
                      />
                    </div>
                    <span className="text-gray-700">{link.trustScore}%</span>
                  </div>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 font-medium"
                >
                  Buy Now →
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}