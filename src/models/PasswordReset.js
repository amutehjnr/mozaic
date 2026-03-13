const mongoose = require('mongoose');

const passwordResetSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true
    },
    token: {
        type: String,
        required: true,
        unique: true
    },
    expires_at: {
        type: Date,
        required: true,
        index: true
    },
    used: {
        type: Boolean,
        default: false
    },
    used_at: {
        type: Date
    },
    ip_address: {
        type: String
    },
    user_agent: {
        type: String
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: false
    }
});

// Auto expire after expiry date
passwordResetSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

// Check if token is valid
passwordResetSchema.methods.isValid = function() {
    return !this.used && this.expires_at > new Date();
};

// Mark as used
passwordResetSchema.methods.markUsed = async function() {
    this.used = true;
    this.used_at = new Date();
    return await this.save();
};

module.exports = mongoose.model('PasswordReset', passwordResetSchema);