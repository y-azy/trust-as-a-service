# Trust-as-a-Service: Comprehensive Implementation Plan

## Executive Summary

After thorough analysis of the codebase, I've identified that **most backend functionality already exists and works correctly**. The main issues are:

1. **Limited database data** (only 4 products, many with 0.0 scores due to missing event data)
2. **Frontend mock data fallbacks** masking real API responses
3. **Missing AI chat interface** for natural language queries
4. **Comparison logic needs category awareness**
5. **Services/Companies sections don't exist** (only Products)

### What Already Works ✅
- All backend APIs (`/api/trust/*`, `/api/products/*`, `/api/dashboard/*`, `/api/search`, `/api/recommendations/*`)
- Scoring algorithm with Bayesian aggregation
- Entity resolver search with fuzzy matching
- All 10 connectors (NHTSA, CFPB, CPSC, etc.)
- Redis caching
- Database schema and migrations

### What Needs Fixing/Building 🔧
- Populate database with real connector data
- Remove frontend mock fallbacks
- Build AI chat interface
- Improve comparison and featured sections
- Add proper empty states

---

## Phase 1: Data Population & Scoring Fixes

### 1.1 Database Seeding with Real Data

**Problem:** Database has only 4 products, many with 0.0 scores due to missing event data.

**Solution:** Enhance seed script and run connectors to populate real data.

**Files to Modify:**
- `backend/prisma/seed.ts`

**Changes Required:**
```typescript
// Add 20-30 diverse products across categories:
// - automotive (cars, motorcycles)
// - electronics_phone (smartphones)
// - electronics_audio (headphones, speakers)
// - electronics_computer (laptops)
// - appliance (washers, refrigerators)
// - general (misc products)

// For each product:
1. Create Company record if doesn't exist
2. Create Product record
3. Run connector to fetch real events (NHTSA for auto, CPSC for electronics, etc.)
4. Create Event records from connector results
5. Run score recompute
```

**Specific Actions:**
1. Modify `backend/prisma/seed.ts`:
   - Add array of 25 real products with known SKUs/models
   - Include makes/models that have real recall/complaint data
   - Example: Honda Accord 2020, iPhone 14, Samsung Galaxy S23, etc.

2. Create new script `backend/src/scripts/populateRealData.ts`:
   ```typescript
   // For each seeded product:
   // 1. Determine category → select appropriate connector
   // 2. Run connector.searchByText(productName)
   // 3. Save events to database
   // 4. Run scoreRecomputeJob.recomputeProductScore()
   ```

3. Add npm script to `backend/package.json`:
   ```json
   "populate-data": "npm run seed && ts-node src/scripts/populateRealData.ts"
   ```

**Expected Outcome:**
- Database has 25+ products with real event data
- All products have computed scores > 0
- Scores reflect real recalls, complaints, warranties

**Testing:**
```bash
cd backend
npm run populate-data
npm run recompute -- --full
sqlite3 db/trust.db "SELECT COUNT(*) FROM Product;"  # Should show 25+
sqlite3 db/trust.db "SELECT COUNT(*) FROM Event;"    # Should show 100+
sqlite3 db/trust.db "SELECT AVG(score) FROM Score;"  # Should show 0.4-0.7
```

---

### 1.2 Score Display Fix (MINOR)

**Problem:** Scores are stored as 0-1 but need consistent 0-100 display everywhere.

**Files to Check (No changes needed if already correct):**
- `backend/src/controllers/trustController.ts` - Line 287, 431: Should multiply by 100
- `frontend/src/pages/product/[sku].tsx` - Line 145-157: Check if multiplication is consistent

**Verification Only:** Ensure all score displays show 0-100 range, not 0-1.

---

## Phase 2: Frontend Mock Data Removal

### 2.1 Remove Mock Data Fallbacks

**Problem:** Frontend shows mock data when APIs return empty results, hiding real issues.

**Solution:** Replace mock fallbacks with proper empty states and loading indicators.

### File: `frontend/src/pages/index.tsx`

**Lines to Modify: 50-88**

