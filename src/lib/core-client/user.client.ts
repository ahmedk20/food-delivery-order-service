import { injectable } from 'tsyringe';
import { BaseCoreClient } from './base.client.js';
import type { UserData } from './types.js';

@injectable()
export class UserClient extends BaseCoreClient {
    getUserById(userId: number, correlationId?: string): Promise<UserData> {
        return this.getInternal<UserData>(`/api/internal/users/${userId}`, correlationId);
    }
}
