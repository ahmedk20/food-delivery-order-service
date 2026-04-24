type LogLevel = 'info' | 'error' | 'warn' | 'debug';

interface LogMetadata {
    [key: string]: unknown;
}

interface LogObject extends LogMetadata {
    level: LogLevel;
    message: string;
    timestamp: number;
}

export class Logger {
    private static instance: Logger;

    private constructor() {}

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    private log(level: LogLevel, message: string, metadata: LogMetadata = {}): void {
        const logObject: LogObject = {
            level,
            message,
            timestamp: Date.now(),
            ...metadata,
        };
        console.log(JSON.stringify(logObject));
    }

    public info(message: string, metadata?: LogMetadata): void {
        this.log('info', message, metadata);
    }

    public error(message: string, metadata?: LogMetadata): void {
        this.log('error', message, metadata);
    }

    public warn(message: string, metadata?: LogMetadata): void {
        this.log('warn', message, metadata);
    }

    public debug(message: string, metadata?: LogMetadata): void {
        this.log('debug', message, metadata);
    }
}

const logger = Logger.getInstance();
export default logger;