**Current Code:**
```typescript
} catch (error) {
  console.error('Failed to fetch featured products:', error)
  // Use mock data for demonstration
  setFeaturedProducts([
    { sku: 'IPHONE-13-PRO-MAX', ... },
    ...
  ])
}
```

**Replace With:**
```typescript
} catch (error) {
  console.error('Failed to fetch featured products:', error)
  // Show error state instead of mock data
  setFeaturedProducts([])
  setError('Unable to load featured products. Please try again later.')
}
```

**Additional Changes in `index.tsx`:**

**Lines 272-277** - Replace featured products section:
```typescript
// OLD:
<h3>Featured Products</h3>
<div className="grid">
  {featuredProducts.map((product) => (
    <ProductCard key={product.sku} {...product} />
  ))}
</div>

// NEW:
<h3>Featured Products</h3>
{featuredProducts.length === 0 ? (
  <div className="text-center py-12">
    <p className="text-gray-500">No featured products available yet.</p>
    <p className="text-sm text-gray-400 mt-2">Check back soon or use search above.</p>
  </div>
) : (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
    {featuredProducts.map((product) => (
      <ProductCard key={product.sku} {...product} />
    ))}
  </div>
)}
```

**Lines 289-305** - Replace hardcoded statistics with API call:
```typescript
// NEW: Add useEffect to fetch real stats
const [stats, setStats] = useState({ products: 0, avgScore: 0, sources: 0 });

useEffect(() => {
  fetchStats();
}, []);

const fetchStats = async () => {
  try {
    const response = await axios.get(
      `${process.env.NEXT_PUBLIC_API_URL}/api/dashboard/stats`,
      { headers: { 'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme' } }
    );
    setStats({
      products: response.data.totalProducts,
      avgScore: response.data.avgTrustScore,
      sources: response.data.totalProducts * 5 // Estimate: ~5 sources per product
    });
  } catch (error) {
    console.error('Failed to fetch stats:', error);
  }
};

// Replace hardcoded values:
<p className="text-2xl md:text-3xl font-bold text-blue-600">{stats.products}+</p>
<p className="text-2xl md:text-3xl font-bold text-green-600">{stats.avgScore}</p>
<p className="text-2xl md:text-3xl font-bold text-yellow-600">{Math.round(stats.sources)}+</p>
```

---

### File: `frontend/src/pages/dashboard.tsx`

**Lines to Modify: 61-99**

**Current Code:**
```typescript
} catch (error) {
  console.error('Failed to fetch dashboard stats:', error)
  // Use mock data for demonstration
  setStats({ totalProducts: 156, ... })
}
```

**Replace With:**
```typescript
} catch (error) {
  console.error('Failed to fetch dashboard stats:', error)
  setStats(null) // Clear stats instead of showing mock
  setError('Unable to load dashboard data. Please refresh.')
}
```

**Add error display at line 156:**
```typescript
if (loading) {
  return <div>...loading...</div>
}

// ADD THIS:
if (error) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-red-600 mb-2">Error Loading Dashboard</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

if (!stats) {
  return <div>...no data available...</div>
}
```

---

### File: `frontend/src/pages/compare.tsx`

**Lines to Modify: 56-120**

**Current Code:**
```typescript
} catch (error) {
  console.error('Failed to fetch products:', error)
  // Use mock data for demonstration
  const mockProducts: Product[] = [...]
  setAvailableProducts(mockProducts)
}
```

**Replace With:**
```typescript
} catch (error) {
  console.error('Failed to fetch products:', error)
  setAvailableProducts([])
  setError('Unable to load products for comparison.')
}
```

**Add error state variable at line 28:**
```typescript
const [error, setError] = useState<string | null>(null)
```

**Add error display in JSX at line 290:**
```typescript
{error && (
  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
    <p className="text-red-700">{error}</p>
  </div>
)}

{loading ? (
  <div className="flex justify-center py-12">
    <div className="animate-spin..."></div>
  </div>
) : searchResults.length === 0 ? (
  <div className="text-center py-12">
    <p className="text-gray-500">No products available for comparison.</p>
    <button onClick={() => window.location.href = '/'} className="mt-4 text-blue-600 hover:underline">
      Go to Home
    </button>
  </div>
) : (
  <div className="grid">...</div>
)}
```

