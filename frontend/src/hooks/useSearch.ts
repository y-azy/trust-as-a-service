import { useState, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';

interface SearchResult {
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
}

interface UseSearchOptions {
  debounceMs?: number;
  minQueryLength?: number;
}

export function useSearch(options: UseSearchOptions = {}) {
  const { debounceMs = 350, minQueryLength = 2 } = options;

  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const search = useCallback(async (query: string) => {
    if (!query || query.trim().length < minQueryLength) {
      setResults(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await axios.get<SearchResult>(
        `${process.env.NEXT_PUBLIC_API_URL}/api/search?q=${encodeURIComponent(query)}`,
        {
          headers: {
            'X-API-Key': process.env.NEXT_PUBLIC_API_KEY || 'changeme'
          }
        }
      );

      setResults(response.data);
    } catch (err: any) {
      console.error('Search failed:', err);
      setError(err.response?.data?.message || 'Search failed. Please try again.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [minQueryLength]);

  const debouncedSearch = useCallback((query: string) => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer
    debounceTimerRef.current = setTimeout(() => {
      search(query);
    }, debounceMs);
  }, [search, debounceMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    results,
    loading,
    error,
    search: debouncedSearch,
    searchImmediate: search
  };
}
