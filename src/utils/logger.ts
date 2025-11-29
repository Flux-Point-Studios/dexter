/**
 * Lightweight logger for Dexter SDK diagnostics.
 * Outputs to console with structured context for debugging DEX API issues.
 */

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface LogContext {
    [key: string]: unknown;
}

const LOG_PREFIX = '[DEXTER]';

function formatContext(context?: LogContext): string {
    if (!context || Object.keys(context).length === 0) return '';
    try {
        return ' ' + JSON.stringify(context);
    } catch {
        return ' [unserializable context]';
    }
}

export const logger = {
    debug(message: string, context?: LogContext): void {
        if (process.env.DEXTER_LOG_LEVEL === 'debug') {
            console.debug(`${LOG_PREFIX}[DEBUG] ${message}${formatContext(context)}`);
        }
    },

    info(message: string, context?: LogContext): void {
        console.info(`${LOG_PREFIX}[INFO] ${message}${formatContext(context)}`);
    },

    warn(message: string, context?: LogContext): void {
        console.warn(`${LOG_PREFIX}[WARN] ${message}${formatContext(context)}`);
    },

    error(message: string, context?: LogContext): void {
        console.error(`${LOG_PREFIX}[ERROR] ${message}${formatContext(context)}`);
    },
};

