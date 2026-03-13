const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../../middleware/auth');
const { csrfProtection } = require('../../middleware/csrf');

/**
 * Home page
 */
router.get('/', (req, res) => {
    res.render('home', {
        title: 'MozAic — Affordable Data, Airtime & Bills',
        layout: 'layouts/main',
        user: req.user
    });
});

/**
 * Support page
 */
router.get('/support', (req, res) => {
    res.render('support', {
        title: 'Support Center',
        layout: 'layouts/main',
        user: req.user
    });
});

/**
 * Terms of service
 */
router.get('/terms', (req, res) => {
    res.render('legal/terms', {
        title: 'Terms of Service',
        layout: 'layouts/main'
    });
});

/**
 * Privacy policy
 */
router.get('/privacy', (req, res) => {
    res.render('legal/privacy', {
        title: 'Privacy Policy',
        layout: 'layouts/main'
    });
});

/**
 * About page
 */
router.get('/about', (req, res) => {
    res.render('about', {
        title: 'About MozAic',
        layout: 'layouts/main'
    });
});

/**
 * Blog listing
 */
router.get('/blog', (req, res) => {
    res.render('blog/index', {
        title: 'Blog',
        layout: 'layouts/main'
    });
});

/**
 * Single blog post
 */
router.get('/blog/:slug', (req, res) => {
    res.render('blog/post', {
        title: 'Blog Post',
        layout: 'layouts/main',
        slug: req.params.slug
    });
});

/**
 * Contact page
 */
router.get('/contact', (req, res) => {
    res.render('contact', {
        title: 'Contact Us',
        layout: 'layouts/main'
    });
});

/**
 * Contact form submission
 */
router.post('/contact', csrfProtection, (req, res) => {
    // Handle contact form
    req.flash('success', 'Message sent successfully');
    res.redirect('/contact');
});

/**
 * Referral link redirect
 */
router.get('/r/:code', require('../api/referral').trackClick);

/**
 * Sitemap
 */
router.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.render('sitemap', { layout: false });
});

/**
 * Robots.txt
 */
router.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nAllow: /\nSitemap: ' + process.env.BASE_URL + '/sitemap.xml');
});

module.exports = router;