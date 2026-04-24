import type { Knex } from 'knex';

export interface PaginationParams<T, K extends keyof T = keyof T> {
    cursor?: T[K];
    limit: number;
    sortBy: K;
    sortOrder: 'asc' | 'desc';
}

export type FilterParams<T, K extends keyof T = keyof T> =
    | { filter: K; operator: 'eq' | 'like' | 'lt' | 'gt' | 'lte' | 'gte'; value: string }
    | { filter: K; operator: 'in' | 'not_in'; value: string[] }
    | { filter: K; operator: 'is_null' | 'is_not_null' };

export interface PaginationMeta {
    nextCursor: number | null;
    hasMore: boolean;
    count: number;
}

export function applyCursorPagination<T, K extends keyof T>(
    query: Knex.QueryBuilder,
    params: PaginationParams<T, K>
): Knex.QueryBuilder {
    const { cursor, limit, sortBy, sortOrder } = params;

    if (cursor !== undefined && cursor !== null) {
        const op = sortOrder === 'asc' ? '>' : '<';
        query = query.where(sortBy as string, op, cursor as any);
    }

    return query.orderBy(sortBy as string, sortOrder).limit(limit + 1);
}

export function applyFilters<T>(
    query: Knex.QueryBuilder,
    filters: FilterParams<T>[]
): Knex.QueryBuilder {
    for (const filter of filters) {
        switch (filter.operator) {
            case 'eq':   query.where(filter.filter as string, filter.value); break;
            case 'lt':   query.where(filter.filter as string, '<', filter.value); break;
            case 'gt':   query.where(filter.filter as string, '>', filter.value); break;
            case 'lte':  query.where(filter.filter as string, '<=', filter.value); break;
            case 'gte':  query.where(filter.filter as string, '>=', filter.value); break;
            case 'like': query.where(filter.filter as string, 'like', `%${filter.value}%`); break;
            case 'in':       query.whereIn(filter.filter as string, filter.value); break;
            case 'not_in':   query.whereNotIn(filter.filter as string, filter.value); break;
            case 'is_null':      query.whereNull(filter.filter as string); break;
            case 'is_not_null':  query.whereNotNull(filter.filter as string); break;
        }
    }
    return query;
}

export function buildPaginationResult<T, K extends keyof T>(
    rows: T[],
    limit: number,
    sortBy: K,
    sortOrder: 'asc' | 'desc'
) {
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit);
    const nextCursor = hasMore ? (data[data.length - 1][sortBy] as unknown as number) : null;
    return { rows: data, hasMore, nextCursor };
}
