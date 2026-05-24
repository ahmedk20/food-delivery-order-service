import { injectable } from 'tsyringe';
import { BaseCoreClient } from './base.client.js';
import type { BranchMetadata } from './types.js';

@injectable()
export class BranchClient extends BaseCoreClient {
    getBranchMetadata(branchId: number, correlationId?: string): Promise<BranchMetadata> {
        return this.getInternal<BranchMetadata>(
            `/api/internal/branches/${branchId}`,
            correlationId,
        );
    }
}
