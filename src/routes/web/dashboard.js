const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { isAuthenticated } = require('../../middleware/auth');
const { csrfProtection } = require('../../middleware/csrf');
const { validate } = require('../../middleware/validation');
const upload = require('../../middleware/upload');
const { handleMultipart } = require('../../middleware/multer');

// Import all controllers
const userController = require('../../controllers/userController');
const walletController = require('../../controllers/walletController');
const billController = require('../../controllers/billController');
const kycController = require('../../controllers/kycController');
const referralController = require('../../controllers/referralController');
const beneficiaryController = require('../../controllers/beneficiaryController');

console.log('✅ All dashboard controllers loaded:');
console.log('   - userController:', !!userController);
console.log('   - walletController:', !!walletController);
console.log('   - billController:', !!billController);
console.log('   - kycController:', !!kycController);
console.log('   - referralController:', !!referralController);
console.log('   - beneficiaryController:', !!beneficiaryController);

/**
 * All dashboard routes require authentication
 */
router.use(isAuthenticated);

/**
 * Dashboard home
 */
router.get('/user', userController.showDashboard);

/**
 * Transaction history
 */
router.get('/history', userController.showHistory);

/**
 * Profile & Settings
 */
router.get('/settings', userController.showProfile);

router.post('/settings',
    csrfProtection,
    validate([
        body('name').optional().trim(),
        body('email').optional().isEmail().normalizeEmail(),
        body('phone').optional().isMobilePhone('any'),
        body('address').optional().trim()
    ]),
    userController.updateProfile
);

router.post('/settings/password',
    csrfProtection,
    validate([
        body('current').notEmpty().withMessage('Current password is required'),
        body('new').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
        body('confirm').custom((value, { req }) => {
            if (value !== req.body.new) {
                throw new Error('Passwords do not match');
            }
            return true;
        })
    ]),
    userController.changePassword
);

router.post('/settings/photo',
    csrfProtection,
    upload.single('photo'),
    userController.uploadPhoto
);

/**
 * KYC Verification
 */
router.get('/verify', kycController.showKycPage);

router.post('/verify',
    csrfProtection,
    validate([
        body('first_name').optional().trim(),
        body('last_name').optional().trim(),
        body('dob').optional().isDate(),
        body('bvn').optional().isLength({ min: 10, max: 10 }),
        body('address').optional().trim()
    ]),
    kycController.savePersonalDetails
);

// Note: The upload middleware is handled inside kycController.uploadDocuments
router.post('/verify/documents',
    csrfProtection,
    (req, res, next) => {
        kycController.upload(req, res, (err) => {
            if (err) {
                return res.status(400).json({
                    ok: false,
                    error: err.message
                });
            }
            next();
        });
    },
    validate([
        body('id_type').isIn(['NIN', "Driver's License", 'International Passport']),
        body('id_number').notEmpty()
    ]),
    kycController.uploadDocuments
);

router.post('/verify/submit',
    csrfProtection,
    kycController.submitKyc
);

/**
 * Beneficiaries
 */
router.get('/beneficiaries', beneficiaryController.showBeneficiariesPage);

router.post('/beneficiaries',
    csrfProtection,
    validate([
        body('type').isIn(['data', 'airtime', 'electricity', 'tv']),
        body('label').notEmpty().trim(),
        body('value').notEmpty().trim(),
        body('provider').optional()
    ]),
    beneficiaryController.createBeneficiary
);

router.put('/beneficiaries/:id',
    csrfProtection,
    validate([
        body('label').optional().trim(),
        body('value').optional().trim(),
        body('provider').optional(),
        body('isFavorite').optional().isBoolean()
    ]),
    beneficiaryController.updateBeneficiary
);

router.delete('/beneficiaries/:id',
    csrfProtection,
    beneficiaryController.deleteBeneficiary
);

router.post('/beneficiaries/:id/toggle-favorite',
    csrfProtection,
    beneficiaryController.toggleFavorite
);

/**
 * Referrals
 */
router.get('/referrals', referralController.showReferralsPage);
router.get('/referrals/export', referralController.exportReferrals);

/**
 * Requery
 */
router.get('/requery', (req, res) => {
    res.render('dashboard/requery/index', {
        title: 'Requery Transaction',
        layout: 'layouts/dashboard',
        user: req.user
    });
});

router.post('/requery',
    csrfProtection,
    validate([
        body('reference').notEmpty().withMessage('Reference is required')
    ]),
    walletController.requeryTransaction
);

/**
 * Bill payment routes
 */
router.get('/api/bills/data/plans', billController.getDataPlans);
router.post('/api/bills/data', billController.buyData);
router.post('/api/bills/airtime', billController.buyAirtime);
router.get('/api/bills/tv/packages', billController.getTVPackages);
router.post('/api/bills/tv', billController.buyTV);
router.post('/api/bills/electricity', billController.payElectricity);
router.get('/api/bills/verify', billController.verifyCustomer);

/**
 * API routes within dashboard (for AJAX)
 */
router.get('/api/wallet', walletController.getWalletInfo);
router.get('/api/wallet/transactions', walletController.getTransactions);
router.get('/api/wallet/stats', walletController.getWalletStats);
router.post('/api/wallet/fund', handleMultipart, walletController.fundWallet); // ADD THIS LINE
router.post('/api/wallet/withdraw', handleMultipart, walletController.withdraw); // ADD THIS LINE
router.get('/api/beneficiaries', beneficiaryController.getBeneficiaries);
router.get('/api/beneficiaries/frequent', beneficiaryController.getFrequentlyUsed);
router.post('/api/beneficiaries/import', beneficiaryController.importBeneficiaries);
router.post('/api/beneficiaries/bulk-delete', beneficiaryController.bulkDelete);
router.post('/api/beneficiaries/:id/usage', beneficiaryController.incrementUsage);
router.get('/api/beneficiaries/:id', beneficiaryController.getBeneficiary);
router.get('/api/referrals', referralController.getReferrals);
router.get('/api/referrals/stats', referralController.getReferralStats);
router.get('/api/referrals/link', referralController.getReferralLink);
router.get('/api/kyc/status', kycController.getKycStatus);
router.get('/api/user/notifications', userController.getNotifications);
router.post('/api/user/notifications/:id/read', userController.markNotificationRead);
router.post('/api/user/notifications/preferences', userController.updateNotificationPreferences);
router.get('/api/user/stats', userController.getUserStats);
router.get('/api/user/export', userController.exportUserData);
router.post('/api/user/delete', userController.deleteAccount);

module.exports = router;