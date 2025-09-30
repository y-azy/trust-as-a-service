import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SearchResults from '../SearchResults';

describe('SearchResults', () => {
  it('should show loading spinner when loading', () => {
    render(<SearchResults results={null} loading={true} />);

    expect(screen.getByText('Searching...')).toBeInTheDocument();
  });

  it('should return null when no results and not loading', () => {
    const { container } = render(<SearchResults results={null} loading={false} />);

    expect(container.firstChild).toBeNull();
  });

  it('should display product card with trust score when resolved', () => {
    const mockResults = {
      ok: true,
      source: 'resolver',
      resolverResult: {
        resolved: true,
        type: 'product',
        id: 'prod-1',
        name: 'iPhone 13 Pro Max',
        sku: 'IPHONE-13-PRO-MAX',
        candidates: []
      },
      product: {
        id: 'prod-1',
        name: 'iPhone 13 Pro Max',
        sku: 'IPHONE-13-PRO-MAX',
        companyId: 'apple-inc',
        companyName: 'Apple Inc.',
        category: 'Electronics'
      },
      trust: {
        score: 88.5,
        grade: 'A',
        breakdown: {},
        confidence: 0.92,
        evidenceIds: 'evt-1,evt-2',
        createdAt: '2025-01-15T10:00:00Z'
      }
    };

    render(<SearchResults results={mockResults} loading={false} />);

    expect(screen.getByText('iPhone 13 Pro Max')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('88.5')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.getByText('Company: Apple Inc.')).toBeInTheDocument();
    expect(screen.getByText('SKU: IPHONE-13-PRO-MAX')).toBeInTheDocument();
    expect(screen.getByText('View Details')).toBeInTheDocument();
  });

  it('should display candidates list when not resolved', () => {
    const mockResults = {
      ok: true,
      source: 'resolver',
      resolverResult: {
        resolved: false,
        candidates: [
          {
            type: 'product',
            id: 'prod-1',
            name: 'iPhone 13 Pro Max',
            sku: 'IPHONE-13-PRO-MAX',
            companyName: 'Apple Inc.',
            score: 0.95,
            matchType: 'exact'
          },
          {
            type: 'product',
            id: 'prod-2',
            name: 'iPhone 13 Pro',
            sku: 'IPHONE-13-PRO',
            companyName: 'Apple Inc.',
            score: 0.85,
            matchType: 'fuzzy'
          }
        ]
      },
      product: null,
      trust: null
    };

    render(<SearchResults results={mockResults} loading={false} />);

    expect(screen.getByText('Search Results (2 matches)')).toBeInTheDocument();
    expect(screen.getByText('iPhone 13 Pro Max')).toBeInTheDocument();
    expect(screen.getByText('iPhone 13 Pro')).toBeInTheDocument();
    expect(screen.getByText('exact')).toBeInTheDocument();
    expect(screen.getByText('fuzzy')).toBeInTheDocument();
    expect(screen.getByText('Match score: 95%')).toBeInTheDocument();
    expect(screen.getByText('Match score: 85%')).toBeInTheDocument();
  });

  it('should limit candidates display to 5', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      type: 'product',
      id: `prod-${i}`,
      name: `Product ${i}`,
      sku: `SKU-${i}`,
      score: 0.8,
      matchType: 'fuzzy'
    }));

    const mockResults = {
      ok: true,
      source: 'resolver',
      resolverResult: {
        resolved: false,
        candidates
      },
      product: null,
      trust: null
    };

    render(<SearchResults results={mockResults} loading={false} />);

    // Should show first 5 products
    expect(screen.getByText('Product 0')).toBeInTheDocument();
    expect(screen.getByText('Product 4')).toBeInTheDocument();

    // Should not show 6th product or beyond
    expect(screen.queryByText('Product 5')).not.toBeInTheDocument();
    expect(screen.queryByText('Product 9')).not.toBeInTheDocument();
  });

  it('should show no results message when candidates array is empty', () => {
    const mockResults = {
      ok: true,
      source: 'resolver',
      resolverResult: {
        resolved: false,
        candidates: []
      },
      product: null,
      trust: null
    };

    render(<SearchResults results={mockResults} loading={false} />);

    expect(screen.getByText('No products found. Try a different search term.')).toBeInTheDocument();
  });

  it('should apply correct grade colors', () => {
    const grades = [
      { grade: 'A', color: 'text-green-600' },
      { grade: 'B', color: 'text-lime-600' },
      { grade: 'C', color: 'text-yellow-600' },
      { grade: 'D', color: 'text-orange-600' },
      { grade: 'F', color: 'text-red-600' }
    ];

    grades.forEach(({ grade, color }) => {
      const mockResults = {
        ok: true,
        source: 'resolver',
        resolverResult: {
          resolved: true,
          type: 'product',
          id: 'prod-1',
          name: 'Test Product',
          sku: 'TEST-SKU',
          candidates: []
        },
        product: {
          id: 'prod-1',
          name: 'Test Product',
          sku: 'TEST-SKU',
          companyId: 'test-company',
          companyName: 'Test Company'
        },
        trust: {
          score: 70,
          grade,
          breakdown: {},
          confidence: 0.8,
          evidenceIds: '',
          createdAt: '2025-01-15T10:00:00Z'
        }
      };

      const { container } = render(<SearchResults results={mockResults} loading={false} />);
      const gradeBadge = screen.getByText(grade);

      expect(gradeBadge).toHaveClass(color);

      // Cleanup for next iteration
      container.remove();
    });
  });

  it('should apply correct match type badge colors', () => {
    const matchTypes = [
      { type: 'exact', color: 'bg-blue-100' },
      { type: 'contains', color: 'bg-purple-100' },
      { type: 'fuzzy', color: 'bg-gray-100' },
      { type: 'semantic', color: 'bg-indigo-100' }
    ];

    matchTypes.forEach(({ type, color }) => {
      const mockResults = {
        ok: true,
        source: 'resolver',
        resolverResult: {
          resolved: false,
          candidates: [{
            type: 'product',
            id: 'prod-1',
            name: 'Test Product',
            sku: 'TEST-SKU',
            score: 0.9,
            matchType: type
          }]
        },
        product: null,
        trust: null
      };

      const { container } = render(<SearchResults results={mockResults} loading={false} />);
      const matchBadge = screen.getByText(type);

      expect(matchBadge).toHaveClass(color);

      // Cleanup for next iteration
      container.remove();
    });
  });
});
