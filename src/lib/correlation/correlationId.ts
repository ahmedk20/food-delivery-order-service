import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function correlationId(req: Request, _res: Response, next: NextFunction) {
    req.correlationId = uuidv4();
    _res.setHeader('X-CorrelationId', req.correlationId);
    next();
}
