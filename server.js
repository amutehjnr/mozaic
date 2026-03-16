require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const flash = require('express-flash');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const fs = require('fs');

// Import middleware
const rateLimiter = require('./src/middleware/rateLimiter');
const { errorHandler } = require('./src/middleware/errorHandler');
const { setupCsrf } = require('./src/middleware/csrf');
const logger = require('./src/utils/logger');
const connectDB = require('./src/config/database');

const app = express();

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.error(err);
    logger.error('UNCAUGHT EXCEPTION!', err);
    process.exit(1);
});

// ==================== Security Middleware ====================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://cdn.jsdelivr.net"],
            connectSrc: ["'self'", "https://api.flutterwave.com", "https://api.vtpass.com"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://mozaic-eomm.onrender.com', process.env.BASE_URL].filter(Boolean)
        : ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
    optionsSuccessStatus: 200
}));

// Compression
app.use(compression());

// ==================== Body Parsers ====================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ==================== Static Files ====================
app.use(express.static(path.join(__dirname, 'public')));

// ==================== Connect to MongoDB and Start Server ====================
connectDB().then(() => {
    // ==================== Register ALL Models AFTER connection ====================
    console.log('\n📦 Registering Mongoose models...');
    
    // Import all models to ensure they're registered with Mongoose
    require('./src/models/User');
    require('./src/models/PasswordReset');
    require('./src/models/Wallet');
    require('./src/models/Transaction');
    require('./src/models/KycProfile');
    require('./src/models/Beneficiary');
    require('./src/models/Referral');
    
    console.log('✅ All models registered successfully');
    
    // Debug: Verify User model is properly registered
    try {
        const User = mongoose.model('User');
        console.log('🔍 User model verification:');
        console.log('   - Model exists:', !!User);
        console.log('   - findOne is function:', typeof User.findOne === 'function');
        console.log('   - create is function:', typeof User.create === 'function');
    } catch (modelError) {
        console.error('❌ User model not registered:', modelError.message);
    }

    // ==================== Session Configuration ====================
    const sessionConfig = {
        secret: process.env.SESSION_SECRET || 'dev-secret-key',
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({
            mongoUrl: process.env.MONGODB_URI,
            collectionName: 'sessions',
            ttl: 24 * 60 * 60,
            autoRemove: 'native',
            touchAfter: 24 * 3600
        }),
        cookie: {
            maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            domain: process.env.NODE_ENV === 'production' ? process.env.DOMAIN : undefined
        },
        name: 'mozaic.sid',
        rolling: true
    };

    if (process.env.NODE_ENV === 'production') {
        app.set('trust proxy', 1);
    }

    // IMPORTANT: Session MUST come before flash and CSRF
    app.use(session(sessionConfig));

    // ==================== Flash Messages ====================
    app.use(flash());

    // ==================== View Engine ====================
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

   // ==================== Global Middleware ====================
app.use((req, res, next) => {
    res.locals.user = req.session?.user || null;
    res.locals.currentUrl = req.originalUrl;
    res.locals.messages = req.flash ? req.flash() : {};
    res.locals.queryParams = req.query;
    res.locals.env = process.env.NODE_ENV;
    res.locals.baseUrl = process.env.BASE_URL || `https://${req.get('host') || 'mozaic-eomm.onrender.com'}`;
    res.locals.nonce = crypto.randomBytes(16).toString('base64');
    res.locals.bodyClass = '';
    res.locals.formData = {};
    
    // CSRF token will be set by csrf middleware
    res.locals.csrfToken = '';
    
    // FIXED: Safe URL helper function
    res.locals.url = (path) => {
        // If no path, return empty string
        if (!path) return '';
        
        // If it's already a full URL with protocol, return it as-is
        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }
        
        // Ensure path starts with a single slash
        const cleanPath = path.startsWith('/') ? path : '/' + path;
        
        // In development, handle localhost https to http conversion if needed
        if (process.env.NODE_ENV !== 'production' && cleanPath.includes('localhost')) {
            return cleanPath.replace('https://', 'http://');
        }
        
        return cleanPath;
    };
    
    next();
});

    // Add this AFTER your global middleware but BEFORE routes
// Add this AFTER your global middleware but BEFORE routes
app.use((req, res, next) => {
    const originalRedirect = res.redirect;
    res.redirect = function(url) {
        console.log('🔴 Redirect attempted to:', url);
        console.log('   Stack trace:', new Error().stack);
        
        try {
            // Test if URL is valid
            new URL(url, `${req.protocol}://${req.get('host')}`);
            console.log('   ✅ URL is valid');
        } catch (e) {
            console.error('   ❌ INVALID URL DETECTED:', e.message);
            console.error('   Full error:', e);
            // Instead of continuing, redirect to a safe fallback
            console.log('   ⚠️ Redirecting to safe fallback: /auth/login');
            return originalRedirect.call(this, '/auth/login');
        }
        
        originalRedirect.call(this, url);
    };
    next();
});

// Add this after session middleware
app.use((req, res, next) => {
    console.log(`\n📨 ${req.method} ${req.url}`);
    console.log('   Headers:', {
        host: req.get('host'),
        referer: req.get('referer'),
        'user-agent': req.get('user-agent')?.substring(0, 50)
    });
    
    // Log session data (without sensitive info)
    if (req.session) {
        console.log('   Session ID exists:', !!req.session.id);
        console.log('   User ID:', req.session.userId);
    }
    
    next();
});

// Add this RIGHT AFTER cookieParser, BEFORE anything else
app.use((req, res, next) => {
    console.log('\n🎯 REQUEST STARTED:', req.method, req.url);
    console.log('   Timestamp:', new Date().toISOString());
    
    // Monkey patch res.json to catch errors
    const originalJson = res.json;
    res.json = function(data) {
        console.log('   📦 JSON Response sent for', req.url);
        return originalJson.call(this, data);
    };
    
    // Add error handler for this request
    req.on('error', (err) => {
        console.error('🚨 Request error:', err);
    });
    
    next();
});

// Add this BEFORE your routes
app.get('/debug/env', (req, res) => {
    res.json({
        NODE_ENV: process.env.NODE_ENV,
        BASE_URL: process.env.BASE_URL,
        DOMAIN: process.env.DOMAIN,
        MONGODB_URI: process.env.MONGODB_URI ? 'Set' : 'Not set',
        PORT: process.env.PORT,
        hasSession: !!req.session,
        sessionID: req.session?.id,
        hasCsrfSecret: !!req.session?.csrfSecret,
        headers: {
            host: req.get('host'),
            origin: req.get('origin'),
            referer: req.get('referer')
        }
    });
});

    // ==================== Rate Limiting ====================
    app.use('/api/', rateLimiter.api);
    app.use('/auth/', rateLimiter.auth);

    // ==================== CSRF Protection ====================
    // This must come AFTER session but BEFORE routes
    app.use(setupCsrf)
    
    // ==================== Routes ====================

    // Home page route
    app.get('/', (req, res) => {
        res.render('home', { 
            title: 'MozAic - Buy Data, Airtime & Pay Bills',
            bodyClass: 'home-page',
            flashMessages: req.flash()
        });
    });

    // Add this BEFORE your other routes
app.get('/test-simple', (req, res) => {
    res.json({ 
        status: 'ok',
        session: !!req.session,
        message: 'Simple test route working' 
    });
});

    // Load auth routes
    console.log('📂 Loading auth routes from: ./src/routes/web/auth.js');
    try {
        const authRoutes = require('./src/routes/web/auth');
        app.use('/auth', authRoutes);
        console.log('✅ Auth routes loaded successfully');
        
        if (authRoutes.stack) {
            console.log('📋 Auth routes registered:');
            authRoutes.stack.forEach(layer => {
                if (layer.route) {
                    const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
                    console.log(`   ${methods} ${layer.route.path}`);
                }
            });
        }
    } catch (error) {
        console.error('❌ Failed to load auth routes:', error.message);
    }

    // Load dashboard routes
    console.log('\n📂 Loading dashboard routes from: ./src/routes/web/dashboard.js');
    try {
        const dashboardRoutes = require('./src/routes/web/dashboard');
        app.use('/dashboard', dashboardRoutes);
        console.log('✅ Dashboard routes loaded successfully');
    } catch (error) {
        console.error('❌ Failed to load dashboard routes:', error.message);
    }

    // Load API routes
    console.log('\n📂 Loading API routes from: ./src/routes/api/index.js');
    try {
        const apiRoutes = require('./src/routes/api/index');
        app.use('/api', apiRoutes);
        console.log('✅ API routes loaded successfully');
    } catch (error) {
        console.error('❌ Failed to load API routes:', error.message);
    }

    // Test route
    app.get('/test', (req, res) => {
        res.send('✅ Server test route working!');
    });

    // ==================== Health Check ====================
    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV,
            mongodb: 'connected'
        });
    });

    // ==================== 404 Handler ====================
    app.use((req, res) => {
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(404).json({
                ok: false,
                error: 'Endpoint not found'
            });
        }
        
        try {
            res.status(404).render('error/404', {
                title: 'Page Not Found',
                bodyClass: 'error-page',
                flashMessages: req.flash ? req.flash() : {}
            });
        } catch (error) {
            res.status(404).send(`
                <html>
                    <head><title>404 Not Found</title></head>
                    <body style="font-family: Arial; text-align: center; padding: 50px;">
                        <h1>404 - Page Not Found</h1>
                        <p>The page you're looking for doesn't exist.</p>
                        <a href="/" style="color: #667eea; text-decoration: none;">Go Home</a>
                    </body>
                </html>
            `);
        }
    });

    // ==================== Error Handler ====================
    app.use(errorHandler);

    // ==================== Start Server ====================
    const PORT = process.env.PORT || 3000;
    const server = http.createServer(app);

    server.listen(PORT, () => {
        logger.info(`✅ Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
        logger.info(`📝 Base URL: ${process.env.BASE_URL || `https://${server.address().address}:${PORT}`}`);
        logger.info(`🏠 Home page: /`);
        logger.info(`🔑 Login page: /auth/login`);
        logger.info(`📝 Register page: /auth/register`);
        logger.info(`📊 Dashboard: /dashboard/user`);
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (err) => {
        logger.error('UNHANDLED REJECTION! 💥 Shutting down...');
        logger.error(err.name, err.message, err.stack);
        server.close(() => {
            process.exit(1);
        });
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        logger.info('👋 SIGTERM received. Shutting down gracefully...');
        server.close(() => {
            logger.info('💤 Process terminated!');
            mongoose.connection.close();
        });
    });

}).catch(err => {
    console.error('Failed to connect to database:', err);
    process.exit(1);
});

module.exports = app;