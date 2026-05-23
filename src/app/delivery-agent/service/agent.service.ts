import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../../lib/di/tokens.js';
import { env } from '../../../lib/config/env.js';
import type { ICacheProvider } from '../../../pkg/cache/cache.interface.js';
import { AgentInActiveDeliveryError, NotOnlineError } from '../errors.js';
import { findEarningsByAgentId, getEarningsTotals } from '../repository/agent-earnings.repo.js';
import { findTasksByAgentId } from '../repository/delivery-task.repo.js';
import {
    toDeliveryTaskResponseDTO,
    type DeliveryTaskResponseDTO,
} from '../dto/delivery-task-response.dto.js';
import {
    toEarningsItemResponseDTO,
    toEarningsTotalsResponseDTO,
    type EarningsItemResponseDTO,
    type EarningsTotalsResponseDTO,
} from '../dto/earnings-response.dto.js';
import type { PresenceOnlineDTO } from '../dto/presence-online.dto.js';
import type { DeliveryStatus } from '../../delivery/enums.js';
import { buildPaginationResult } from '../../../lib/http/pagination/cursor-pagination.js';
import { parsePaginationQuery } from '../../../lib/http/pagination/parse-query.js';
import type { PaginationMeta } from '../../../lib/http/response.js';

const GEO_SET_KEY  = (region: string) => `presence:geo:${region}`;
const META_KEY     = (region: string, agentId: number) => `presence:meta:${region}:${agentId}`;
const BUSY_SET_KEY = (region: string) => `presence:busy:${region}`;

@injectable()
export class AgentService {
    constructor(
        @inject(TOKENS.CacheProvider) private readonly cache: ICacheProvider,
    ) {}

    goOnline = async (agentId: number, region: string, dto: PresenceOnlineDTO): Promise<void> => {
        await this.cache.geoAdd(GEO_SET_KEY(region), dto.lng, dto.lat, String(agentId));
        await this.cache.set(
            META_KEY(region, agentId),
            JSON.stringify({ lat: dto.lat, lng: dto.lng, lastSeenAt: new Date().toISOString() }),
            env.delivery.presenceStaleSec,
        );
    };

    goOffline = async (agentId: number, region: string): Promise<void> => {
        const isBusy = await this.cache.sIsMember(BUSY_SET_KEY(region), String(agentId))
            .catch(() => false);
        if (isBusy) throw AgentInActiveDeliveryError();

        this.cache.geoRem(GEO_SET_KEY(region), String(agentId)).catch(() => {});
        this.cache.delete(META_KEY(region, agentId)).catch(() => {});
    };

    ping = async (agentId: number, region: string, dto: PresenceOnlineDTO): Promise<void> => {
        // Meta key TTL expiry = agent went stale; they must call /online again
        const meta = await this.cache.get(META_KEY(region, agentId)).catch(() => null);
        if (!meta) throw NotOnlineError();

        this.cache.geoAdd(GEO_SET_KEY(region), dto.lng, dto.lat, String(agentId)).catch(() => {});
        await this.cache.set(
            META_KEY(region, agentId),
            JSON.stringify({ lat: dto.lat, lng: dto.lng, lastSeenAt: new Date().toISOString() }),
            env.delivery.presenceStaleSec,
        );
    };

    getMyTasks = async (
        agentId: number,
        region: string,
        query: Record<string, any>,
    ): Promise<{ data: DeliveryTaskResponseDTO[]; meta: PaginationMeta }> => {
        const { cursor, limit } = parsePaginationQuery<{ deliveryId: number }, 'deliveryId'>(
            query, ['deliveryId'], 'deliveryId',
        );

        const rawStatus = query.status as string | undefined;
        const statusFilter = rawStatus
            ? rawStatus.split(',').filter((s): s is DeliveryStatus =>
                ['assigned', 'accepted', 'picked', 'delivered', 'rejected'].includes(s))
            : undefined;

        const rows = await findTasksByAgentId(agentId, region, {
            statusFilter,
            cursor: cursor != null ? Number(cursor) : undefined,
            limit,
        });

        const { rows: page, hasMore, nextCursor } = buildPaginationResult(rows, limit, 'deliveryId', 'desc');
        return {
            data: page.map(toDeliveryTaskResponseDTO),
            meta: { hasMore, nextCursor, count: page.length },
        };
    };

    getMyEarnings = async (
        agentId: number,
        region: string,
        query: Record<string, any>,
    ): Promise<{
        data: EarningsItemResponseDTO[];
        meta: PaginationMeta;
        totals: EarningsTotalsResponseDTO[];
    }> => {
        const { cursor, limit } = parsePaginationQuery<{ id: number }, 'id'>(
            query, ['id'], 'id',
        );

        const status = query.status as 'pending' | 'paid' | undefined;
        const from   = query.from ? new Date(query.from as string) : undefined;
        const to     = query.to   ? new Date(query.to   as string) : undefined;
        const parsedCursor = cursor != null ? Number(cursor) : undefined;

        const [rows, totals] = await Promise.all([
            findEarningsByAgentId(agentId, region, { status, from, to, cursor: parsedCursor, limit }),
            getEarningsTotals(agentId, region, from, to),
        ]);

        const { rows: page, hasMore, nextCursor } = buildPaginationResult(rows, limit, 'id', 'desc');

        return {
            data:   page.map(toEarningsItemResponseDTO),
            meta:   { hasMore, nextCursor, count: page.length },
            totals: toEarningsTotalsResponseDTO(totals),
        };
    };
}
