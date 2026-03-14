const express = require('express');
const router = express.Router();
const { generateToken } = require('../../middleware/csrf');

/**
 * GET /api/csrf
 * Returns a CSRF token for AJAX requests
 */
router.get('/', (req, res) => {
    try {
        // Generate CSRF token
        const token = generateToken(req);
        
        // Return token in the format frontend expects
        res.json({ 
            csrfToken: token  // Changed from { token } to { csrfToken: token }
        });
    } catch (error) {
        console.error('CSRF token generation error:', error);
        res.status(500).json({ 
            error: 'Could not generate token' 
        });
    }
});

module.exports = router;