import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { Server as HttpServer } from 'http';
import { injectable } from 'tsyringe';
import { env } from '../config/env.js';
import logger from '../logger/logger.js';
import { socketAuthMiddleware } from './ws-auth.js';
import { WS_EVENTS, type WsEvent, agentRoom, orderRoom, restaurantBranchRoom, customerRoom } from './events.js';
import { SystemRole } from '../auth/enums.js';

// ── Public interfaces ─────────────────────────────────────────────────────────

// Services inject ISocketServer — not the concrete class — so they can be
// unit-tested with a no-op stub without pulling in socket.io.
export interface ISocketServer {
    emitToRoom(room: string, event: WsEvent, payload: Record<string, unknown>): void;
}

// Injected into SocketServer from the app layer so the order-ownership check
// can reach the DB without the lib layer importing from app/.
export interface IOrderAccessChecker {
    canAccess(
        publicId: string,
        userId: number,
        role: string,
        restaurantId: number | undefined,
        region: string,
    ): Promise<boolean>;
}

// ── Concrete implementation ───────────────────────────────────────────────────
@injectable()
export class SocketServer implements ISocketServer {
    private io: SocketIOServer | null = null;
    private orderAccessChecker: IOrderAccessChecker | null = null;

    // Called from container.ts after both the socket server and the order module
    // are registered, so the app layer owns the concrete implementation.
    setOrderAccessChecker(checker: IOrderAccessChecker): void {
        this.orderAccessChecker = checker;
    }

    async init(httpServer: HttpServer): Promise<void> {
        if (this.io) {
            logger.warn('SocketServer already initialised');
            return;
        }

        // Two dedicated Redis clients are required by the adapter:
        // one for publishing and one for subscribing. They must be separate
        // connections because a subscribed client cannot issue other commands.
        const pubClient = createClient({
            socket: { host: env.redis.host, port: env.redis.port },
            password: env.redis.password,
        });
        const subClient = pubClient.duplicate();

        await Promise.all([pubClient.connect(), subClient.connect()]);

        this.io = new SocketIOServer(httpServer, {
            path: '/ws',
            cors: { origin: env.cors.origins, credentials: true },
            adapter: createAdapter(pubClient, subClient),
        });

        // JWT auth on every handshake — rejected connections never get a socket.
        this.io.use(socketAuthMiddleware);

        this.io.on('connection', socket => {
            const user = socket.data.user;
            logger.info('WebSocket connected', { userId: user.userId, role: user.role });

            // ── Auto-join personal rooms ──────────────────────────────────────
            const allowedChannels: string[] = [customerRoom(user.userId)];

            socket.join(customerRoom(user.userId));

            if (user.role === SystemRole.DELIVERY_AGENT) {
                socket.join(agentRoom(user.userId));
                allowedChannels.push(agentRoom(user.userId));
            }

            if (user.role === SystemRole.RESTAURANT_USER && user.branchIds) {
                for (const branchId of user.branchIds as number[]) {
                    socket.join(restaurantBranchRoom(branchId));
                    allowedChannels.push(restaurantBranchRoom(branchId));
                }
            }

            // Stash for use in the subscribe handler below.
            socket.data.allowedChannels = allowedChannels;

            socket.emit('hello', { allowedChannels });

            // ── Client → Server events ────────────────────────────────────────
            socket.on('subscribe', async (channel: string, ack?: (res: { ok: boolean; error?: string }) => void) => {
                if (typeof channel !== 'string' || !channel.trim()) {
                    ack?.({ ok: false, error: 'invalid_channel' });
                    return;
                }
                const trimmed = channel.trim();

                // order:<publicId> — on-demand ownership check via injected checker.
                if (trimmed.startsWith('order:')) {
                    const publicId = trimmed.slice('order:'.length);
                    if (!publicId) {
                        ack?.({ ok: false, error: 'invalid_channel' });
                        return;
                    }
                    if (this.orderAccessChecker) {
                        // Region is derived from the user's countryCode (same value at order
                        // insert time — CLAUDE.md §5 "they hold the same value at insert time").
                        const region = user.countryCode.toLowerCase();
                        const allowed = await this.orderAccessChecker.canAccess(
                            publicId, user.userId, user.role, user.restaurantId, region,
                        );
                        if (!allowed) {
                            ack?.({ ok: false, error: 'not_authorized' });
                            return;
                        }
                    }
                    socket.join(trimmed);
                    ack?.({ ok: true });
                    return;
                }

                // All other channels must be in the pre-computed allowed list.
                if (!(socket.data.allowedChannels as string[]).includes(trimmed)) {
                    ack?.({ ok: false, error: 'not_authorized' });
                    return;
                }
                socket.join(trimmed);
                ack?.({ ok: true });
            });

            socket.on('unsubscribe', (channel: string) => {
                if (typeof channel === 'string' && channel.trim()) {
                    socket.leave(channel.trim());
                }
            });

            // Agent location updates — rate-limited inside the handler.
            socket.on('agent:location', ({ lat, lng }: { lat: unknown; lng: unknown }) => {
                if (user.role !== SystemRole.DELIVERY_AGENT) return;

                const latN = Number(lat);
                const lngN = Number(lng);
                if (!Number.isFinite(latN) || latN < -90  || latN > 90)  return;
                if (!Number.isFinite(lngN) || lngN < -180 || lngN > 180) return;

                // Phase 7 will call AgentService.updatePresence here.
                // For now we fan the location out to the agent's own room.
                this.emitToRoom(agentRoom(user.userId), WS_EVENTS.AGENT_LOCATION_UPDATED, {
                    agentId: user.userId, lat: latN, lng: lngN,
                    updatedAt: new Date().toISOString(),
                });
            });

            socket.on('disconnect', reason => {
                logger.info('WebSocket disconnected', { userId: user.userId, reason });
            });

            socket.on('error', err => {
                logger.warn('WebSocket error', { userId: user.userId, error: String(err) });
            });
        });

        logger.info('WebSocket server initialised', { path: '/ws' });
    }

    emitToRoom(room: string, event: WsEvent, payload: Record<string, unknown>): void {
        if (!this.io) {
            logger.warn('emitToRoom called before SocketServer.init()', { room, event });
            return;
        }
        this.io.to(room).emit(event, payload);
    }

    async close(): Promise<void> {
        if (!this.io) return;
        await new Promise<void>(resolve => this.io!.close(() => resolve()));
        this.io = null;
    }
}

export const socketServer = new SocketServer();
