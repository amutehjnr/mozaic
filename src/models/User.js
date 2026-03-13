const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
    uid: {
        type: String,
        unique: true,
        default: () => crypto.randomBytes(16).toString('hex')
    },
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true,
        maxlength: [100, 'Name cannot exceed 100 characters']
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    phone: {
        type: String,
        trim: true,
        sparse: true,
        match: [/^[0-9+\-()\s]{7,}$/, 'Please enter a valid phone number']
    },
    address: {
        type: String,
        trim: true,
        maxlength: [500, 'Address cannot exceed 500 characters']
    },
    password_hash: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [60, 'Invalid password hash']
    },
    referral_code: {
        type: String,
        unique: true,
        sparse: true,
        uppercase: true
    },
    referred_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    referred_by_code: {
        type: String
    },
    role: {
        type: String,
        enum: ['user', 'admin', 'superadmin'],
        default: 'user'
    },
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    isPhoneVerified: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date
    },
    lastLoginIP: {
        type: String
    },
    loginCount: {
        type: Number,
        default: 0
    },
    preferences: {
        currency: {
            type: String,
            default: 'NGN'
        },
        language: {
            type: String,
            default: 'en'
        },
        notifications: {
            email: { type: Boolean, default: true },
            sms: { type: Boolean, default: false },
            push: { type: Boolean, default: true }
        }
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    },
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ referral_code: 1 });
userSchema.index({ uid: 1 });
userSchema.index({ created_at: -1 });

// Virtual for wallet
userSchema.virtual('wallet', {
    ref: 'Wallet',
    localField: '_id',
    foreignField: 'user_id',
    justOne: true
});

// Virtual for transactions
userSchema.virtual('transactions', {
    ref: 'Transaction',
    localField: '_id',
    foreignField: 'user_id'
});

// Virtual for kyc profile
userSchema.virtual('kyc', {
    ref: 'KycProfile',
    localField: '_id',
    foreignField: 'user_id',
    justOne: true
});

// Virtual for beneficiaries
userSchema.virtual('beneficiaries', {
    ref: 'Beneficiary',
    localField: '_id',
    foreignField: 'user_id'
});

// Hash password before save
userSchema.pre('save', async function(next) {
    if (!this.isModified('password_hash')) return next();
    
    try {
        // Generate referral code if not exists
        if (!this.referral_code) {
            const baseCode = this.name ? 
                this.name.substring(0, 3).toUpperCase() : 
                'USER';
            const randomStr = crypto.randomBytes(3).toString('hex').toUpperCase();
            this.referral_code = `${baseCode}${randomStr}`;
        }
        next();
    } catch (error) {
        next(error);
    }
});

// Create wallet after user is saved
userSchema.post('save', async function(doc) {
    try {
        const Wallet = mongoose.model('Wallet');
        const existingWallet = await Wallet.findOne({ user_id: doc._id });
        
        if (!existingWallet) {
            await Wallet.create({
                user_id: doc._id,
                balance: 0,
                currency: 'NGN',
                status: 'active'
            });
        }
    } catch (error) {
        console.error('Error creating wallet for user:', error);
    }
});

// Compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password_hash);
};

// Generate password reset token
userSchema.methods.generatePasswordResetToken = function() {
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    this.passwordResetToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');
    
    this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    
    return resetToken;
};

// Get public profile
userSchema.methods.getPublicProfile = function() {
    return {
        id: this._id,
        uid: this.uid,
        name: this.name,
        email: this.email,
        phone: this.phone,
        role: this.role,
        isEmailVerified: this.isEmailVerified,
        isPhoneVerified: this.isPhoneVerified,
        preferences: this.preferences,
        created_at: this.created_at
    };
};

const UserModel = mongoose.model('User', userSchema);
module.exports = UserModel;