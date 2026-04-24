import type { FilterParams, PaginationParams } from './cursor-pagination.js';

export function parsePaginationQuery<T, K extends keyof T>(
    query: Record<string, any>,
    allowedSortFields: K[],
    defaultSort: K
): PaginationParams<T, K> {
    const rawLimit = Number(query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
    const sortBy = allowedSortFields.includes(query.sortBy) ? query.sortBy : defaultSort;
    const sortOrder = query.sortOrder === 'asc' || query.sortOrder === 'desc' ? query.sortOrder : 'desc';
    const cursor = query.cursor ?? undefined;

    return { cursor, limit, sortBy, sortOrder };
}

export function parseFilters<T, K extends keyof T>(
    query: Record<string, any>,
    allowedFields: K[]
): FilterParams<T, K>[] {
    const filters: FilterParams<T, K>[] = [];

    for (const rawKey of Object.keys(query)) {
        const match = rawKey.match(/^(\w+)\[(\w+)\]$/);
        if (!match) continue;

        const [, field, operator] = match;
        if (!allowedFields.includes(field as K)) continue;

        const value = query[rawKey];

        switch (operator) {
            case 'eq': case 'like': case 'lt': case 'gt': case 'lte': case 'gte':
                filters.push({ filter: field as K, operator, value: String(value) });
                break;
            case 'in': case 'not_in':
                filters.push({ filter: field as K, operator, value: String(value).split(',') });
                break;
            case 'is_null': case 'is_not_null':
                filters.push({ filter: field as K, operator });
                break;
        }
    }

    return filters;
}
