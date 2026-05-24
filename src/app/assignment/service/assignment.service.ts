import { inject, injectable } from 'tsyringe';
import { container } from '../../../lib/di/container.js';
import { TOKENS } from '../../../lib/di/tokens.js';
import { db } from '../../../lib/knex/knex.js';
import { env } from '../../../lib/config/env.js';
import logger from '../../../lib/logger/logger.js';
import type { ICacheProvider } from '../../../pkg/cache/cache.interface.js';
import type { ISocketServer } from '../../../lib/websocket/ws-server.js';
import { WS_EVENTS, agentRoom, orderRoom, customerRoom, restaurantBranchRoom } from '../../../lib/websocket/events.js';
import type { BranchClient } from '../../../lib/core-client/branch.client.js';
import {
    findReadyUnassigned,
    claimReadyOrderForAgent,
} from '../../order/repository/order.repo.js';
import type { OrderEntity } from '../../order/entity/order.entity.js';
import {
    OfferExpiredError,
    NotInCandidateListError,
    OrderAlreadyClaimedError,
    OrderNotReadyError,
} from '../errors.js';

const GEO_KEY  = (region: string) => `presence:geo:${region}`;
const META_KEY  = (region: string, agentId: number) => `presence:meta:${region}:${agentId}`;
const BUSY_KEY  = (region: string) => `presence:busy:${region}`;

const ATTEMPT_TTL = 3_600; // 1 hour — counter per order resets once the order is assigned

@injectable()
export class AssignmentService {
    constructor(
        @inject(TOKENS.CacheProvider) private readonly cache: ICacheProvider,
        @inject(TOKENS.BranchClient)  private readonly branchClient: BranchClient,
    ) {}

    // Lazy socket resolution avoids circular DI with the HTTP server bootstrap.
    private get socket(): ISocketServer {
        return container.resolve<ISocketServer>(TOKENS.SocketServer);
    }

    static offerKey(orderPublicId: string): string {
        return `assign:offer:${orderPublicId}`;
    }

    static claimKey(orderPublicId: string): string {
        return `assign:claim:${orderPublicId}`;
    }

    static attemptsKey(orderPublicId: string): string {
        return `assign:attempts:${orderPublicId}`;
    }

    /** Worker entrypoint: scans up to BATCH ready orders in the region and broadcasts offers. */
    async tickRegion(region: string): Promise<{ processed: number; offered: number; skipped: number }> {
        const orders = await findReadyUnassigned(env.delivery.assignmentBatchSize, region);
        let offered = 0;
        let skipped = 0;
        for (const order of orders) {
            const result = await this.tryAssign(order, region).catch((err) => {
                logger.error('AssignmentService.tryAssign failed', {
                    publicId: order.publicId,
                    error:    (err as Error).message,
                });
                return 'error' as const;
            });
            if (result === 'offered') offered++;
            else skipped++;
        }
        return { processed: orders.length, offered, skipped };
    }

