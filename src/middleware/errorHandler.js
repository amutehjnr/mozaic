const logger = require('../utils/logger');

/**
 * 404 Not Found handler
 */
const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    error.status = 404;
    next(error);
};

/**
 * Main error handler
 */
const errorHandler = (err, req, res, next) => {
    // Set default status
    const status = err.status || 500;
    const message = err.message || 'Internal Server Error';
    
    // Log error
    logger.error(`${status} - ${message}`, {
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userId: req.user?._id,
        stack: err.stack
    });

    // Handle specific error types
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            ok: false,
            error: 'Validation error',
            details: err.errors
        });
    }

    if (err.name === 'CastError') {
        return res.status(400).json({
            ok: false,
            error: 'Invalid ID format'
        });
    }

    if (err.code === 11000) {
        const field = Object.keys(err.keyPattern)[0];
        return res.status(409).json({
            ok: false,
            error: `${field} already exists`
        });
    }

    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            ok: false,
            error: 'Invalid token'
        });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            ok: false,
            error: 'Token expired'
        });
    }

    // Determine response type
    const isApi = req.xhr || req.path.startsWith('/api/') || req.headers.accept === 'application/json';

    if (isApi) {
        // API response
        const response = {
            ok: false,
            error: message
        };

        // Add stack trace in development
        if (process.env.NODE_ENV === 'development') {
            response.stack = err.stack;
        }

        return res.status(status).json(response);
    }

    // Web response
    if (status === 404) {
        return res.status(404).render('error/404', {
            title: 'Page Not Found',
            layout: 'layouts/main',
            message: 'The page you are looking for does not exist.'
        });
    }

    if (status === 403) {
        return res.status(403).render('error/403', {
            title: 'Access Denied',
            layout: 'layouts/main',
            message: 'You do not have permission to access this page.'
        });
    }

    if (status === 429) {
        return res.status(429).render('error/429', {
            title: 'Too Many Requests',
            layout: 'layouts/main',
            message: 'You have made too many requests. Please try again later.'
        });
    }

    // Generic error page
    res.status(status).render('error/500', {
        title: 'Server Error',
        layout: 'layouts/main',
        message: process.env.NODE_ENV === 'development' ? message : 'Something went wrong. Please try again later.',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
};

module.exports = {
    notFound,
    errorHandler
};