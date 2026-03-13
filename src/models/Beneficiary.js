const mongoose = require('mongoose');

const beneficiarySchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['data', 'airtime', 'electricity', 'tv'],
        required: true,
        index: true
    },
    label: {
        type: String,
        required: true,
        trim: true,
        maxlength: [100, 'Label cannot exceed 100 characters']
    },
    value: {
        type: String,
        required: true,
        trim: true
    },
    provider: {
        type: String,
        enum: ['mtn', 'glo', 'airtel', '9mobile', 'dstv', 'gotv', 'startimes', 'aedc', 'ikedc', 'ekedc', 'kedco']
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    isFavorite: {
        type: Boolean,
        default: false
    },
    usage_count: {
        type: Number,
        default: 0
    },
    last_used_at: {
        type: Date
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
});

// Compound indexes
beneficiarySchema.index({ user_id: 1, type: 1 });
beneficiarySchema.index({ user_id: 1, isFavorite: -1 });
beneficiarySchema.index({ user_id: 1, usage_count: -1 });

// Increment usage count
beneficiarySchema.methods.incrementUsage = async function() {
    this.usage_count += 1;
    this.last_used_at = new Date();
    return await this.save();
};

// Get formatted display
beneficiarySchema.virtual('display').get(function() {
    return {
        id: this._id,
        type: this.type,
        label: this.label,
        value: this.value,
        provider: this.provider,
        isFavorite: this.isFavorite
    };
});

module.exports = mongoose.model('Beneficiary', beneficiarySchema);