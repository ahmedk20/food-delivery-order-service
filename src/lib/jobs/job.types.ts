export interface Job {
    name: string;
    intervalMs: number;
    handler(): Promise<void>;
}
