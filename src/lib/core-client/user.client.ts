import { injectable } from 'tsyringe';
import { BaseCoreClient } from './base.client.js';
import type { UserData } from '../http/core-service-client.interface.js';

@injectable()
export class UserClient extends BaseCoreClient {
    getUserById(userId: number, correlationId?: string): Promise<UserData> {
        return this.getInternal<UserData>(`/api/internal/users/${userId}`, correlationId);
    }
}