    /**
     * GEOSEARCH for nearby agents → broadcast task.offered to all candidates.
     * The acceptance is owned by claim() (POST /agents/tasks/:publicId/accept).
     */
    async tryAssign(
        order: OrderEntity,
        region: string,
    ): Promise<'offered' | 'skipped' | 'exhausted' | 'no-candidates'> {
        // Already broadcasting? Don't double-offer until the current offer expires.
        const existing = await this.cache.get(AssignmentService.offerKey(order.publicId));
        if (existing !== null) return 'skipped';

        const attemptsRaw = await this.cache.get(AssignmentService.attemptsKey(order.publicId));
        const attempts    = Number(attemptsRaw ?? 0);
        if (attempts >= env.delivery.maxReassignmentAttempts) {
            this.socket.emitToRoom('admin:alerts', WS_EVENTS.ASSIGNMENT_EXHAUSTED, {
                orderId: order.publicId,
                attempts,
            });
            return 'exhausted';
        }

        // GEOSEARCH uses snapshotted branch coords — zero network calls on the hot path.
        const candidates = await this._findCandidates(region, order.deliveryLng, order.deliveryLat);
        if (candidates.length === 0) {
            await this.cache.incr(AssignmentService.attemptsKey(order.publicId));
            await this.cache.expire(AssignmentService.attemptsKey(order.publicId), ATTEMPT_TTL);
            return 'no-candidates';
        }

        // Atomic SETNX — concurrent worker ticks across processes can't both broadcast the same offer.
        const offerSet = await this.cache.trySet(
            AssignmentService.offerKey(order.publicId),
            candidates.join(','),
            env.delivery.offerTtlSec,
        );
        if (!offerSet) return 'skipped';

        await this.cache.incr(AssignmentService.attemptsKey(order.publicId));
        await this.cache.expire(AssignmentService.attemptsKey(order.publicId), ATTEMPT_TTL);

        // Branch name/address is display-only — cache hit expected; failure just omits it.
        const branch = await this.branchClient.getBranchMetadata(order.branchId).catch(() => null);
        const expiresAt = new Date(Date.now() + env.delivery.offerTtlSec * 1_000).toISOString();

        const payload = {
            orderId:       order.publicId,
            branchId:      order.branchId,
            branchRegion:  branch?.region ?? order.region,
            dropoff:       { lat: order.deliveryLat, lng: order.deliveryLng },
            total:         order.total,
            currency:      order.currency,
            paymentMethod: order.paymentMethod,
            expiresAt,
        };

        for (const agentId of candidates) {
            this.socket.emitToRoom(agentRoom(agentId), WS_EVENTS.TASK_OFFERED, payload);
        }

        logger.info('assignment.broadcast', {
            publicId: order.publicId,
            candidates,
            attempt:  attempts + 1,
        });
        return 'offered';
    }

    /**
     * Atomic claim. First caller wins via SETNX. Updates DB only if order is
     * still READY and unassigned (guards against race between multiple accepts).
     */
    async claim(publicId: string, agentId: number, region: string): Promise<void> {
        const offered = await this.cache.get(AssignmentService.offerKey(publicId));
        if (!offered) throw OfferExpiredError();

        const candidateIds = offered.split(',').map(Number);
        if (!candidateIds.includes(agentId)) throw NotInCandidateListError();

        // SETNX claim lock — only the first acceptor wins.
        const won = await this.cache.trySet(
            AssignmentService.claimKey(publicId),
            String(agentId),
            env.delivery.claimTtlSec,
        );
        if (!won) throw OrderAlreadyClaimedError();

        const trx = await db(region).transaction();
        let updated: OrderEntity | undefined;
        try {
            updated = await claimReadyOrderForAgent(publicId, agentId, region, trx);
            if (!updated) {
                await this.cache.delete(AssignmentService.claimKey(publicId));
                throw OrderNotReadyError();
            }
            await trx.commit();
        } catch (err) {
            await trx.rollback();
            await this.cache.delete(AssignmentService.claimKey(publicId));
            throw err;
        }

        await this.cache.sAdd(BUSY_KEY(region), String(agentId));

        // Fan-out: winner gets task detail, losers get offer.cancelled,
        // customer + branch get order.status_changed.
        const losers = candidateIds.filter(id => id !== agentId);
        this.socket.emitToRoom(agentRoom(agentId), WS_EVENTS.TASK_ASSIGNED, {
            orderId:    updated.publicId,
            status:     'assigned',
            assignedAt: updated.assignedAt?.toISOString(),
        });
        for (const loserId of losers) {
            this.socket.emitToRoom(agentRoom(loserId), WS_EVENTS.OFFER_CANCELLED, {
                orderId: publicId,
                reason:  'claimed_by_other',
            });
        }
        this.socket.emitToRoom(customerRoom(updated.customerId), WS_EVENTS.ORDER_STATUS_CHANGED, {
            orderId:   updated.publicId,
            status:    'assigned',
            updatedAt: new Date().toISOString(),
        });
        this.socket.emitToRoom(restaurantBranchRoom(updated.branchId), WS_EVENTS.ORDER_STATUS_CHANGED, {
            orderId:   updated.publicId,
            status:    'assigned',
            updatedAt: new Date().toISOString(),
        });
        this.socket.emitToRoom(orderRoom(updated.publicId), WS_EVENTS.ORDER_STATUS_CHANGED, {
            orderId:   updated.publicId,
            status:    'assigned',
            updatedAt: new Date().toISOString(),
        });

        await this.cache.delete(AssignmentService.offerKey(publicId));
    }