---

## Phase 3: Intelligent Comparison & Featured Sections

### 3.1 Category-Aware Product Comparison

**Problem:** Comparison page allows comparing unrelated products (iPhone vs Honda).

**Solution:** Filter comparisons by category, show warning if cross-category selected.

**File: `frontend/src/pages/compare.tsx`**

**Add validation function at line 122:**
```typescript
const validateSelection = (newSkus: string[]): { valid: boolean; message?: string } => {
  if (newSkus.length < 2) return { valid: true };

  // Get categories of selected products
  const categories = newSkus.map(sku => {
    const product = availableProducts.find(p => p.sku === sku);
    return product?.category || 'unknown';
  });

  // Check if all in same category
  const uniqueCategories = [...new Set(categories)];

  if (uniqueCategories.length > 1) {
    return {
      valid: false,
      message: `Cannot compare products from different categories: ${uniqueCategories.join(', ')}`
    };
  }

  return { valid: true };
};
```

**Modify toggleProduct function at line 163:**
```typescript
const toggleProduct = (sku: string) => {
  const newSelection = selectedProducts.includes(sku)
    ? selectedProducts.filter(s => s !== sku)
    : [...selectedProducts, sku];

  const validation = validateSelection(newSelection);

  if (!validation.valid) {
    setError(validation.message);
    return;
  }

  setError(null);
  setSelectedProducts(newSelection);
};
```

---

### 3.2 Separate Featured Sections for Products/Services/Companies

**Problem:** Only "Featured Products" section exists. No Services or Companies.

**Solution:** Since Services don't exist in schema, create separate sections for Products by category and Top Companies.

**File: `frontend/src/pages/index.tsx`**

**Replace lines 272-280 with:**
```typescript
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
  {/* Featured Products by Category */}
  <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">Featured Products</h3>
  <p className="text-gray-600 mb-6">Top-rated products across all categories</p>

  {featuredProducts.length === 0 ? (
    <div className="text-center py-12">
      <p className="text-gray-500">No featured products available yet.</p>
    </div>
  ) : (
    <>
      {/* Electronics */}
      {featuredProducts.some(p => p.category?.includes('electronics')) && (
        <div className="mb-8">
          <h4 className="text-lg font-semibold text-gray-800 mb-4">Electronics</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {featuredProducts
              .filter(p => p.category?.includes('electronics'))
              .slice(0, 3)
              .map((product) => (
                <ProductCard key={product.sku} {...product} />
              ))}
          </div>
        </div>
      )}

      {/* Automotive */}
      {featuredProducts.some(p => p.category === 'automotive') && (
        <div className="mb-8">
          <h4 className="text-lg font-semibold text-gray-800 mb-4">Automotive</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {featuredProducts
              .filter(p => p.category === 'automotive')
              .slice(0, 3)
              .map((product) => (
                <ProductCard key={product.sku} {...product} />
              ))}
          </div>
        </div>
      )}

      {/* Appliances */}
      {featuredProducts.some(p => p.category === 'appliance') && (
        <div className="mb-8">
          <h4 className="text-lg font-semibold text-gray-800 mb-4">Appliances</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {featuredProducts
              .filter(p => p.category === 'appliance')
              .slice(0, 3)
              .map((product) => (
                <ProductCard key={product.sku} {...product} />
              ))}
          </div>
        </div>
      )}
    </>
  )}

  {/* Top Companies Section */}
  <div className="mt-12">
    <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">Top Companies</h3>
    <p className="text-gray-600 mb-6">Companies with the highest trust scores</p>

    {topCompanies.length === 0 ? (
      <div className="text-center py-12">
        <p className="text-gray-500">No company data available yet.</p>
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {topCompanies.map((company) => (
          <div key={company.id} className="bg-white rounded-lg shadow p-4 hover:shadow-lg transition-shadow">
            <h4 className="font-semibold text-gray-900 mb-2">{company.name}</h4>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold text-gray-900">{company.score}</span>
              <span className={`px-2 py-1 rounded text-sm font-bold ${getGradeColor(company.grade)}`}>
                {company.grade}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-2">{company.productCount} products tracked</p>
          </div>
        ))}
      </div>
    )}
  </div>
</div>
```

