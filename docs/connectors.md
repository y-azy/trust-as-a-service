# Connectors Documentation

## Overview
Trust as a Service integrates with multiple public and commercial data sources to gather evidence for trust scoring.

## Live Connectors

### 1. NHTSA (National Highway Traffic Safety Administration)
- **Status**: ✅ Active
- **Data Type**: Vehicle recalls
- **API**: Public REST API
- **Rate Limit**: None specified
- **Usage**:
  ```bash
  npm run connector:nhtsa -- --run
  ```

### 2. CFPB (Consumer Financial Protection Bureau)
- **Status**: ✅ Active
- **Data Type**: Consumer complaints
- **API**: Public REST API
- **Rate Limit**: None specified
- **Usage**:
  ```bash
  npm run connector:cfpb -- --run "Wells Fargo"
  ```

### 3. CPSC (Consumer Product Safety Commission)
- **Status**: ⚠️ Limited
- **Data Type**: Product recalls
- **API**: SaferProducts.gov API
- **Note**: May require registration for full access
- **Alternative**: RSS feed or manual CSV export

## Connector Stubs (Require License/API Keys)

### 4. CourtListener
- **Status**: 🔒 Disabled (Requires API Key)
- **Data Type**: Legal cases and dockets
- **How to Enable**:
  1. Register at https://www.courtlistener.com/
  2. Obtain API key
  3. Add to `.env`: `COURTLISTENER_API_KEY=your_key`
  4. Update connector authentication

### 5. NewsAPI
- **Status**: 🔒 Disabled (Requires API Key)
- **Data Type**: News articles
- **How to Enable**:
  1. Register at https://newsapi.org/
  2. Get free tier API key
  3. Add to `.env`: `NEWSAPI_KEY=your_key`
  4. Connector will automatically activate

### 6. Trustpilot
- **Status**: 🔒 Disabled (Commercial API)
- **Data Type**: Business reviews
- **How to Enable**:
  1. Contact Trustpilot for business API access
  2. Add credentials to `.env`
  3. Update connector with OAuth implementation

### 7. Consumer Reports
- **Status**: 🔒 Disabled (Partnership Required)
- **Data Type**: Product testing and ratings
- **How to Enable**:
  1. Establish partnership with Consumer Reports
  2. Implement custom integration per their specifications

## Rate Limits and Best Practices

1. **Caching**: All connectors cache results for 24 hours
2. **Batch Processing**: Run connectors in batch mode during off-peak hours
3. **Error Handling**: Automatic retry with exponential backoff
4. **Storage**: Raw data stored in `/storage/raw/[connector]/`

## Adding New Connectors

To add a new connector:

1. Create file: `backend/src/connectors/[name]Connector.ts`
2. Implement interface:
   ```typescript
   interface Connector {
     fetchData(params: any): Promise<any[]>
     processData(data: any[]): Promise<Event[]>
     runBatch(limit: number): Promise<ConnectorResult>
   }
   ```
3. Add CLI support
4. Update this documentation

## Troubleshooting

### Common Issues

1. **403 Forbidden**: Check robots.txt compliance
2. **Rate Limit Exceeded**: Implement backoff strategy
3. **Invalid API Key**: Verify environment variables
4. **Network Timeout**: Increase timeout in axios config

### Logs
Connector logs are stored in:
- Success: `backend/logs/connectors/success.log`
- Errors: `backend/logs/connectors/error.log`
- Robots.txt blocks: `backend/logs/parsing_robots.log`