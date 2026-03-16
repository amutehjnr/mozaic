const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const { isAuthenticated, isAdmin } = require('../../middleware/auth');
const { validate }         = require('../../middleware/validation');
const rateLimiter          = require('../../middleware/rateLimiter');
const { handleMultipart }  = require('../../middleware/multer');
const { csrfProtection, generateToken } = require('../../middleware/csrf');

// Controllers
const authController        = require('../../controllers/authController');
const walletController      = require('../../controllers/walletController');
const billController        = require('../../controllers/billController');
const referralController    = require('../../controllers/referralController');
const beneficiaryController = require('../../controllers/beneficiaryController');
const kycController         = require('../../controllers/kycController');
const userController        = require('../../controllers/userController');
const adminController       = require('../../controllers/adminController');

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES  (no auth required)
// ═══════════════════════════════════════════════════════════════════════════

// ── Auth ──────────────────────────────────────────────────────────────────
router.post('/auth/register',
    rateLimiter.auth,
    validate([
        body('name').notEmpty(),
        body('email').isEmail(),
        body('password').isLength({ min: 6 }),
        body('phone').optional().isMobilePhone('any')
    ]),
    authController.register.bind(authController)
);

router.post('/auth/login',
    rateLimiter.auth,
    validate([
        body('email').isEmail(),
        body('password').notEmpty()
    ]),
    authController.login.bind(authController)
);

router.post('/auth/logout', authController.logout.bind(authController));

router.post('/auth/forgot',
    rateLimiter.auth,
    validate([ body('email').isEmail() ]),
    authController.forgot.bind(authController)
);

router.post('/auth/reset',
    rateLimiter.auth,
    validate([
        body('token').notEmpty(),
        body('password').isLength({ min: 6 })
    ]),
    authController.resetPassword.bind(authController)
);

// ── Public bill data ──────────────────────────────────────────────────────
router.get('/bill/data/plans', billController.getDataPlans.bind(billController));
router.get('/bill/tv/packages', billController.getTVPackages.bind(billController));
router.get('/bill/verify', billController.verifyCustomer.bind(billController));

// ── Flutterwave webhook (server-to-server, no user session) ───────────────
router.post('/webhook/flutterwave', walletController.handleFlutterwaveWebhook.bind(walletController));

// ── Flutterwave payment callback (browser redirect from payment gateway) ──
//    Must be PUBLIC — the user's session may not be available after the
//    external payment redirect.  We verify the transaction via Flutterwave
//    API, credit the wallet, then redirect the user to the dashboard.
router.get('/payment/callback', walletController.handlePaymentCallback.bind(walletController));

// ── CSRF token endpoint ───────────────────────────────────────────────────
router.use('/csrf', require('./csrf'));