**Add topCompanies state and fetch at line 26:**
```typescript
const [topCompanies, setTopCompanies] = useState<any[]>([])

const fetchTopCompanies = async () => {
  try {
    const response = await axios.get(
      `${process.env.NEXT_PUBLIC_API_URL}/api/companies/featured`,
      { headers: { 'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme' } }
    );
    setTopCompanies(response.data.slice(0, 4));
  } catch (error) {
    console.error('Failed to fetch top companies:', error);
    setTopCompanies([]);
  }
};

useEffect(() => {
  fetchFeaturedProducts();
  fetchTopCompanies();
}, []);
```

**Add new backend API endpoint:** `backend/src/app.ts` at line 58:
```typescript
app.get('/api/companies/featured', trustController.getFeaturedCompanies);
```

**Add controller function in** `backend/src/controllers/trustController.ts` after line 301:
```typescript
async getFeaturedCompanies(_req: Request, res: Response, next: NextFunction) {
  try {
    const companies = await prisma.company.findMany({
      include: {
        products: true,
        scores: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      take: 20
    });

    const featured = companies
      .filter(company => company.scores.length > 0)
      .map(company => ({
        id: company.id,
        name: company.name,
        domain: company.domain,
        score: Math.round(company.scores[0].score * 100),
        grade: getGrade(company.scores[0].score * 100),
        confidence: company.scores[0].confidence,
        productCount: company.products.length
      }))
      .sort((a, b) => b.score - a.score);

    return res.json(featured);
  } catch (error) {
    return next(error);
  }
}
```

---

## Phase 4: AI Chat Interface (NEW FEATURE)

### 4.1 AI Chat Component

**Problem:** No conversational AI interface exists. Users can't ask natural language questions.

**Solution:** Create AI chat component that uses OpenAI with function calling to query the API.

**New File: `frontend/src/components/AIChat.tsx`**

