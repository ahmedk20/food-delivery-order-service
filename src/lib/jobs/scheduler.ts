import logger from '../logger/logger.js';
import type { Job } from './job.types.js';

export function scheduleJob(job: Job): NodeJS.Timeout {
    return setInterval(() => {
        job.handler().catch(err =>
            logger.error(`Job "${job.name}" error`, { err }),
        );
    }, job.intervalMs);
}
