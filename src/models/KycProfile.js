const mongoose = require('mongoose');

const kycProfileSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },
    status: {
        type: String,
        enum: ['draft', 'pending', 'verified', 'rejected', 'expired'],
        default: 'draft',
        index: true
    },
    tier: {
        type: String,
        enum: ['tier1', 'tier2', 'tier3'],
        default: 'tier1'
    },
    // Personal Information
    first_name: {
        type: String,
        trim: true
    },
    last_name: {
        type: String,
        trim: true
    },
    dob: {
        type: Date
    },
    bvn: {
        type: String,
        sparse: true,
        select: false // Don't return by default for security
    },
    nin: {
        type: String,
        sparse: true,
        select: false
    },
    // Address
    address: {
        street: String,
        city: String,
        state: String,
        country: {
            type: String,
            default: 'Nigeria'
        },
        postal_code: String
    },
    // Documents
    id_type: {
        type: String,
        enum: ['NIN', 'Driver\'s License', 'International Passport', 'Voter\'s Card']
    },
    id_number: {
        type: String
    },
    id_front_path: {
        type: String
    },
    id_back_path: {
        type: String
    },
    selfie_path: {
        type: String
    },
    proof_of_address_path: {
        type: String
    },
    // Verification metadata
    verified_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    verified_at: {
        type: Date
    },
    rejected_reason: {
        type: String
    },
    expires_at: {
        type: Date
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
});

// Indexes
kycProfileSchema.index({ user_id: 1 });
kycProfileSchema.index({ status: 1 });
kycProfileSchema.index({ bvn: 1 }, { sparse: true });
kycProfileSchema.index({ nin: 1 }, { sparse: true });

// Check if KYC is complete
kycProfileSchema.virtual('is_complete').get(function() {
    return this.status === 'verified';
});

// Check if KYC is pending
kycProfileSchema.virtual('is_pending').get(function() {
    return this.status === 'pending';
});

// Get full name
kycProfileSchema.virtual('full_name').get(function() {
    return `${this.first_name || ''} ${this.last_name || ''}`.trim();
});

// Submit for verification
kycProfileSchema.methods.submit = async function() {
    this.status = 'pending';
    return await this.save();
};

// Verify
kycProfileSchema.methods.verify = async function(adminId) {
    this.status = 'verified';
    this.verified_by = adminId;
    this.verified_at = new Date();
    this.expires_at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
    return await this.save();
};

// Reject
kycProfileSchema.methods.reject = async function(reason, adminId) {
    this.status = 'rejected';
    this.rejected_reason = reason;
    this.verified_by = adminId;
    this.verified_at = new Date();
    return await this.save();
};

module.exports = mongoose.model('KycProfile', kycProfileSchema);