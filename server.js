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
    console.error('\n========== UNCAUGHT EXCEPTION ==========');
    console.error('Time:', new Date().toISOString());
    console.error('Name:', err.name);
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    console.error('=========================================\n');
    logger.error('UNCAUGHT EXCEPTION!', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n========== UNHANDLED REJECTION ==========');
    console.error('Time:', new Date().toISOString());
    console.error('Reason:', reason);
    console.error('=========================================\n');
    logger.error('UNHANDLED REJECTION!', reason);
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

// ==================== Connect to MongoDB with Enhanced Error Handling ====================
console.log('\n🔄 Attempting to connect to MongoDB...');
console.log('   MongoDB URI exists:', !!process.env.MONGODB_URI);
if (process.env.MONGODB_URI) {
    console.log('   URI starts with:', process.env.MONGODB_URI.substring(0, 20) + '...');
}

connectDB().then(() => {
    console.log('✅ Database connected successfully');
    console.log('   Connection state:', mongoose.connection.readyState);
    console.log('   Database name:', mongoose.connection.name);
    console.log('   Host:', mongoose.connection.host);
    
    // Test the connection by running a simple command
    mongoose.connection.db.admin().ping((err, result) => {
        if (err) {
            console.error('❌ Database ping failed:', err);
            console.error('   This indicates a connection issue despite the initial success');
        } else {
            console.log('✅ Database ping successful');
        }
    });
    
    // ==================== Register ALL Models AFTER connection ====================
    console.log('\n📦 Registering Mongoose models...');
    
    try {
        require('./src/models/User');
        require('./src/models/PasswordReset');
        require('./src/models/Wallet');
        require('./src/models/Transaction');
        require('./src/models/KycProfile');
        require('./src/models/Beneficiary');
        require('./src/models/Referral');
        console.log('✅ All models registered successfully');
    } catch (modelError) {
        console.error('❌ Error registering models:', modelError);
    }

    // ==================== Session Configuration - FIXED FOR RENDER ====================
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
            sameSite: 'lax',
        },
        name: 'mozaic.sid',
        rolling: true,
        proxy: true
    };

    if (process.env.NODE_ENV === 'production') {
        app.set('trust proxy', 1);
    }

    app.use(session(sessionConfig));
    console.log('✅ Session middleware initialized');

    // ==================== Flash Messages ====================
    app.use(flash());

    // ==================== View Engine ====================
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // ==================== Critical Health Check Routes ====================
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
        
        res.locals.url = (path) => {
            if (!path) return '';
            return path.startsWith('/') ? path : '/' + path;
        };
        
        next();
    });

    // ==================== Rate Limiting ====================
    app.use('/api/', rateLimiter.api);
    app.use('/auth/', rateLimiter.auth);

    // ==================== CSRF Protection ====================
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

    // ==================== DIAGNOSTIC ROUTES ====================
    
    // Debug environment
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

    // Debug database connection
    app.get('/debug/db', async (req, res) => {
        try {
            const state = mongoose.connection.readyState;
            const stateMap = {
                0: 'disconnected',
                1: 'connected',
                2: 'connecting',
                3: 'disconnecting'
            };
            
            let pingResult = null;
            let collections = [];
            
            if (state === 1) {
                try {
                    pingResult = await mongoose.connection.db.admin().ping();
                    collections = await mongoose.connection.db.listCollections().toArray();
                    collections = collections.map(c => c.name);
                } catch (pingErr) {
                    pingResult = { error: pingErr.message };
                }
            }
            
            res.json({
                connectionState: stateMap[state] || 'unknown',
                readyState: state,
                databaseName: mongoose.connection.name,
                host: mongoose.connection.host,
                port: mongoose.connection.port,
                ping: pingResult,
                collections: collections,
                models: Object.keys(mongoose.models)
            });
        } catch (error) {
            res.status(500).json({ 
                error: error.message,
                stack: error.stack 
            });
        }
    });

    // Debug MongoDB URI (safe version)
    app.get('/debug/uri', (req, res) => {
        const uri = process.env.MONGODB_URI || '';
        const safeUri = uri.replace(/:[^:@]+@/, ':****@');
        res.json({
            exists: !!process.env.MONGODB_URI,
            safeUri: safeUri,
            length: uri.length,
            format: uri.startsWith('mongodb+srv://') ? 'SRV' : 'Standard'
        });
    });

    // Simple ping test
    app.get('/ping', (req, res) => {
        res.json({ pong: true, time: Date.now() });
    });

    // ==================== Load Routes ====================
    
    console.log('📂 Loading auth routes...');
    try {
        const authRoutes = require('./src/routes/web/auth');
        app.use('/auth', authRoutes);
        console.log('✅ Auth routes loaded successfully');
    } catch (error) {
        console.error('❌ Failed to load auth routes:', error.message);
    }

    console.log('📂 Loading dashboard routes...');
    try {
        const dashboardRoutes = require('./src/routes/web/dashboard');
        app.use('/dashboard', dashboardRoutes);
        console.log('✅ Dashboard routes loaded successfully');
    } catch (error) {
        console.error('❌ Failed to load dashboard routes:', error.message);
    }

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

    // Add this block to server.js alongside the other route loaders
    // (after the dashboard routes block, before the 404 handler)

    console.log('📂 Loading admin routes...');
    try {
       const adminRoutes = require('./src/routes/web/admin');
       app.use('/admin', adminRoutes);
       console.log('✅ Admin routes loaded successfully');
    } catch (error) {
      console.error('❌ Failed to load admin routes:', error.message);
    }

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

    // ==================== Start Server ====================
    const PORT = process.env.PORT || 3000;
    const server = http.createServer(app);

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`\n✅ Server running on port ${PORT}`);
        console.log(`   Environment: ${process.env.NODE_ENV}`);
        console.log(`   Base URL: ${process.env.BASE_URL}`);
        console.log(`   Login page: /auth/login`);
        console.log(`\n📊 Debug endpoints:`);
        console.log(`   - /ping`);
        console.log(`   - /debug/env`);
        console.log(`   - /debug/db`);
        console.log(`   - /debug/uri\n`);
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (err) => {
        console.error('UNHANDLED REJECTION:', err);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('SIGTERM received, shutting down...');
        server.close(() => {
            mongoose.connection.close();
        });
    });

}).catch(err => {
    console.error('\n❌❌❌ DATABASE CONNECTION FAILED ❌❌❌');
    console.error('Time:', new Date().toISOString());
    console.error('Error name:', err.name);
    console.error('Error message:', err.message);
    console.error('Error code:', err.code);
    console.error('Stack trace:', err.stack);
    
    // Check for specific MongoDB errors
    if (err.name === 'MongoServerError') {
        if (err.code === 18) {
            console.error('🔑 Authentication failed - check username/password in MONGODB_URI');
        } else if (err.code === 7) {
            console.error('🌐 Network error - check IP whitelist in MongoDB Atlas');
        }
    }
    
    if (err.message.includes('getaddrinfo')) {
        console.error('🌐 DNS resolution failed - check hostname in connection string');
    }
    
    if (err.message.includes('timed out')) {
        console.error('⏱️ Connection timeout - check network/firewall settings');
    }
    
    if (err.message.includes('bad auth')) {
        console.error('🔑 Authentication failed - username or password is incorrect');
    }
    
    process.exit(1);
});

module.exports = app;