```typescript
import { useState, useRef, useEffect } from 'react';
import axios from 'axios';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export default function AIChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hi! I can help you check trust scores for products and companies. Ask me anything like "What\'s the trust score for iPhone 14?" or "Compare Honda Civic vs Toyota Camry"',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/api/ai/chat`,
        {
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          }))
        },
        {
          headers: { 'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme' }
        }
      );

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.data.message,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('AI chat error:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 w-96 h-[500px] bg-white rounded-lg shadow-2xl flex flex-col border border-gray-200">
      {/* Header */}
      <div className="bg-blue-600 text-white px-4 py-3 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center">
          <span className="text-xl mr-2">🤖</span>
          <span className="font-semibold">Trust AI Assistant</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-4 py-2 rounded-lg ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              <p className="text-xs mt-1 opacity-70">
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-2 rounded-lg">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3">
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Ask about trust scores..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

### 4.2 AI Backend Endpoint with Function Calling

**New File: `backend/src/controllers/aiController.ts`**

```typescript
import { Request, Response, NextFunction } from 'express';
import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import { resolveEntity } from '../services/entityResolver';

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Define available functions for AI
const functions = [
  {
    name: 'search_product',
    description: 'Search for a product by name, brand, or SKU to get trust score information',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Product name, brand, or SKU to search for (e.g., "iPhone 14", "Honda Civic")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_product_trust',
    description: 'Get detailed trust score for a specific product by SKU',
    parameters: {
      type: 'object',
      properties: {
        sku: {
          type: 'string',
          description: 'Product SKU'
        }
      },
      required: ['sku']
    }
  },
  {
    name: 'compare_products',
    description: 'Compare trust scores of two or more products',
    parameters: {
      type: 'object',
      properties: {
        skus: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of product SKUs to compare'
        }
      },
      required: ['skus']
    }
  },
  {
    name: 'get_company_trust',
    description: 'Get trust score for a company',
    parameters: {
      type: 'object',
      properties: {
        companyName: {
          type: 'string',
          description: 'Company name'
        }
      },
      required: ['companyName']
    }
  }
];

// Function implementations
async function searchProduct(query: string) {
  const result = await resolveEntity(query);
  if (result.resolved && result.type === 'product') {
    const product = await prisma.product.findUnique({
      where: { id: result.id },
      include: {
        scores: { orderBy: { createdAt: 'desc' }, take: 1 },
        company: true
      }
    });

    if (product && product.scores[0]) {
      return {
        found: true,
        product: {
          sku: product.sku,
          name: product.name,
          company: product.company?.name,
          score: Math.round(product.scores[0].score * 100),
          grade: getGrade(product.scores[0].score * 100),
          confidence: Math.round(product.scores[0].confidence * 100)
        }
      };
    }
  }

  return {
    found: false,
    message: `No product found matching "${query}". Try a different search term.`,
    suggestions: result.candidates.slice(0, 3).map(c => c.name)
  };
}

async function getProductTrust(sku: string) {
  const product = await prisma.product.findUnique({
    where: { sku },
    include: {
      scores: { orderBy: { createdAt: 'desc' }, take: 1 },
      company: true,
      events: { orderBy: { createdAt: 'desc' }, take: 5 }
    }
  });

  if (!product || !product.scores[0]) {
    return { error: 'Product not found or no score available' };
  }

  const breakdownParsed = typeof product.scores[0].breakdownJson === 'string'
    ? JSON.parse(product.scores[0].breakdownJson)
    : product.scores[0].breakdownJson;

  return {
    sku: product.sku,
    name: product.name,
    company: product.company?.name,
    score: Math.round(product.scores[0].score * 100),
    grade: getGrade(product.scores[0].score * 100),
    confidence: Math.round(product.scores[0].confidence * 100),
    breakdown: breakdownParsed.map((b: any) => ({
      metric: b.metric,
      score: Math.round(b.normalized),
      weight: Math.round(b.weight * 100)
    })),
    recentEvents: product.events.map(e => ({
      type: e.type,
      source: e.source,
      date: e.createdAt.toISOString().split('T')[0]
    }))
  };
}

async function compareProducts(skus: string[]) {
  const products = await Promise.all(
    skus.map(sku =>
      prisma.product.findUnique({
        where: { sku },
        include: {
          scores: { orderBy: { createdAt: 'desc' }, take: 1 },
          company: true
        }
      })
    )
  );

  const validProducts = products.filter(p => p && p.scores[0]);

  if (validProducts.length === 0) {
    return { error: 'No valid products found for comparison' };
  }

  return {
    products: validProducts.map(p => ({
      sku: p!.sku,
      name: p!.name,
      company: p!.company?.name,
      score: Math.round(p!.scores[0].score * 100),
      grade: getGrade(p!.scores[0].score * 100)
    })),
    winner: validProducts.reduce((best, current) =>
      current!.scores[0].score > best!.scores[0].score ? current : best
    )!.name
  };
}

async function getCompanyTrust(companyName: string) {
  const company = await prisma.company.findFirst({
    where: { name: { contains: companyName } },
    include: {
      scores: { orderBy: { createdAt: 'desc' }, take: 1 },
      products: { take: 5 }
    }
  });

  if (!company || !company.scores[0]) {
    return { error: 'Company not found or no score available' };
  }

  return {
    name: company.name,
    score: Math.round(company.scores[0].score * 100),
    grade: getGrade(company.scores[0].score * 100),
    productCount: company.products.length,
    topProducts: company.products.map(p => p.name)
  };
}

function getGrade(score: number): string {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export const aiController = {
  async chat(req: Request, res: Response, next: NextFunction) {
    try {
      const { messages } = req.body;

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({
          error: 'AI service not configured',
          message: 'OPENAI_API_KEY is not set'
        });
      }

      // Add system message
      const systemMessage = {
        role: 'system',
        content: `You are a trust score assistant. Help users find trust scores for products and companies.
        Use the provided functions to search for products, get trust scores, compare products, and get company information.
        Be concise and friendly. When presenting scores, explain what they mean (A=excellent, B=good, C=fair, D=poor, F=failing).
        If a user asks about a product you can't find, suggest similar alternatives.`
      };

      // Call OpenAI with function calling
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [systemMessage, ...messages],
        functions: functions,
        function_call: 'auto',
        temperature: 0.7,
        max_tokens: 500
      });

      const responseMessage = completion.choices[0].message;

      // Check if function was called
      if (responseMessage.function_call) {
        const functionName = responseMessage.function_call.name;
        const functionArgs = JSON.parse(responseMessage.function_call.arguments);

        let functionResult;
        switch (functionName) {
          case 'search_product':
            functionResult = await searchProduct(functionArgs.query);
            break;
          case 'get_product_trust':
            functionResult = await getProductTrust(functionArgs.sku);
            break;
          case 'compare_products':
            functionResult = await compareProducts(functionArgs.skus);
            break;
          case 'get_company_trust':
            functionResult = await getCompanyTrust(functionArgs.companyName);
            break;
          default:
            functionResult = { error: 'Unknown function' };
        }

        // Call OpenAI again with function result
        const secondCompletion = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            systemMessage,
            ...messages,
            responseMessage,
            {
              role: 'function',
              name: functionName,
              content: JSON.stringify(functionResult)
            }
          ],
          temperature: 0.7,
          max_tokens: 500
        });

        return res.json({
          message: secondCompletion.choices[0].message.content
        });
      }

      // No function call, return response directly
      return res.json({
        message: responseMessage.content
      });

    } catch (error) {
      console.error('AI chat error:', error);
      return next(error);
    }
  }
};
```

**Add to `backend/src/app.ts` at line 73:**
```typescript
import { aiController } from './controllers/aiController';

