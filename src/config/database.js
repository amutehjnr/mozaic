const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
    try {
        // Remove all options - let Mongoose handle it automatically
        const conn = await mongoose.connect(process.env.MONGODB_URI);
        
        logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
        logger.info(`   Database: ${conn.connection.name}`);
        logger.info(`   Connection String Type: ${process.env.MONGODB_URI.includes('mongodb+srv') ? 'SRV' : 'Standard'}`);

        // Handle connection events
        mongoose.connection.on('error', (err) => {
            logger.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('MongoDB disconnected');
        });

        mongoose.connection.on('reconnected', () => {
            logger.info('MongoDB reconnected');
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            logger.info('MongoDB connection closed through app termination');
            process.exit(0);
        });

        return conn;
    } catch (error) {
        logger.error('Database connection error:', error);
        console.error('\n❌ CONNECTION ERROR DETAILS:');
        console.error('   Name:', error.name);
        console.error('   Message:', error.message);
        console.error('   Code:', error.code);
        process.exit(1);
    }
};

module.exports = connectDB;