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

    // ==================== Session Configuration - FIXED FOR RENDER ====================
    const sessionConfig = {
        secret: process.env.SESSION_SECRET || 'dev-secret-key',
        resave: false,
        saveUninitialized: true, // CRITICAL: Changed to true for Render
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
            // REMOVED domain option - let Express handle it
        },
        name: 'mozaic.sid',
        rolling: true,
        proxy: true // CRITICAL: Added for Render
    };

    if (process.env.NODE_ENV === 'production') {
        app.set('trust proxy', 1);
    }

    // IMPORTANT: Session MUST come before everything else
    app.use(session(sessionConfig));

    // ==================== Flash Messages ====================
    app.use(flash());

    // ==================== View Engine ====================
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // ==================== Critical Health Check Routes ====================
    // These must respond IMMEDIATELY for Render
    app.get('/health', (req, res) => {
        res.status(200).json({ status: 'healthy', time: Date.now() });
    });

    app.head('/health', (req, res) => {
        res.status(200).end();
    });

    app.head('/', (req, res) => {
        res.status(200).end();
    });

    // ==================== Global Middleware ====================
    app.use((req, res, next) => {
        res.locals.user = req.session?.user || null;
        res.locals.currentUrl = req.originalUrl;
        res.locals.messages = req.flash ? req.flash() : {};
        res.locals.queryParams = req.query;
        res.locals.env = process.env.NODE_ENV;
        res.locals.baseUrl = process.env.BASE_URL || `https://${req.get('host')}`;
        res.locals.nonce = crypto.randomBytes(16).toString('base64');
        res.locals.bodyClass = '';
        res.locals.formData = {};
        res.locals.csrfToken = '';
        
        // SIMPLIFIED url helper - no complex logic
        res.locals.url = (path) => {
            if (!path) return '';
            return path.startsWith('/') ? path : '/' + path;
        };
        
        next();
    });

    // ==================== Rate Limiting ====================
    app.use('/api/', rateLimiter.api);
    app.use('/auth/', rateLimiter.auth);

    // ==================== CSRF Protection - FIXED VERSION ====================
    try {
        app.use(setupCsrf());
        console.log('✅ CSRF middleware initialized');
    } catch (error) {
        console.error('❌ Failed to initialize CSRF:', error);
    }

    // ==================== Routes ====================

    // Home page route
    app.get('/', (req, res) => {
        res.render('home', { 
            title: 'MozAic - Buy Data, Airtime & Pay Bills',
            bodyClass: 'home-page',
            flashMessages: req.flash()
        });
    });

    // Debug route to check environment
    app.get('/debug/env', (req, res) => {
        res.json({
            NODE_ENV: process.env.NODE_ENV,
            BASE_URL: process.env.BASE_URL,
            hasSession: !!req.session,
            sessionID: req.session?.id,
            hasCsrfSecret: !!req.session?.csrfSecret,
            cookies: req.cookies
        });
    });

    // Load auth routes
    console.log('📂 Loading auth routes...');
    try {
        const authRoutes = require('./src/routes/web/auth');
        app.use('/auth', authRoutes);
        console.log('✅ Auth routes loaded successfully');
    } catch (error) {
        console.error('❌ Failed to load auth routes:', error.message);
    }

    // Load dashboard routes
    console.log('📂 Loading dashboard routes...');
    try {
        const dashboardRoutes = require('./src/routes/web/dashboard');
        app.use('/dashboard', dashboardRoutes);
        console.log('✅ Dashboard routes loaded successfully');
    } catch (error) {
        console.error('❌ Failed to load dashboard routes:', error.message);
    }

    // Load API routes
    console.log('📂 Loading API routes...');
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

    // ==================== 404 Handler ====================
    app.use((req, res) => {
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(404).json({
                ok: false,
                error: 'Endpoint not found'
            });
        }
        
        res.status(404).render('error/404', {
            title: 'Page Not Found',
            bodyClass: 'error-page',
            flashMessages: req.flash ? req.flash() : {}
        });
    });

    // ==================== Error Handler ====================
    app.use(errorHandler);

    // ==================== Start Server - FIXED FOR RENDER ====================
    const PORT = process.env.PORT || 3000;
    const server = http.createServer(app);

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`   Environment: ${process.env.NODE_ENV}`);
        console.log(`   Base URL: ${process.env.BASE_URL}`);
        console.log(`   Login page: /auth/login`);
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (err) => {
        console.error('UNHANDLED REJECTION:', err);
        server.close(() => process.exit(1));
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('SIGTERM received, shutting down...');
        server.close(() => {
            mongoose.connection.close();
        });
    });

}).catch(err => {
    console.error('Failed to connect to database:', err);
    process.exit(1);
});

module.exports = app;