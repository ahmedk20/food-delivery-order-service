export class AgentPresenceEntity {
    agentId: number;
    region: string;
    isOnline: boolean;
    isAvailable: boolean;
    lastLat: number | null;
    lastLng: number | null;
    lastSeenAt: Date;
    updatedAt: Date;

    constructor(data: Partial<AgentPresenceEntity>) {
        this.agentId     = data.agentId!;
        this.region      = data.region!;
        this.isOnline    = data.isOnline ?? false;
        this.isAvailable = data.isAvailable ?? false;
        this.lastLat     = data.lastLat ?? null;
        this.lastLng     = data.lastLng ?? null;
        this.lastSeenAt  = data.lastSeenAt ?? new Date();
        this.updatedAt   = data.updatedAt ?? new Date();
    }
}