router.get('/csrf-debug', (req, res) => {
    try {
        const token = generateToken(req);
        res.json({
            ok:         true,
            csrfToken:  token,
            sessionId:  req.session?.id,
            hasSecret:  !!req.session?.csrfSecret
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// PROTECTED ROUTES  (require authentication)
// ═══════════════════════════════════════════════════════════════════════════
router.use(isAuthenticated);

// ── Wallet ────────────────────────────────────────────────────────────────
router.get('/wallet',                   walletController.getWalletInfo.bind(walletController));
router.get('/wallet/transactions',      walletController.getTransactions.bind(walletController));
router.get('/wallet/transactions/:id',  walletController.getTransaction.bind(walletController));
router.get('/wallet/stats',             walletController.getWalletStats.bind(walletController));

router.post('/wallet/fund',
    handleMultipart,
    rateLimiter.api,
    csrfProtection,
    validate([
        body('amount').isFloat({ min: 100 }).withMessage('Amount must be at least ₦100'),
        body('method').isIn(['card', 'transfer', 'ussd']).withMessage('Invalid payment method')
    ]),
    walletController.fundWallet.bind(walletController)
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
    walletController.withdraw.bind(walletController)
);

router.post('/wallet/requery',
    csrfProtection,
    validate([ body('reference').notEmpty().withMessage('Reference is required') ]),
    walletController.requeryTransaction.bind(walletController)
);

// Manual reconciliation — protected, available to all authenticated users
// so they can trigger a re-check of their own pending transactions.
router.post('/wallet/reconcile',
    walletController.reconcilePendingTransactions.bind(walletController)
);

// ── Bills ─────────────────────────────────────────────────────────────────
// NOTE: handleMultipart is required on all bill POST routes because the
// dashboard sends FormData (multipart/form-data). Without it, req.body
// is empty and validation fails with "Invalid value" for all fields.

router.post('/bill/airtime',
    handleMultipart,
    rateLimiter.api, csrfProtection,
    validate([
        body('network').isIn(['mtn', 'glo', 'airtel', '9mobile']),
        body('phone').isMobilePhone('any'),
        body('amount').isFloat({ min: 50 }),
        body('confirm').optional().isBoolean()
    ]),
    billController.buyAirtime.bind(billController)
);

router.post('/bill/data',
    handleMultipart,
    rateLimiter.api, csrfProtection,
    validate([
        body('network').isIn(['mtn', 'glo', 'airtel', '9mobile']),
        body('phone').isMobilePhone('any'),
        body('planCode').notEmpty(),
        body('amount').optional().isFloat(),
        body('confirm').optional().isBoolean()
    ]),
    billController.buyData.bind(billController)
);

router.post('/bill/electricity',
    handleMultipart,
    rateLimiter.api, csrfProtection,
    validate([
        body('disco').isIn(['aedc', 'ikedc', 'ekedc', 'kedco']),
        body('meterNo').notEmpty(),
        body('meterType').isIn(['prepaid', 'postpaid']),
        body('amount').isFloat({ min: 100 }),
        body('phone').optional().isMobilePhone('any'),
        body('confirm').optional().isBoolean()
    ]),
    billController.payElectricity.bind(billController)
);

router.post('/bill/tv',
    handleMultipart,
    rateLimiter.api, csrfProtection,
    validate([
        body('provider').isIn(['dstv', 'gotv', 'startimes']),
        body('card').notEmpty(),
        body('package').notEmpty(),
        body('amount').optional().isFloat(),
        body('phone').optional().isMobilePhone('any'),
        body('confirm').optional().isBoolean()
    ]),
    billController.buyTV.bind(billController)
);

// ── Beneficiaries ─────────────────────────────────────────────────────────
router.get('/beneficiaries',             beneficiaryController.getBeneficiaries.bind(beneficiaryController));
router.get('/beneficiaries/:id',         beneficiaryController.getBeneficiary.bind(beneficiaryController));
router.post('/beneficiaries',
    csrfProtection,
    validate([
        body('type').isIn(['data', 'airtime', 'electricity', 'tv']),
        body('label').notEmpty(),
        body('value').notEmpty(),
        body('provider').optional()
    ]),
    beneficiaryController.createBeneficiary.bind(beneficiaryController)
);
router.put('/beneficiaries/:id',
    csrfProtection,
    validate([
        body('label').optional(),
        body('value').optional(),
        body('provider').optional(),
        body('isFavorite').optional().isBoolean()
    ]),
    beneficiaryController.updateBeneficiary.bind(beneficiaryController)
);
router.delete('/beneficiaries/:id',                  csrfProtection, beneficiaryController.deleteBeneficiary.bind(beneficiaryController));
router.post('/beneficiaries/:id/usage',              beneficiaryController.incrementUsage.bind(beneficiaryController));
router.post('/beneficiaries/bulk/delete',            csrfProtection, beneficiaryController.bulkDelete.bind(beneficiaryController));
router.post('/beneficiaries/import',                 csrfProtection, beneficiaryController.importBeneficiaries.bind(beneficiaryController));

// ── Referrals ─────────────────────────────────────────────────────────────
router.get('/referrals',       referralController.getReferrals.bind(referralController));
router.get('/referrals/stats', referralController.getReferralStats.bind(referralController));
router.get('/referrals/link',  referralController.getReferralLink.bind(referralController));

// ── KYC ───────────────────────────────────────────────────────────────────
router.get('/kyc/status', kycController.getKycStatus.bind(kycController));

// ── User ──────────────────────────────────────────────────────────────────
router.get('/user/stats',                       userController.getUserStats.bind(userController));
router.get('/user/notifications',               userController.getNotifications.bind(userController));
router.post('/user/notifications/:id/read',     userController.markNotificationRead.bind(userController));
router.post('/user/notifications/preferences',  userController.updateNotificationPreferences.bind(userController));
router.get('/user/export',                      userController.exportUserData.bind(userController));
router.post('/user/delete',
    csrfProtection,
    validate([
        body('confirm').equals('DELETE'),
        body('password').notEmpty()
    ]),
    userController.deleteAccount.bind(userController)
);

// ── Admin ─────────────────────────────────────────────────────────────────
router.use('/admin', isAdmin);

router.get('/admin/stats',           adminController.getStats.bind(adminController));
router.get('/admin/users',           adminController.getUsers.bind(adminController));
router.get('/admin/users/:id',       adminController.getUserDetails.bind(adminController));
router.put('/admin/users/:id',
    csrfProtection,
    validate([
        body('name').optional(),
        body('email').optional().isEmail(),
        body('phone').optional(),
        body('role').optional().isIn(['user', 'admin', 'superadmin']),
        body('isActive').optional().isBoolean()
    ]),
    adminController.updateUser.bind(adminController)
);
router.get('/admin/transactions',        adminController.getTransactions.bind(adminController));
router.get('/admin/kyc/pending',         kycController.getPendingKyc.bind(kycController));
router.post('/admin/kyc/:id/verify',     csrfProtection, kycController.verifyKyc.bind(kycController));
router.post('/admin/kyc/:id/reject',     csrfProtection, kycController.rejectKyc.bind(kycController));
router.post('/admin/wallet/adjust',
    csrfProtection,
    validate([
        body('userId').notEmpty(),
        body('amount').isFloat({ min: 1 }),
        body('type').isIn(['credit', 'debit']),
        body('reason').notEmpty()
    ]),
    adminController.adjustWallet.bind(adminController)
);
router.get('/admin/logs',    adminController.getLogs.bind(adminController));
router.get('/admin/health',  adminController.getHealth.bind(adminController));

// Admin-only reconcile trigger
router.post('/admin/reconcile-pending', adminController.isAdmin, walletController.reconcilePendingTransactions.bind(walletController));

module.exports = router;