const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { isAuthenticated, isAdmin } = require('../../middleware/auth');
const { csrfProtection } = require('../../middleware/csrf');
const { validate } = require('../../middleware/validation');
const rateLimiter = require('../../middleware/rateLimiter');
const { handleMultipart } = require('../../middleware/multer'); 

// Controllers
const authController = require('../../controllers/authController');
const walletController = require('../../controllers/walletController');
const billController = require('../../controllers/billController');
const referralController = require('../../controllers/referralController');
const beneficiaryController = require('../../controllers/beneficiaryController');
const kycController = require('../../controllers/kycController');
const userController = require('../../controllers/userController');
const adminController = require('../../controllers/adminController');

/**
 * Public API routes
 */
router.post('/auth/register',
    rateLimiter.auth,
    validate([
        body('name').notEmpty(),
        body('email').isEmail(),
        body('password').isLength({ min: 6 }),
        body('phone').optional().isMobilePhone('any')
    ]),
    authController.register
);

router.post('/auth/login',
    rateLimiter.auth,
    validate([
        body('email').isEmail(),
        body('password').notEmpty()
    ]),
    authController.login
);

router.post('/auth/logout', authController.logout);

router.post('/auth/forgot',
    rateLimiter.auth,
    validate([
        body('email').isEmail()
    ]),
    authController.forgot
);

router.post('/auth/reset',
    rateLimiter.auth,
    validate([
        body('token').notEmpty(),
        body('password').isLength({ min: 6 })
    ]),
    authController.resetPassword
);

/**
 * Public bill data endpoints (no auth required)
 */
router.get('/bill/data/plans', billController.getDataPlans);
router.get('/bill/tv/packages', billController.getTVPackages);
router.get('/bill/verify', billController.verifyCustomer);

/**
 * Webhook endpoints (no CSRF, special handling)
 */
router.post('/webhook/flutterwave', walletController.handleFlutterwaveWebhook);
// Add other webhooks as needed

/**
 * Protected API routes (require authentication)
 */
router.use(isAuthenticated);

/**
 * Wallet endpoints
 */
router.get('/wallet', walletController.getWalletInfo);
router.get('/wallet/transactions', walletController.getTransactions);
router.get('/wallet/transactions/:id', walletController.getTransaction);
router.get('/wallet/stats', walletController.getWalletStats);

router.post('/wallet/fund',
    handleMultipart,
    rateLimiter.api,
    csrfProtection,
    validate([
        body('amount').isFloat({ min: 100 }).withMessage('Amount must be at least ₦100'),
        body('method').isIn(['card', 'transfer', 'ussd']).withMessage('Invalid payment method')
    ]),
    walletController.fundWallet
);

router.post('/wallet/withdraw',
    handleMultipart,
    rateLimiter.api,
    csrfProtection,
    validate([
        body('amount').isFloat({ min: 100 }).withMessage('Amount must be at least ₦100'),
        body('bank').notEmpty().withMessage('Bank name is required'),
        body('account').isLength({ min: 10, max: 12 }).withMessage('Valid account number is required'),
        body('account_name').optional()
    ]),
    walletController.withdraw
);

router.post('/wallet/requery',
    csrfProtection,
    validate([
        body('reference').notEmpty().withMessage('Reference is required')
    ]),
    walletController.requeryTransaction
);

// Add this with your other routes
router.use('/csrf', require('./csrf'));

/**
 * Bill payment endpoints
 */
router.post('/bill/airtime',
    rateLimiter.api,
    csrfProtection,
    validate([
        body('network').isIn(['mtn', 'glo', 'airtel', '9mobile']),
        body('phone').isMobilePhone('any'),
        body('amount').isFloat({ min: 50 }),
        body('confirm').optional().isBoolean()
    ]),
    billController.buyAirtime
);

router.post('/bill/data',
    rateLimiter.api,
    csrfProtection,
    validate([
        body('network').isIn(['mtn', 'glo', 'airtel', '9mobile']),
        body('phone').isMobilePhone('any'),
        body('planCode').notEmpty(),
        body('amount').optional().isFloat(),
        body('confirm').optional().isBoolean()
    ]),
    billController.buyData
);

