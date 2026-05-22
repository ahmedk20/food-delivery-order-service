export type TransactionType   = 'charge' | 'cod_collection' | 'commission' | 'refund' | 'payout' | 'adjustment';
export type TransactionStatus = 'pending' | 'succeeded' | 'failed' | 'reversed';
export type TransactionMethod = 'online' | 'cod' | 'bank_transfer' | 'system';
