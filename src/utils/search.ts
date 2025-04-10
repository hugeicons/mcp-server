import Fuse from 'fuse.js';
import { IconInfo } from '../types.js';

interface SearchableIcon {
    name: string;
    tags: string;
    category: string;
    featured: boolean;
    version: string;
    searchableText: {
        name: string;
        tags: string;
        category: string;
        all: string;
    };
}

interface SearchResult {
    item: SearchableIcon;
    score: number;
}

/**
 * Prepares an icon for searching by creating searchable text fields
 */
function prepareIconForSearch(icon: IconInfo): SearchableIcon {
    // Process tags once for efficiency
    const processedTags = 
        icon.tags
            ?.split(',')
            .map((tag: string) => tag.trim())
            .filter((tag: string) => tag) || [];

    const baseSearchText = {
        name: icon.name.toLowerCase(),
        tags: processedTags.join(' ').toLowerCase(),
        category: icon.category?.toLowerCase() || '',
        all: [
            icon.name,
            icon.name.replace(/-/g, ' '), // Add version with hyphens replaced by spaces
            icon.name.replace(/-/g, ''),  // Add version with hyphens removed
            // Add individual parts of hyphenated names
            ...(icon.name.includes('-') ? icon.name.split('-') : []),
            ...processedTags,
            icon.category,
            ...processedTags.flatMap((tag: string) => tag.split(/[\s-]/))
        ]
            .filter(Boolean)  // Remove any empty strings
            .join(' ')
            .toLowerCase(),
    };

    return {
        ...icon,
        searchableText: baseSearchText,
    };
}

/**
 * Process search terms and handle special cases like hyphenated words
 */
function processSearchTerms(search: string): string[] {
    const normalizedSearch = search.toLowerCase().replace(/-/g, ' ');
    const searchTerms = normalizedSearch
        .split(' ')
        .filter(term => term.length > 0);
    
    // Special case: if we have terms like "chart" and "up", also add "chart-up" as a search term
    const combinedTerms = new Set(searchTerms);
    if (searchTerms.length > 1) {
        for (let i = 0; i < searchTerms.length - 1; i++) {
            combinedTerms.add(`${searchTerms[i]}-${searchTerms[i+1]}`);
        }
    }
    
    return Array.from(combinedTerms);
}

/**
 * Perform fuzzy search on icons using Fuse.js
 */
export function searchIcons(icons: IconInfo[], searchQuery: string): IconInfo[] {
    if (!searchQuery || !icons?.length) {
        return [];
    }

    // Prepare icons for searching
    const searchableIcons = icons.map(prepareIconForSearch);

    // Initialize Fuse with our configuration
    const fuse = new Fuse(searchableIcons, {
        keys: [
            { name: 'searchableText.name', weight: 2.0 },    // Highest priority for name matches
            { name: 'searchableText.tags', weight: 1.5 },    // High priority for tag matches
            { name: 'searchableText.category', weight: 0.8 }, // Lower priority for category
            { name: 'searchableText.all', weight: 0.5 },     // Lowest priority for general text
        ],
        includeScore: true,
        threshold: 0.2,
        shouldSort: true,
        findAllMatches: true,
        ignoreLocation: false,
        location: 0,
        distance: 600,
        minMatchCharLength: 2,
        useExtendedSearch: true,
    });

    const searchTerms = processSearchTerms(searchQuery);
    
    // Initialize results with all icons and zero scores
    let results: SearchResult[] = searchableIcons.map(icon => ({
        item: icon,
        score: 0,
    }));

    // Search for each term and intersect results while keeping scores
    for (const term of searchTerms) {
        const termResults = fuse.search(term);
        const termScores = new Map(termResults.map(r => [(r.item as SearchableIcon).searchableText.name, r.score || 0]));

        results = results
            .filter(r => termResults.some(tr => (tr.item as SearchableIcon).searchableText.name === r.item.searchableText.name))
            .map(r => {
                const nameWithSpaces = r.item.searchableText.name;
                const nameWithoutHyphens = r.item.searchableText.name.replace(/-/g, '');
                
                const nameWords = r.item.searchableText.name.split(/[\s-]/);
                
                // Check for exact word matches (much stronger boost)
                const exactWordMatch = 
                    nameWords.includes(term) || 
                    r.item.searchableText.name === term ||
                    nameWithoutHyphens === term;
                
                // Check for exact matches in different name formats
                const exactMatchInName = 
                    r.item.searchableText.name.includes(term) || 
                    nameWithoutHyphens.includes(term);
                
                // Check for exact matches in tags
                const exactMatchInTags = r.item.searchableText.tags.includes(term);
                
                const baseScore = termScores.get(r.item.searchableText.name) || 0;

                // Apply bonuses for exact matches (reduce score since lower is better)
                const finalScore =
                    baseScore *
                    (exactWordMatch ? 0.1  // 90% score reduction for exact word match
                        : exactMatchInName ? 0.3  // 70% score reduction for exact name match
                        : exactMatchInTags ? 0.5  // 50% score reduction for exact tag match
                        : 1);  // No reduction for fuzzy matches

                return {
                    item: r.item,
                    score: r.score + finalScore,
                };
            });
    }

    // Sort by score and return the original IconInfo objects
    return results
        .sort((a, b) => a.score - b.score)
        .map(result => ({
            name: result.item.name,
            tags: result.item.tags,
            category: result.item.category,
            featured: result.item.featured,
            version: result.item.version,
        }));
} 