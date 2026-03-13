const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    wallet_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Wallet',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['credit', 'debit', 'refund', 'bonus'],
        required: true,
        index: true
    },
    provider: {
        type: String,
        enum: ['flutterwave', 'vtpass', 'system', 'referral', 'data', 'airtime', 'electricity', 'tv'],
        required: true,
        index: true
    },
    amount: {
        type: Number,
        required: true,
        min: [0, 'Amount cannot be negative'],
        get: v => v / 100,  // Convert from kobo to naira
        set: v => v * 100    // Convert from naira to kobo
    },
    fee: {
        type: Number,
        default: 0,
        get: v => v / 100,
        set: v => v * 100
    },
    currency: {
        type: String,
        required: true,
        default: 'NGN',
        uppercase: true
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'success', 'failed', 'reversed', 'queued'],
        default: 'pending',
        index: true,
        required: true
    },
    reference: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    external_ref: {
        type: String,
        sparse: true,
        index: true
    },
    account_target: {
        type: String,
        trim: true
    },
    plan_code: {
        type: String
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed
    },
    details: {
        type: String,
        trim: true
    },
    ip_address: {
        type: String
    },
    user_agent: {
        type: String
    },
    processed_at: {
        type: Date
    },
    failed_reason: {
        type: String
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    },
    toJSON: { getters: true },
    toObject: { getters: true }
});

// Compound indexes for common queries
transactionSchema.index({ user_id: 1, created_at: -1 });
transactionSchema.index({ status: 1, created_at: -1 });
transactionSchema.index({ provider: 1, status: 1 });
transactionSchema.index({ reference: 1 });
transactionSchema.index({ external_ref: 1 });
transactionSchema.index({ user_id: 1, type: 1, created_at: -1 });

// Generate unique reference
transactionSchema.statics.generateReference = function(type) {
    const prefix = {
        'flutterwave': 'FLW',
        'vtpass': 'VTP',
        'data': 'DAT',
        'airtime': 'AIR',
        'electricity': 'ELE',
        'tv': 'TV',
        'withdrawal': 'WDR',
        'referral': 'REF',
        'bonus': 'BNS'
    }[type] || 'TXN';
    
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}_${timestamp}_${random}`;
};

// Mark as success
transactionSchema.methods.markSuccess = async function(externalRef = null) {
    this.status = 'success';
    if (externalRef) this.external_ref = externalRef;
    this.processed_at = new Date();
    return await this.save();
};

// Mark as failed
transactionSchema.methods.markFailed = async function(reason) {
    this.status = 'failed';
    this.failed_reason = reason;
    return await this.save();
};

// Mark as processing
transactionSchema.methods.markProcessing = async function() {
    this.status = 'processing';
    return await this.save();
};

// Get formatted amount
transactionSchema.virtual('formatted_amount').get(function() {
    return `₦${this.amount.toFixed(2)}`;
});

// Get status badge class
transactionSchema.virtual('status_badge').get(function() {
    const badges = {
        'pending': 'badge-warning',
        'processing': 'badge-info',
        'success': 'badge-success',
        'failed': 'badge-danger',
        'reversed': 'badge-secondary',
        'queued': 'badge-primary'
    };
    return badges[this.status] || 'badge-secondary';
});

module.exports = mongoose.model('Transaction', transactionSchema);