// After other routes:
app.post('/api/ai/chat', aiController.chat);
```

**Add AIChat to frontend pages:**

**File: `frontend/src/pages/index.tsx`** - Add at line 380 (before closing </div>):
```typescript
import AIChat from '@/components/AIChat'

// In JSX, before closing body div:
<AIChat />
```

---

## Phase 5: Testing & Validation

### 5.1 Unit Tests

**Files to test:**
- `backend/src/services/entityResolver.ts` - Already tested
- `backend/src/services/trustScore.ts` - Already tested
- `backend/src/services/trustAggregator.ts` - Already tested

**NEW tests needed:**
- `backend/tests/unit/aiController.test.ts` - Test AI function calling logic

**NEW test file: `backend/tests/unit/aiController.test.ts`**
```typescript
import { searchProduct, getProductTrust, compareProducts } from '../../src/controllers/aiController';

describe('AI Controller Functions', () => {
  it('should search and find existing products', async () => {
    const result = await searchProduct('Honda Civic');
    expect(result.found).toBe(true);
    expect(result.product).toBeDefined();
  });

  it('should return suggestions when product not found', async () => {
    const result = await searchProduct('NonexistentProduct123');
    expect(result.found).toBe(false);
    expect(result.suggestions).toBeDefined();
  });

  it('should compare multiple products', async () => {
    const result = await compareProducts(['SKU1', 'SKU2']);
    expect(result.products).toHaveLength(2);
    expect(result.winner).toBeDefined();
  });
});
```

### 5.2 Integration Tests

**Files to test:**
- `backend/tests/integration/trustDiagnostics.test.ts` - Already exists
- `backend/tests/integration/search.test.ts` - Create new

**NEW test file: `backend/tests/integration/search.test.ts`**
```typescript
import request from 'supertest';
import app from '../../src/app';

