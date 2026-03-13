module.exports = {
    // User roles
    USER_ROLES: {
        USER: 'user',
        ADMIN: 'admin',
        SUPER_ADMIN: 'superadmin'
    },

    // Transaction types
    TRANSACTION_TYPES: {
        CREDIT: 'credit',
        DEBIT: 'debit',
        REFUND: 'refund',
        BONUS: 'bonus'
    },

    // Transaction statuses
    TRANSACTION_STATUS: {
        PENDING: 'pending',
        PROCESSING: 'processing',
        SUCCESS: 'success',
        FAILED: 'failed',
        REVERSED: 'reversed',
        QUEUED: 'queued'
    },

    // Transaction providers
    TRANSACTION_PROVIDERS: {
        FLUTTERWAVE: 'flutterwave',
        VTPASS: 'vtpass',
        SYSTEM: 'system',
        REFERRAL: 'referral',
        DATA: 'data',
        AIRTIME: 'airtime',
        ELECTRICITY: 'electricity',
        TV: 'tv',
        WITHDRAWAL: 'withdrawal'
    },

    // Bill service providers
    BILL_PROVIDERS: {
        // Network providers
        MTN: 'mtn',
        GLO: 'glo',
        AIRTEL: 'airtel',
        NINE_MOBILE: '9mobile',
        
        // TV providers
        DSTV: 'dstv',
        GOTV: 'gotv',
        STARTIMES: 'startimes',
        
        // Electricity providers
        AEDC: 'aedc',
        IKEDC: 'ikedc',
        EKEDC: 'ekedc',
        KEDCO: 'kedco'
    },

    // Wallet statuses
    WALLET_STATUS: {
        ACTIVE: 'active',
        FROZEN: 'frozen',
        CLOSED: 'closed',
        PENDING: 'pending'
    },

    // Wallet tiers
    WALLET_TIERS: {
        BASIC: 'basic',
        SILVER: 'silver',
        GOLD: 'gold',
        PLATINUM: 'platinum'
    },

    // KYC statuses
    KYC_STATUS: {
        DRAFT: 'draft',
        PENDING: 'pending',
        VERIFIED: 'verified',
        REJECTED: 'rejected',
        EXPIRED: 'expired'
    },

    // KYC tiers
    KYC_TIERS: {
        TIER_1: 'tier1',
        TIER_2: 'tier2',
        TIER_3: 'tier3'
    },

    // KYC document types
    KYC_DOCUMENT_TYPES: {
        NIN: 'NIN',
        DRIVERS_LICENSE: 'Driver\'s License',
        PASSPORT: 'International Passport',
        VOTERS_CARD: 'Voter\'s Card'
    },

    // Referral statuses
    REFERRAL_STATUS: {
        PENDING: 'pending',
        CLICKED: 'clicked',
        SIGNED_UP: 'signed_up',
        ACTIVE: 'active',
        CONVERTED: 'converted',
        EXPIRED: 'expired'
    },

    // Beneficiary types
    BENEFICIARY_TYPES: {
        DATA: 'data',
        AIRTIME: 'airtime',
        ELECTRICITY: 'electricity',
        TV: 'tv'
    },

    // Notification types
    NOTIFICATION_TYPES: {
        TRANSACTION: 'transaction',
        KYC: 'kyc',
        REFERRAL: 'referral',
        PROMOTION: 'promotion',
        ALERT: 'alert'
    },

    // Payment methods
    PAYMENT_METHODS: {
        CARD: 'card',
        TRANSFER: 'transfer',
        USSD: 'ussd',
        BANK: 'bank'
    },

    // Currencies
    CURRENCIES: {
        NGN: 'NGN',
        USD: 'USD',
        GBP: 'GBP',
        EUR: 'EUR'
    },

    // Date formats
    DATE_FORMATS: {
        DEFAULT: 'YYYY-MM-DD HH:mm:ss',
        DATE_ONLY: 'YYYY-MM-DD',
        TIME_ONLY: 'HH:mm:ss',
        HUMAN: 'MMMM Do YYYY, h:mm:ss a'
    },

    // Pagination defaults
    PAGINATION: {
        DEFAULT_PAGE: 1,
        DEFAULT_LIMIT: 20,
        MAX_LIMIT: 100
    },

    // File upload
    UPLOAD: {
        MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
        ALLOWED_MIME_TYPES: [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'application/pdf'
        ],
        ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.pdf']
    },

    // API rate limits
    RATE_LIMITS: {
        API: { window: 15 * 60 * 1000, max: 100 }, // 15 minutes, 100 requests
        AUTH: { window: 60 * 60 * 1000, max: 10 },  // 1 hour, 10 requests
        WALLET: { window: 60 * 60 * 1000, max: 50 }, // 1 hour, 50 requests
        BILL: { window: 60 * 60 * 1000, max: 100 }   // 1 hour, 100 requests
    },

    // Cache TTLs (in seconds)
    CACHE_TTL: {
        SHORT: 60,           // 1 minute
        MEDIUM: 300,         // 5 minutes
        LONG: 3600,          // 1 hour
        DAY: 86400           // 24 hours
    },

    // Session
    SESSION: {
        MAX_AGE: 24 * 60 * 60 * 1000, // 24 hours
        REMEMBER_ME_AGE: 30 * 24 * 60 * 60 * 1000 // 30 days
    },

    // Security
    SECURITY: {
        BCRYPT_ROUNDS: 10,
        PASSWORD_MIN_LENGTH: 6,
        TOKEN_EXPIRY: 10 * 60 * 1000, // 10 minutes
        REFRESH_TOKEN_EXPIRY: 7 * 24 * 60 * 60 * 1000 // 7 days
    },

    // Referral program
    REFERRAL: {
        BONUS_AMOUNT: 100,
        MIN_TRANSACTION: 1000,
        TIER_MULTIPLIERS: {
            bronze: 1,
            silver: 1.5,
            gold: 2,
            platinum: 3
        }
    },

    // HTTP status codes
    HTTP_STATUS: {
        OK: 200,
        CREATED: 201,
        ACCEPTED: 202,
        NO_CONTENT: 204,
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
        UNPROCESSABLE: 422,
        TOO_MANY_REQUESTS: 429,
        SERVER_ERROR: 500
    },

    // Error messages
    ERROR_MESSAGES: {
        UNAUTHORIZED: 'Authentication required',
        FORBIDDEN: 'You do not have permission to perform this action',
        NOT_FOUND: 'Resource not found',
        VALIDATION_ERROR: 'Validation error',
        SERVER_ERROR: 'Internal server error',
        INSUFFICIENT_BALANCE: 'Insufficient balance',
        INVALID_CREDENTIALS: 'Invalid email or password',
        ACCOUNT_INACTIVE: 'Account is inactive',
        WALLET_INACTIVE: 'Wallet is inactive',
        RATE_LIMIT: 'Too many requests, please try again later'
    }
};