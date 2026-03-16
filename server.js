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

// Middleware & utils
const rateLimiter = require('./src/middleware/rateLimiter');
const { errorHandler } = require('./src/middleware/errorHandler');
const { setupCsrf, generateToken } = require('./src/middleware/csrf');
const logger = require('./src/utils/logger');
const connectDB = require('./src/config/database');

const app = express();

// Handle uncaught exceptions & unhandled rejections
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    logger.error('UNCAUGHT EXCEPTION!', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason);
    logger.error('UNHANDLED REJECTION!', reason);
});

// ================ Security Middleware ==================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https://cdn.jsdelivr.net"],
            connectSrc: ["'self'", "https://api.flutterwave.com", "https://api.vtpass.com"],
        }
    },
    crossOriginEmbedderPolicy: false,
}));

// ================ CORS ==================
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? ['https://mozaic-eomm.onrender.com', process.env.BASE_URL].filter(Boolean)
        : ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
    optionsSuccessStatus: 200
}));

// ================ Compression & Parsers ==================
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ================ Static Files ==================
app.use(express.static(path.join(__dirname, 'public')));

// ================ MongoDB Connection ==================
console.log('🔄 Connecting to MongoDB...');
connectDB().then(async () => {
    console.log('✅ Database connected:', mongoose.connection.name);

    // Register models
    try {
        require('./src/models/User');
        require('./src/models/PasswordReset');
        require('./src/models/Wallet');
        require('./src/models/Transaction');
        require('./src/models/KycProfile');
        require('./src/models/Beneficiary');
        require('./src/models/Referral');
        console.log('✅ Models registered');
    } catch (err) {
        console.error('❌ Model registration failed:', err);
    }

    // ================ Session ==================
    const sessionConfig = {
        secret: process.env.SESSION_SECRET || 'dev-secret-key',
        resave: false,
        saveUninitialized: true,
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
            sameSite: 'lax'
        },
        name: 'mozaic.sid',
        rolling: true,
        proxy: true
    };

    if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
    app.use(session(sessionConfig));
    console.log('✅ Session initialized');

    // ================ Flash & Views ==================
    app.use(flash());
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // ================ Global Middleware ==================
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
        res.locals.url = (p) => p?.startsWith('/') ? p : '/' + (p || '');
        next();
    });

    // ================ Rate Limiting ==================
    app.use('/api/', rateLimiter.api);
    app.use('/auth/', rateLimiter.auth);

    // ================ CSRF Middleware ==================
    app.use(setupCsrf());

    // ================= Routes ==================
    // Home page
    app.get('/', (req, res) => {
        res.render('home', {
            title: 'MozAic - Buy Data, Airtime & Pay Bills',
            bodyClass: 'home-page',
            flashMessages: req.flash()
        });
    });

    // Session-less CSRF endpoint
    app.get('/api/csrf', (req, res) => {
        try {
            const token = generateToken();
            res.cookie('XSRF-TOKEN', token, {
                httpOnly: false,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000
            });
            res.json({ csrfToken: token });
        } catch (err) {
            console.error('❌ CSRF generation failed:', err);
            res.status(500).json({ ok: false, error: 'Failed to generate CSRF token' });
        }
    });

    // Health check
    app.get('/health', (req, res) => res.json({ status: 'healthy', time: Date.now() }));
    app.head('/health', (req, res) => res.status(200).end());
    app.head('/', (req, res) => res.status(200).end());

    // Debug routes
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

    // Load other routes
    try {
        app.use('/auth', require('./src/routes/web/auth'));
        app.use('/dashboard', require('./src/routes/web/dashboard'));
        app.use('/api', require('./src/routes/api/index'));
        console.log('✅ All routes loaded');
    } catch (err) {
        console.error('❌ Route loading error:', err);
    }

    // Test route
    app.get('/test', (req, res) => res.send('✅ Server test route working!'));

    // 404 handler
    app.use((req, res) => {
        if (req.xhr || req.path.startsWith('/api/')) {
            return res.status(404).json({ ok: false, error: 'Endpoint not found' });
        }
        res.status(404).render('error/404', {
            title: 'Page Not Found',
            bodyClass: 'error-page',
            flashMessages: req.flash ? req.flash() : {}
        });
    });

    // Global error handler
    app.use(errorHandler);

    // Start server
    const PORT = process.env.PORT || 3000;
    const server = http.createServer(app);
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`   Environment: ${process.env.NODE_ENV}`);
        console.log(`   Base URL: ${process.env.BASE_URL}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('SIGTERM received, closing server...');
        server.close(() => mongoose.connection.close());
    });

}).catch(err => {
    console.error('❌ DATABASE CONNECTION FAILED:', err);
    process.exit(1);
});

module.exports = app;