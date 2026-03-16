const express = require('express');
const router = express.Router();
const { generateToken } = require('../../middleware/csrf');

router.get('/', (req, res) => {
    try {
        const token = generateToken(req);
        res.json({ csrfToken: token });
    } catch (error) {
        console.error('CSRF route error:', error);
        res.status(500).json({ error: 'Could not generate token' });
    }
});

module.exports = router;