    /** Agent declines an offer. Trims the candidate list; drops it if no one is left. */
    async reject(publicId: string, agentId: number): Promise<void> {
        const offered = await this.cache.get(AssignmentService.offerKey(publicId));
        if (!offered) throw OfferExpiredError();

        const candidateIds = offered.split(',').map(Number);
        if (!candidateIds.includes(agentId)) throw NotInCandidateListError();

        const remaining = candidateIds.filter(id => id !== agentId);
        if (remaining.length === 0) {
            await this.cache.delete(AssignmentService.offerKey(publicId));
        } else {
            const remainingTtl = await this.cache.ttl(AssignmentService.offerKey(publicId));
            await this.cache.trySet(
                AssignmentService.offerKey(publicId),
                remaining.join(','),
                Math.max(remainingTtl, 1),
            );
        }
    }

    /**
     * Admin force-assign — bypasses offer/candidate flow entirely.
     * Updates order atomically; marks agent busy.
     */
    async adminAssign(publicId: string, agentId: number, region: string): Promise<void> {
        const won = await this.cache.trySet(
            AssignmentService.claimKey(publicId),
            String(agentId),
            env.delivery.claimTtlSec,
        );
        if (!won) throw OrderAlreadyClaimedError();

        const trx = await db(region).transaction();
        let updated: OrderEntity | undefined;
        try {
            updated = await claimReadyOrderForAgent(publicId, agentId, region, trx);
            if (!updated) {
                await this.cache.delete(AssignmentService.claimKey(publicId));
                throw OrderNotReadyError();
            }
            await trx.commit();
        } catch (err) {
            await trx.rollback();
            await this.cache.delete(AssignmentService.claimKey(publicId));
            throw err;
        }

        await this.cache.sAdd(BUSY_KEY(region), String(agentId));
        await this.cache.delete(AssignmentService.offerKey(publicId));

        this.socket.emitToRoom(agentRoom(agentId), WS_EVENTS.TASK_ASSIGNED, {
            orderId:    updated.publicId,
            status:     'assigned',
            assignedAt: updated.assignedAt?.toISOString(),
        });
        this.socket.emitToRoom(customerRoom(updated.customerId), WS_EVENTS.ORDER_STATUS_CHANGED, {
            orderId:   updated.publicId,
            status:    'assigned',
            updatedAt: new Date().toISOString(),
        });
        this.socket.emitToRoom(restaurantBranchRoom(updated.branchId), WS_EVENTS.ORDER_STATUS_CHANGED, {
            orderId:   updated.publicId,
            status:    'assigned',
            updatedAt: new Date().toISOString(),
        });
        this.socket.emitToRoom(orderRoom(updated.publicId), WS_EVENTS.ORDER_STATUS_CHANGED, {
            orderId:   updated.publicId,
            status:    'assigned',
            updatedAt: new Date().toISOString(),
        });
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _findCandidates(region: string, lng: number, lat: number): Promise<number[]> {
        const overscan = env.delivery.candidates * 4;
        const raw = await this.cache.geosearchByRadius(
            GEO_KEY(region), lng, lat, env.delivery.assignmentRadiusMeters, overscan,
        );

        const result: number[] = [];
        for (const idStr of raw) {
            const agentId = Number(idStr);
            if (!Number.isFinite(agentId)) continue;
            const meta   = await this.cache.get(META_KEY(region, agentId)).catch(() => null);
            const isBusy = await this.cache.sIsMember(BUSY_KEY(region), idStr).catch(() => false);
            if (meta && !isBusy) {
                result.push(agentId);
                if (result.length >= env.delivery.candidates) break;
            }
        }
        return result;
    }
}
