const crypto = require('crypto');
const moment = require('moment');

/**
 * Generate random token
 */
const generateToken = (bytes = 32) => {
    return crypto.randomBytes(bytes).toString('hex');
};

/**
 * Generate random numeric code
 */
const generateCode = (length = 6) => {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
};

/**
 * Format currency
 */
const formatCurrency = (amount, currency = 'NGN') => {
    const formatter = new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return formatter.format(amount);
};

/**
 * Format date
 */
const formatDate = (date, format = 'YYYY-MM-DD HH:mm:ss') => {
    return moment(date).format(format);
};

/**
 * Calculate percentage
 */
const calculatePercentage = (value, total) => {
    if (total === 0) return 0;
    return (value / total) * 100;
};

/**
 * Mask sensitive data
 */
const maskString = (str, visibleChars = 4, maskChar = '*') => {
    if (!str) return '';
    if (str.length <= visibleChars) return str;
    
    const visible = str.slice(-visibleChars);
    const masked = maskChar.repeat(str.length - visibleChars);
    return masked + visible;
};

/**
 * Mask email
 */
const maskEmail = (email) => {
    if (!email) return '';
    
    const [local, domain] = email.split('@');
    if (!domain) return email;
    
    const maskedLocal = local.charAt(0) + '*'.repeat(local.length - 1);
    return `${maskedLocal}@${domain}`;
};

/**
 * Generate pagination object
 */
const paginate = (page = 1, limit = 20, total) => {
    page = Math.max(1, parseInt(page));
    limit = Math.max(1, parseInt(limit));
    
    const skip = (page - 1) * limit;
    const pages = Math.ceil(total / limit);
    
    return {
        page,
        limit,
        skip,
        total,
        pages,
        hasNext: page < pages,
        hasPrev: page > 1,
        nextPage: page < pages ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null
    };
};

/**
 * Build query string from object
 */
const buildQueryString = (params) => {
    return Object.entries(params)
        .filter(([_, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
};

/**
 * Extract client IP
 */
const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',').pop() : req.connection.remoteAddress;
    return ip || req.ip;
};

/**
 * Get user agent info
 */
const parseUserAgent = (userAgent) => {
    // Basic parsing, can be enhanced with ua-parser-js
    const ua = userAgent || '';
    const isMobile = /mobile|android|iphone|ipad|ipod/i.test(ua);
    const isBot = /bot|crawler|spider|crawling/i.test(ua);
    
    return {
        raw: ua,
        isMobile,
        isBot
    };
};

/**
 * Sleep for milliseconds
 */
const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Retry function with exponential backoff
 */
const retry = async (fn, options = {}) => {
    const {
        maxAttempts = 3,
        initialDelay = 1000,
        backoff = 2,
        shouldRetry = (error) => true
    } = options;

    let lastError;
    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            if (attempt === maxAttempts || !shouldRetry(error)) {
                throw error;
            }

            await sleep(delay);
            delay *= backoff;
        }
    }

    throw lastError;
};

/**
 * Deep clone object
 */
const deepClone = (obj) => {
    return JSON.parse(JSON.stringify(obj));
};

/**
 * Pick specific fields from object
 */
const pick = (obj, fields) => {
    return fields.reduce((acc, field) => {
        if (obj && obj.hasOwnProperty(field)) {
            acc[field] = obj[field];
        }
        return acc;
    }, {});
};

/**
 * Omit specific fields from object
 */
const omit = (obj, fields) => {
    return Object.keys(obj).reduce((acc, key) => {
        if (!fields.includes(key)) {
            acc[key] = obj[key];
        }
        return acc;
    }, {});
};

/**
 * Group array by key
 */
const groupBy = (array, key) => {
    return array.reduce((acc, item) => {
        const group = item[key];
        acc[group] = acc[group] || [];
        acc[group].push(item);
        return acc;
    }, {});
};

/**
 * Generate random color
 */
const randomColor = () => {
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
};

/**
 * Calculate time ago
 */
const timeAgo = (date) => {
    return moment(date).fromNow();
};

module.exports = {
    generateToken,
    generateCode,
    formatCurrency,
    formatDate,
    calculatePercentage,
    maskString,
    maskEmail,
    paginate,
    buildQueryString,
    getClientIp,
    parseUserAgent,
    sleep,
    retry,
    deepClone,
    pick,
    omit,
    groupBy,
    randomColor,
    timeAgo
};