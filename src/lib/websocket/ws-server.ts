import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'http';
import logger from '../logger/logger.js';
import { SystemRole } from '../auth/enums.js';
import { verifyWsToken, type WsUser } from './ws-auth.js';
import {
    agentRoom,
    orderRoom,
    restaurantBranchRoom,
    WS_EVENTS,
    type WsEvent,
} from './events.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
const AGENT_LOCATION_MIN_INTERVAL_MS = 1_000;

interface AuthedSocket extends WebSocket {
    isAlive: boolean;
    user: WsUser;
    rooms: Set<string>;
    lastLocationAt: number;
}

interface IncomingMessageEnvelope {
    event: string;
    data?: Record<string, any>;
}

interface OutgoingEnvelope {
    event: WsEvent;
    data: Record<string, any>;
}

class WsServer {
    private wss: WebSocketServer | null = null;
    private rooms = new Map<string, Set<AuthedSocket>>();
    private heartbeatTimer: NodeJS.Timeout | null = null;

    init(httpServer: HttpServer): void {
        if (this.wss) {
            logger.warn('WebSocket server already initialized');
            return;
        }

        this.wss = new WebSocketServer({ noServer: true });

        httpServer.on('upgrade', (req, socket, head) => {
            // Only accept upgrades on the /ws path
            const url = req.url ?? '';
            const pathOnly = url.split('?')[0];
            if (pathOnly !== '/ws') {
                socket.destroy();
                return;
            }

            verifyWsToken(req.headers.cookie)
                .then(user => {
                    this.wss!.handleUpgrade(req, socket, head, ws => {
                        const authed = ws as AuthedSocket;
                        authed.user = user;
                        authed.isAlive = true;
                        authed.rooms = new Set();
                        authed.lastLocationAt = 0;
                        this.wss!.emit('connection', authed, req);
                    });
                })
                .catch(err => {
                    logger.warn('WebSocket auth failed', { error: String(err) });
                    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                    socket.destroy();
                });
        });

        this.wss.on('connection', (ws: AuthedSocket, _req: IncomingMessage) => {
            logger.info('WebSocket connected', { userId: ws.user.userId, role: ws.user.role });

            // Auto-join role-specific personal room (e.g. agents always receive their assignments)
            if (ws.user.role === SystemRole.DELIVERY_AGENT) {
                this.joinRoom(ws, agentRoom(ws.user.userId));
            }

            ws.on('pong', () => { ws.isAlive = true; });

            ws.on('message', (raw: Buffer) => {
                this.handleMessage(ws, raw).catch(err => {
                    logger.warn('WebSocket message handler failed', {
                        userId: ws.user.userId,
                        error: String(err),
                    });
                });
            });

            ws.on('close', () => {
                this.removeFromAllRooms(ws);
                logger.info('WebSocket disconnected', { userId: ws.user.userId });
            });

            ws.on('error', err => {
                logger.warn('WebSocket error', { userId: ws.user.userId, error: String(err) });
            });
        });

        this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
    }

    /**
     * Broadcast a server event to every socket joined to `room`.
     * Best-effort: dead sockets are skipped silently.
     */
    emit(room: string, event: WsEvent, data: Record<string, any>): void {
        const sockets = this.rooms.get(room);
        if (!sockets || sockets.size === 0) return;

        const envelope: OutgoingEnvelope = { event, data };
        const payload = JSON.stringify(envelope);

        for (const ws of sockets) {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(payload);
                } catch (err) {
                    logger.warn('WebSocket emit send failed', { room, event, error: String(err) });
                }
            }
        }
    }

    async close(): Promise<void> {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        if (!this.wss) return;
        await new Promise<void>(resolve => this.wss!.close(() => resolve()));
        this.rooms.clear();
        this.wss = null;
    }

    // -------- internal --------

    private async handleMessage(ws: AuthedSocket, raw: Buffer): Promise<void> {
        let parsed: IncomingMessageEnvelope;
        try {
            parsed = JSON.parse(raw.toString());
        } catch {
            this.sendError(ws, 'invalid_json');
            return;
        }

        const data = parsed.data ?? {};
        switch (parsed.event) {
            case 'join:order': {
                const orderId = Number(data.orderId);
                if (!Number.isFinite(orderId) || orderId <= 0) {
                    this.sendError(ws, 'invalid_orderId');
                    return;
                }
                this.joinRoom(ws, orderRoom(orderId));
                return;
            }
            case 'join:restaurant': {
                const branchId = Number(data.branchId);
                if (!Number.isFinite(branchId) || branchId <= 0) {
                    this.sendError(ws, 'invalid_branchId');
                    return;
                }
                if (ws.user.role !== SystemRole.RESTAURANT_USER && ws.user.role !== SystemRole.SYSTEM_ADMIN) {
                    this.sendError(ws, 'forbidden');
                    return;
                }
                if (
                    ws.user.role === SystemRole.RESTAURANT_USER &&
                    (!ws.user.branchIds || !ws.user.branchIds.includes(branchId))
                ) {
                    this.sendError(ws, 'forbidden');
                    return;
                }
                this.joinRoom(ws, restaurantBranchRoom(branchId));
                return;
            }
            case 'agent:location': {
                if (ws.user.role !== SystemRole.DELIVERY_AGENT) {
                    this.sendError(ws, 'forbidden');
                    return;
                }
                const lat = Number(data.lat);
                const lng = Number(data.lng);
                if (
                    !Number.isFinite(lat) || lat < -90  || lat > 90 ||
                    !Number.isFinite(lng) || lng < -180 || lng > 180
                ) {
                    this.sendError(ws, 'invalid_coordinates');
                    return;
                }
                const now = Date.now();
                if (now - ws.lastLocationAt < AGENT_LOCATION_MIN_INTERVAL_MS) {
                    return; // throttle silently — high-frequency GPS pings
                }
                ws.lastLocationAt = now;

                // Phase 6 will wire this into AgentService.updatePresence — emit-only for now.
                this.emit(agentRoom(ws.user.userId), WS_EVENTS.AGENT_LOCATION, {
                    agentId: ws.user.userId,
                    lat,
                    lng,
                    updatedAt: new Date().toISOString(),
                });
                return;
            }
            default:
                this.sendError(ws, 'unknown_event');
        }
    }

    private joinRoom(ws: AuthedSocket, room: string): void {
        let set = this.rooms.get(room);
        if (!set) {
            set = new Set();
            this.rooms.set(room, set);
        }
        set.add(ws);
        ws.rooms.add(room);
    }

    private removeFromAllRooms(ws: AuthedSocket): void {
        for (const room of ws.rooms) {
            const set = this.rooms.get(room);
            if (!set) continue;
            set.delete(ws);
            if (set.size === 0) this.rooms.delete(room);
        }
        ws.rooms.clear();
    }

    private sendError(ws: AuthedSocket, code: string): void {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(JSON.stringify({ event: 'error', data: { code } }));
        } catch { /* ignore */ }
    }

    private heartbeat(): void {
        if (!this.wss) return;
        for (const client of this.wss.clients) {
            const ws = client as AuthedSocket;
            if (!ws.isAlive) {
                ws.terminate();
                continue;
            }
            ws.isAlive = false;
            try { ws.ping(); } catch { /* ignore */ }
        }
    }
}

export const wsServer = new WsServer();
