import { injectable } from 'tsyringe';
import { BaseCoreClient } from './base.client.js';
import type { AddressData } from './types.js';

@injectable()
export class AddressClient extends BaseCoreClient {
    getAddressById(addressId: number, correlationId?: string): Promise<AddressData> {
        return this.getInternal<AddressData>(
            `/api/internal/customer/addresses/${addressId}`,
            correlationId,
        );
    }
}