describe('Search Integration', () => {
  it('should search for existing product', async () => {
    const response = await request(app)
      .get('/api/search?q=Honda')
      .set('X-API-Key', 'changeme')
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.resolverResult).toBeDefined();
  });

  it('should return 400 for empty query', async () => {
    await request(app)
      .get('/api/search?q=')
      .set('X-API-Key', 'changeme')
      .expect(400);
  });
});
```

### 5.3 Manual Testing Checklist

**After deploying all changes:**

- [ ] Homepage loads without errors
- [ ] Featured products display real data (not mock)
- [ ] Statistics section shows real numbers
- [ ] Search finds products correctly
- [ ] Product detail page shows real trust scores
- [ ] Dashboard displays real aggregated data
- [ ] Date range filtering works
- [ ] Comparison page validates category matching
- [ ] AI chat responds to queries
- [ ] AI can search products
- [ ] AI can get trust scores
- [ ] AI can compare products
- [ ] No console errors in browser
- [ ] All API endpoints return 200 (not 404/500)

---

## Phase 6: Environment Configuration

### 6.1 Required API Keys

**File: `backend/.env`**

**Required (already have):**
```
OPENAI_API_KEY=sk-...  # For policy parser and AI chat
DATABASE_URL=file:./db/trust.db
REDIS_URL=redis://localhost:6379
API_KEY_MAIN=changeme
```

**Optional (for enhanced features):**
```
NEWSAPI_KEY=...         # News connector
TRUSTPILOT_API_KEY=...  # Review connector
GOOGLE_PLACES_API_KEY=... # Location/review data
```

**File: `frontend/.env.local`**
```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_API_KEY=changeme
```

### 6.2 Docker Configuration

**File: `docker-compose.yml` - No changes needed, already correct**

Verify environment variables are set:
```yaml
environment:
  OPENAI_API_KEY: ${OPENAI_API_KEY:-}
  TRUST_INCLUDE_DIAGNOSTICS: ${TRUST_INCLUDE_DIAGNOSTICS:-true}
```

---

## Phase 7: Deployment & Smoke Tests

### 7.1 Rebuild Docker

```bash
# Stop existing containers
docker-compose down

# Rebuild with no cache
docker-compose build --no-cache

# Start services
docker-compose up -d

# Wait for services to be ready
sleep 10

# Check health
docker-compose ps
curl http://localhost:4000/health
```

### 7.2 Smoke Tests

```bash
# Backend health
curl http://localhost:4000/health

# Frontend loading
curl http://localhost:3000

# API endpoints
curl -H "X-API-Key: changeme" http://localhost:4000/api/products/featured

# Database populated
docker exec -it trust-backend sqlite3 /app/db/trust.db "SELECT COUNT(*) FROM Product;"

# Scores computed
docker exec -it trust-backend sqlite3 /app/db/trust.db "SELECT AVG(score) FROM Score;"
```

---

## Success Criteria

✅ Database has 25+ products with real event data
✅ All products have computed scores > 0
✅ Frontend shows NO mock data (only real API responses or empty states)
✅ Search works for all products
✅ AI chat responds and uses functions correctly
✅ Dashboard aggregates real data
✅ Comparison validates categories
✅ Featured sections show Products and Top Companies
✅ All 312 tests pass
✅ No console errors
✅ Docker containers run successfully

---

## Execution Order

1. **Phase 1 (Data):** Seed database → Run connectors → Recompute scores
2. **Phase 2 (Frontend Cleanup):** Remove mock fallbacks → Add empty states
3. **Phase 3 (Features):** Category validation → Featured sections
4. **Phase 4 (AI):** Build AI chat component → Create backend endpoint
5. **Phase 5 (Testing):** Write new tests → Run all tests
6. **Phase 6 (Config):** Verify environment variables
7. **Phase 7 (Deploy):** Rebuild Docker → Run smoke tests

**Estimated Timeline:**
- Phase 1: 2-3 hours
- Phase 2: 1 hour
- Phase 3: 2 hours
- Phase 4: 3-4 hours
- Phase 5: 2 hours
- Phase 6: 30 minutes
- Phase 7: 1 hour

**Total: ~12-14 hours of implementation time**

---

## Notes on File Management

- **DO NOT** create duplicate files
- **DO NOT** create new services/utils unless absolutely necessary
- **REUSE** existing components and utilities
- **MODIFY** existing files instead of creating new ones when possible
- **FOLLOW** existing code patterns and conventions
- **NO** unnecessary abstraction layers
