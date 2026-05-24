import { container } from '../../lib/di/container.js';
import { TOKENS } from '../../lib/di/tokens.js';
import { env } from '../../lib/config/env.js';
import type { AssignmentService } from './service/assignment.service.js';
import type { Job } from '../../lib/jobs/job.types.js';

export function createAssignmentJobs(): Job[] {
    return env.regions.map(region => ({
        name:       `assignment-tick:${region}`,
        intervalMs: env.delivery.agentAcceptTimeoutSec * 1_000,
        handler: async () => {
            const svc = container.resolve<AssignmentService>(TOKENS.AssignmentService);
            await svc.tickRegion(region);
        },
    }));
}
