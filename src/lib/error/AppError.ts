export default class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;

    constructor(
        message: string,
        statusCode: number = 500,
        isOperational: boolean = true
    ) {
        super(message);

        this.statusCode = statusCode;
        this.isOperational = isOperational;

        // Fixes `instanceof AppError` in TypeScript when extending built-in Error
        Object.setPrototypeOf(this, new.target.prototype);

        Error.captureStackTrace(this);
    }
}
