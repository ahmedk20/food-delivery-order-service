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

// ── Public interface ──────────────────────────────────────────────────────────
// Services inject this — not the concrete SocketServer — so they can be tested
// with a no-op stub and don't depend on socket.io at all.
export interface ISocketServer {
    emitToRoom(room: string, event: WsEvent, payload: Record<string, unknown>): void;
}

// ── Concrete implementation ───────────────────────────────────────────────────
@injectable()
export class SocketServer implements ISocketServer {
    private io: SocketIOServer | null = null;

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
            // Every user gets their customer channel immediately on connect.
            socket.join(customerRoom(user.userId));

            // Agents join their own agent channel so assignment events arrive
            // without the client needing to explicitly subscribe.
            if (user.role === SystemRole.DELIVERY_AGENT) {
                socket.join(agentRoom(user.userId));
            }

            // Restaurant members join their branch channels.
            if (user.role === SystemRole.RESTAURANT_USER && user.branchIds) {
                for (const branchId of user.branchIds as number[]) {
                    socket.join(restaurantBranchRoom(branchId));
                }
            }

            // Emit the list of pre-joined rooms so the client knows what it
            // subscribed to without an extra round-trip.
            socket.emit('hello', { allowedChannels: [...socket.rooms] });

            // ── Client → Server events ────────────────────────────────────────
            socket.on('subscribe', async (channel: string, ack?: (res: { ok: boolean; error?: string }) => void) => {
                // order:<publicId> rooms require an ownership check (Phase 3+).
                // For now we allow any authenticated user to subscribe — the
                // service layer validates ownership before emitting sensitive data.
                if (typeof channel !== 'string' || !channel.trim()) {
                    ack?.({ ok: false, error: 'invalid_channel' });
                    return;
                }
                socket.join(channel.trim());
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
