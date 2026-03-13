const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },
    balance: {
        type: Number,
        required: true,
        default: 0,
        min: [0, 'Balance cannot be negative'],
        get: v => v / 100,  // Convert from kobo to naira
        set: v => v * 100    // Convert from naira to kobo
    },
    currency: {
        type: String,
        required: true,
        default: 'NGN',
        uppercase: true,
        enum: ['NGN', 'USD', 'GBP', 'EUR']
    },
    status: {
        type: String,
        enum: ['active', 'frozen', 'closed', 'pending'],
        default: 'active',
        index: true
    },
    tier: {
        type: String,
        enum: ['basic', 'silver', 'gold', 'platinum'],
        default: 'basic'
    },
    dailyLimit: {
        type: Number,
        default: 1000000, // ₦10,000 in kobo
        get: v => v / 100
    },
    monthlyLimit: {
        type: Number,
        default: 5000000, // ₦50,000 in kobo
        get: v => v / 100
    },
    limits: {
        daily: { type: Number, default: 1000000 }, // ₦10,000 in kobo
        monthly: { type: Number, default: 5000000 }, // ₦50,000 in kobo
        perTransaction: { type: Number, default: 500000 } // ₦5,000 in kobo
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed
    },
    lastTransactionAt: {
        type: Date
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    },
    toJSON: { getters: true },
    toObject: { getters: true }
});

// Indexes
walletSchema.index({ user_id: 1 });
walletSchema.index({ status: 1 });
walletSchema.index({ created_at: -1 });

// Check if sufficient balance
walletSchema.methods.hasSufficientBalance = function(amount) {
    return this.balance >= amount;
};

// Add funds
walletSchema.methods.credit = async function(amount, session = null) {
    if (amount <= 0) throw new Error('Invalid credit amount');
    
    this.balance += amount;
    this.lastTransactionAt = new Date();
    
    return await this.save({ session });
};

// Deduct funds
walletSchema.methods.debit = async function(amount, session = null) {
    if (amount <= 0) throw new Error('Invalid debit amount');
    if (!this.hasSufficientBalance(amount)) throw new Error('Insufficient balance');
    
    this.balance -= amount;
    this.lastTransactionAt = new Date();
    
    return await this.save({ session });
};

// Check if transaction is within limits
walletSchema.methods.isWithinLimits = function(amount) {
    // This would need to check daily/monthly totals from transactions
    // Implement based on your business rules
    return amount <= this.limits.perTransaction;
};

// Get formatted balance
walletSchema.virtual('formatted_balance').get(function() {
    return `₦${this.balance.toFixed(2)}`;
});

module.exports = mongoose.model('Wallet', walletSchema);