router.post('/bill/electricity',
    rateLimiter.api,
    csrfProtection,
    validate([
        body('disco').isIn(['aedc', 'ikedc', 'ekedc', 'kedco']),
        body('meterNo').notEmpty(),
        body('meterType').isIn(['prepaid', 'postpaid']),
        body('amount').isFloat({ min: 100 }),
        body('phone').optional().isMobilePhone('any'),
        body('confirm').optional().isBoolean()
    ]),
    billController.payElectricity
);

router.post('/bill/tv',
    rateLimiter.api,
    csrfProtection,
    validate([
        body('provider').isIn(['dstv', 'gotv', 'startimes']),
        body('card').notEmpty(),
        body('package').notEmpty(),
        body('amount').optional().isFloat(),
        body('phone').optional().isMobilePhone('any'),
        body('confirm').optional().isBoolean()
    ]),
    billController.buyTV
);

/**
 * Beneficiary endpoints
 */
router.get('/beneficiaries', beneficiaryController.getBeneficiaries);
router.get('/beneficiaries/:id', beneficiaryController.getBeneficiary);
router.post('/beneficiaries',
    csrfProtection,
    validate([
        body('type').isIn(['data', 'airtime', 'electricity', 'tv']),
        body('label').notEmpty(),
        body('value').notEmpty(),
        body('provider').optional()
    ]),
    beneficiaryController.createBeneficiary
);
router.put('/beneficiaries/:id',
    csrfProtection,
    validate([
        body('label').optional(),
        body('value').optional(),
        body('provider').optional(),
        body('isFavorite').optional().isBoolean()
    ]),
    beneficiaryController.updateBeneficiary
);
router.delete('/beneficiaries/:id', csrfProtection, beneficiaryController.deleteBeneficiary);
router.post('/beneficiaries/:id/usage', beneficiaryController.incrementUsage);
router.post('/beneficiaries/bulk/delete', csrfProtection, beneficiaryController.bulkDelete);
router.post('/beneficiaries/import', csrfProtection, beneficiaryController.importBeneficiaries);

/**
 * Referral endpoints
 */
router.get('/referrals', referralController.getReferrals);
router.get('/referrals/stats', referralController.getReferralStats);
router.get('/referrals/link', referralController.getReferralLink);

/**
 * KYC endpoints
 */
router.get('/kyc/status', kycController.getKycStatus);

/**
 * User endpoints
 */
router.get('/user/stats', userController.getUserStats);
router.get('/user/notifications', userController.getNotifications);
router.post('/user/notifications/:id/read', userController.markNotificationRead);
router.post('/user/notifications/preferences', userController.updateNotificationPreferences);
router.get('/user/export', userController.exportUserData);
router.post('/user/delete',
    csrfProtection,
    validate([
        body('confirm').equals('DELETE'),
        body('password').notEmpty()
    ]),
    userController.deleteAccount
);

/**
 * Admin routes (require admin privileges)
 */
router.use('/admin', isAdmin);

router.get('/admin/stats', adminController.getStats);
router.get('/admin/users', adminController.getUsers);
router.get('/admin/users/:id', adminController.getUserDetails);
router.put('/admin/users/:id',
    csrfProtection,
    validate([
        body('name').optional(),
        body('email').optional().isEmail(),
        body('phone').optional(),
        body('role').optional().isIn(['user', 'admin', 'superadmin']),
        body('isActive').optional().isBoolean()
    ]),
    adminController.updateUser
);
router.get('/admin/transactions', adminController.getTransactions);
router.get('/admin/kyc/pending', kycController.getPendingKyc);
router.post('/admin/kyc/:id/verify', csrfProtection, kycController.verifyKyc);
router.post('/admin/kyc/:id/reject', csrfProtection, kycController.rejectKyc);
router.post('/admin/wallet/adjust',
    csrfProtection,
    validate([
        body('userId').notEmpty(),
        body('amount').isFloat({ min: 1 }),
        body('type').isIn(['credit', 'debit']),
        body('reason').notEmpty()
    ]),
    adminController.adjustWallet
);
router.get('/admin/logs', adminController.getLogs);
router.get('/admin/health', adminController.getHealth);

module.exports = router;