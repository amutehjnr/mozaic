const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Define log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4
};

// Define log colors
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'white'
};

// Add colors to winston
winston.addColors(colors);

// Determine log level based on environment
const level = () => {
    const env = process.env.NODE_ENV || 'development';
    const isDevelopment = env === 'development';
    return isDevelopment ? 'debug' : 'warn';
};

// Define log format
const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}`
    )
);

// Define transports
const transports = [
    // Console transport
    new winston.transports.Console(),
    
    // Error log file
    new DailyRotateFile({
        filename: path.join(__dirname, '../../logs/error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '14d',
        format: winston.format.combine(
            winston.format.uncolorize(),
            winston.format.json()
        )
    }),
    
    // Combined log file
    new DailyRotateFile({
        filename: path.join(__dirname, '../../logs/combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
        format: winston.format.combine(
            winston.format.uncolorize(),
            winston.format.json()
        )
    })
];

// Add HTTP logs in development
if (process.env.NODE_ENV === 'development') {
    transports.push(
        new DailyRotateFile({
            filename: path.join(__dirname, '../../logs/http-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'http',
            maxSize: '20m',
            maxFiles: '7d',
            format: winston.format.combine(
                winston.format.uncolorize(),
                winston.format.json()
            )
        })
    );
}

// Create logger instance
const logger = winston.createLogger({
    level: level(),
    levels,
    format,
    transports,
    exceptionHandlers: [
        new winston.transports.File({ 
            filename: path.join(__dirname, '../../logs/exceptions.log') 
        })
    ],
    rejectionHandlers: [
        new winston.transports.File({ 
            filename: path.join(__dirname, '../../logs/rejections.log') 
        })
    ]
});

/**
 * HTTP request logger middleware
 */
const httpLogger = (req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms - ${req.ip}`;
        
        if (res.statusCode >= 500) {
            logger.error(message);
        } else if (res.statusCode >= 400) {
            logger.warn(message);
        } else {
            logger.http(message);
        }
    });
    
    next();
};

/**
 * Log with context
 */
const logWithContext = (level, message, context = {}) => {
    const logMessage = typeof message === 'string' ? message : JSON.stringify(message);
    const logContext = {
        ...context,
        timestamp: new Date().toISOString()
    };
    
    logger[level](logMessage, logContext);
};

/**
 * Create child logger with fixed context
 */
const createContextLogger = (defaultContext) => {
    return {
        error: (message, context = {}) => logWithContext('error', message, { ...defaultContext, ...context }),
        warn: (message, context = {}) => logWithContext('warn', message, { ...defaultContext, ...context }),
        info: (message, context = {}) => logWithContext('info', message, { ...defaultContext, ...context }),
        http: (message, context = {}) => logWithContext('http', message, { ...defaultContext, ...context }),
        debug: (message, context = {}) => logWithContext('debug', message, { ...defaultContext, ...context })
    };
};

module.exports = logger;
module.exports.httpLogger = httpLogger;
module.exports.logWithContext = logWithContext;
module.exports.createContextLogger = createContextLogger;