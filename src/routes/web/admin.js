const express = require('express');
const router  = express.Router();
const { isAuthenticated, isAdmin } = require('../../middleware/auth');

// All admin web pages require auth + admin role
router.use(isAuthenticated, isAdmin);

// Redirect /admin → /admin/dashboard
router.get('/', (req, res) => res.redirect('/admin/dashboard'));

// Dashboard — overview stats
router.get('/dashboard', (req, res) => {
    res.render('admin/dashboard', {
        title:     'Admin — Dashboard',
        activePage: 'dashboard',
        user:       req.user
    });
});

// Users list
router.get('/users', (req, res) => {
    res.render('admin/users', {
        title:     'Admin — Users',
        activePage: 'users',
        user:       req.user
    });
});

// User detail
router.get('/users/:id', (req, res) => {
    res.render('admin/user-detail', {
        title:     'Admin — User Detail',
        activePage: 'users',
        user:       req.user,
        userId:     req.params.id
    });
});

// Transactions
router.get('/transactions', (req, res) => {
    res.render('admin/transactions', {
        title:     'Admin — Transactions',
        activePage: 'transactions',
        user:       req.user
    });
});

// KYC review
router.get('/kyc', (req, res) => {
    res.render('admin/kyc', {
        title:     'Admin — KYC Review',
        activePage: 'kyc',
        user:       req.user
    });
});

// System health
router.get('/health', (req, res) => {
    res.render('admin/health', {
        title:     'Admin — System Health',
        activePage: 'health',
        user:       req.user
    });
});

module.exports = router;
