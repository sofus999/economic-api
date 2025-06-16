const mysql = require('mysql2/promise');
const config = require('../config');
const logger = require('../modules/core/logger');

class Database {
  constructor() {
    // Connection configuration with authentication options
    this.poolConfig = {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: config.db.connectionLimit || 30, // Increased from 20 to 30
      queueLimit: 0,
      // Force mysql_native_password authentication
      authPlugins: {
        mysql_native_password: () => ({ 
          auth: async () => Buffer.from(config.db.password)
        })
      },
      // Connection resilience options
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000, // 10 seconds
      // Auto reconnect if connection is lost
      connectTimeout: 10000, // 10 seconds
      // MySQL-specific settings to reduce deadlocks
      typeCast: function (field, next) {
        if (field.type === 'TINY' && field.length === 1) {
          return (field.string() === '1'); // true = 1, false = 0
        }
        return next();
      }
    };

    this.createPool();
    
    // Schedule periodic health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 60000); // Check every minute
  }

  createPool() {
    try {
      this.pool = mysql.createPool(this.poolConfig);
      logger.info(`Database pool created with ${this.poolConfig.connectionLimit} connections`);
      
      // Handle pool errors
      this.pool.on('error', (err) => {
        logger.error('Database pool error:', err);
        
        // If connection is lost, attempt to re-establish
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || 
            err.code === 'ECONNREFUSED' || 
            err.code === 'ETIMEDOUT') {
          logger.warn('Database connection lost. Attempting to reconnect...');
          this.reconnect();
        }
      });
    } catch (error) {
      logger.error('Failed to create database pool:', error);
      // Schedule a reconnection attempt
      setTimeout(() => this.reconnect(), 5000);
    }
  }

  reconnect() {
    try {
      logger.info('Attempting to reconnect to database...');
      
      // Close existing pool if it exists
      if (this.pool) {
        try {
          this.pool.end();
        } catch (e) {
          logger.error('Error closing existing pool:', e);
        }
      }
      
      // Create a new connection pool
      this.createPool();
    } catch (error) {
      logger.error('Failed to reconnect to database:', error);
      // Schedule another reconnection attempt with exponential backoff
      setTimeout(() => this.reconnect(), 10000);
    }
  }

  async performHealthCheck() {
    try {
      // Execute a simple query to check connection health
      await this.query('SELECT 1 AS healthCheck');
      logger.debug('Database health check passed');
    } catch (error) {
      logger.error('Database health check failed:', error);
      this.reconnect();
    }
  }

  async query(sql, params = []) {
    try {
      const [rows, fields] = await this.pool.execute(sql, params);
      return rows;
    } catch (error) {
      // Handle specific error types
      if (error.code === 'PROTOCOL_CONNECTION_LOST' || 
          error.code === 'ECONNREFUSED' || 
          error.code === 'ETIMEDOUT') {
        logger.error('Database connection lost during query execution. Reconnecting...');
        this.reconnect();
        // Retry the query after a short delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.query(sql, params);
      }
      
      // Linux-specific: If prepared statement fails with complex SQL, try regular query
      if (error.code === 'ER_UNSUPPORTED_PS') {
        logger.warn('Using non-prepared statement for complex SQL (Linux compatibility)');
        return this.queryNonPrepared(sql, params);
      }
      
      // Log database errors properly
      logger.error(`Database query error: ${error.message}`);
      logger.error(`Query: ${sql}`);
      if (params && params.length) {
        logger.error('Params:', { params });
      }
      throw error;
    }
  }

  // Linux compatibility method for stored procedures and complex SQL
  async queryNonPrepared(sql, params = []) {
    try {
      const [rows, fields] = await this.pool.query(sql, params);
      return rows;
    } catch (error) {
      logger.error(`Database non-prepared query error: ${error.message}`);
      logger.error(`Query: ${sql}`);
      throw error;
    }
  }

  async getConnection() {
    try {
      return await this.pool.getConnection();
    } catch (error) {
      // Handle connection errors
      if (error.code === 'PROTOCOL_CONNECTION_LOST' || 
          error.code === 'ECONNREFUSED' || 
          error.code === 'ETIMEDOUT') {
        logger.error('Failed to get database connection:', error.message);
        this.reconnect();
        // Retry after a short delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.getConnection();
      }
      
      logger.error('Error getting database connection:', error.message);
      throw error;
    }
  }

  async transaction(callback, isolationLevel = 'READ COMMITTED') {
    let connection;
    let retries = 3;
    let delay = 1000; // Start with 1 second delay
    
    while (retries > 0) {
      try {
        connection = await this.getConnection();
        
        // Set transaction isolation level to reduce deadlock probability
        await connection.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
        await connection.beginTransaction();
        
        const result = await callback(connection);
        await connection.commit();
        return result;
      } catch (error) {
        if (connection) {
          try {
            await connection.rollback();
          } catch (rollbackError) {
            logger.error('Error rolling back transaction:', rollbackError);
          }
        }
        
        // Check if error is retryable
        if ((error.code === 'PROTOCOL_CONNECTION_LOST' || 
            error.code === 'ECONNREFUSED' || 
            error.code === 'ETIMEDOUT' ||
            error.code === 'ER_LOCK_DEADLOCK' ||
            error.code === 'ER_LOCK_WAIT_TIMEOUT') && 
            retries > 1) {
          retries--;
          logger.warn(`Retrying transaction after error: ${error.message}. Attempts remaining: ${retries}`);
          
          // Exponential backoff with jitter
          const jitter = Math.random() * 500; // 0-500ms random jitter
          await new Promise(resolve => setTimeout(resolve, delay + jitter));
          delay *= 2; // Double the delay for next retry
          continue;
        }
        
        throw error;
      } finally {
        if (connection) {
          connection.release();
        }
      }
    }
  }

  async close() {
    // Clear the health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.pool) {
      try {
        await this.pool.end();
        logger.info('Database connection pool closed');
      } catch (error) {
        logger.error('Error closing database connection pool:', error);
      }
    }
  }
}

// Handle application termination
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing database connections');
  await db.close();
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing database connections');
  await db.close();
});

const db = new Database();
module.exports = db;