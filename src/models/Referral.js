const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
    referrer_user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    referred_user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        unique: true,
        sparse: true,
        index: true
    },
    referred_email: {
        type: String,
        lowercase: true,
        trim: true
    },
    referred_phone: {
        type: String,
        trim: true
    },
    referral_code: {
        type: String,
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: ['pending', 'clicked', 'signed_up', 'active', 'converted', 'expired'],
        default: 'pending',
        index: true
    },
    reward_amount: {
        type: Number,
        default: 0,
        get: v => v / 100,
        set: v => v * 100
    },
    reward_currency: {
        type: String,
        default: 'NGN'
    },
    reward_paid: {
        type: Boolean,
        default: false
    },
    reward_paid_at: {
        type: Date
    },
    conversion_amount: {
        type: Number,
        default: 0,
        get: v => v / 100,
        set: v => v * 100
    },
    conversion_date: {
        type: Date
    },
    clicks: {
        type: Number,
        default: 0
    },
    ip_address: {
        type: String
    },
    user_agent: {
        type: String
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed
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
referralSchema.index({ referrer_user_id: 1, created_at: -1 });
referralSchema.index({ referral_code: 1, status: 1 });
referralSchema.index({ referred_user_id: 1 }, { sparse: true });

// Track click
referralSchema.methods.trackClick = async function(ip, userAgent) {
    this.clicks += 1;
    if (this.status === 'pending') {
        this.status = 'clicked';
    }
    this.ip_address = ip;
    this.user_agent = userAgent;
    return await this.save();
};

// Mark as signed up
referralSchema.methods.markSignedUp = async function(userId) {
    this.referred_user_id = userId;
    this.status = 'signed_up';
    return await this.save();
};

// Mark as active (first transaction)
referralSchema.methods.markActive = async function(amount) {
    this.status = 'active';
    this.conversion_amount = amount;
    this.conversion_date = new Date();
    return await this.save();
};

// Mark as converted (reached milestone)
referralSchema.methods.markConverted = async function() {
    this.status = 'converted';
    return await this.save();
};

// Pay reward
referralSchema.methods.payReward = async function(amount) {
    this.reward_amount = amount;
    this.reward_paid = true;
    this.reward_paid_at = new Date();
    return await this.save();
};

module.exports = mongoose.model('Referral', referralSchema);