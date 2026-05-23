import logger from '../logger/logger.js';
import type { Job } from './job.types.js';
import { scheduleJob } from './scheduler.js';

export class JobRegistry {
    private readonly jobs: Job[] = [];
    private timers: NodeJS.Timeout[] = [];

    register(...jobs: Job[]): void {
        this.jobs.push(...jobs);
    }

    startAll(): void {
        for (const job of this.jobs) {
            const timer = scheduleJob(job);
            this.timers.push(timer);
            logger.info(`Job "${job.name}" started`, { intervalMs: job.intervalMs });
        }
    }

    stopAll(): void {
        for (const timer of this.timers) {
            clearInterval(timer);
        }
        this.timers = [];
        logger.info('All jobs stopped');
    }
}
