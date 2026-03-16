const express = require('express');
const router = express.Router();
const { generateToken } = require('../../middleware/csrf');

router.get('/', (req, res) => {
    console.log('=== CSRF ROUTE HIT ===');
    console.log('Time:', new Date().toISOString());
    console.log('Session exists:', !!req.session);
    console.log('Session ID:', req.session?.id);
    console.log('CSRF secret exists:', !!req.session?.csrfSecret);
    
    try {
        // Check if generateToken exists
        if (typeof generateToken !== 'function') {
            console.error('❌ generateToken is not a function');
            return res.status(500).json({ error: 'CSRF configuration error' });
        }
        
        // Try to generate token
        const token = generateToken(req);
        console.log('✅ Token generated:', token ? 'yes' : 'no');
        
        // Send response
        console.log('📤 Sending response with token');
        return res.json({ csrfToken: token });
        
    } catch (error) {
        // Log the FULL error details
        console.error('❌ CSRF Route Error:');
        console.error('   Name:', error.name);
        console.error('   Message:', error.message);
        console.error('   Stack:', error.stack);
        
        // Send error response
        return res.status(500).json({ 
            error: 'Could not generate token'
        });
    }
});

module.exports = router;