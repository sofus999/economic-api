require('dotenv').config();
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Function to log messages to both console and file
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  
  const logFilePath = path.join(logsDir, 'setup-db.log');
  fs.appendFileSync(logFilePath, `[${timestamp}] ${message}\n`);
}

async function setupDatabase() {
  log('Starting database setup...');
  let connection;
  
  try {
    // Connection configuration for root connection (without database)
    const rootConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_ROOT_USER || 'root',
      password: process.env.DB_ROOT_PASSWORD || '',
      // Windows systems typically don't need special authentication plugins
      // But we'll keep this for compatibility
      authPlugins: {
        mysql_native_password: () => ({ 
          auth: async () => Buffer.from(process.env.DB_ROOT_PASSWORD || '')
        })
      }
    };
    
    // Try to connect to server
    try {
      log('Connecting to MariaDB/MySQL server...');
      connection = await mysql.createConnection(rootConfig);
      log('Connected to server as root/admin user');
    } catch (err) {
      log(`Error connecting with first method: ${err.message}`);
      
      // Try alternate connection method
      delete rootConfig.authPlugins;
      
      log('Trying alternate connection method...');
      connection = await mysql.createConnection(rootConfig);
      log('Connected with alternate method');
    }
    
    // Create database if it doesn't exist
    const dbName = process.env.DB_NAME || 'economic_data';
    log(`Creating database '${dbName}' if it doesn't exist...`);
    
    await connection.query(`
      CREATE DATABASE IF NOT EXISTS \`${dbName}\`
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    
    log(`Database '${dbName}' created or verified`);
    
    // Create application user with appropriate permissions if needed
    const createUser = process.env.CREATE_DB_USER === 'true';
    if (createUser) {
      const dbUser = process.env.DB_USER || 'economic_api';
      const dbUserPass = process.env.DB_PASSWORD || 'password';
      
      log(`Creating database user '${dbUser}' if it doesn't exist...`);
      
      // Create user (ignoring error if exists)
      try {
        // For Windows, simplify the user creation - '%' works for localhost too
        await connection.query(`
          CREATE USER IF NOT EXISTS '${dbUser}'@'%' 
          IDENTIFIED BY '${dbUserPass}'
        `);
      } catch (err) {
        log(`Note: ${err.message}`);
      }
      
      // Grant permissions
      try {
        await connection.query(`
          GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'%'
        `);
        
        await connection.query('FLUSH PRIVILEGES');
        log(`Permissions granted to '${dbUser}'`);
      } catch (err) {
        log(`Warning: Could not grant permissions: ${err.message}`);
      }
    }
    
    // Test connecting with the application user
    let appConnection;
    try {
      const appUser = process.env.DB_USER || 'economic_api';
      const appPass = process.env.DB_PASSWORD || 'password';
      
      log(`Testing connection with application user '${appUser}'...`);
      
      const appConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: appUser,
        password: appPass,
        database: dbName
      };
      
      appConnection = await mysql.createConnection(appConfig);
      log('Application user connection successful!');
      await appConnection.end();
    } catch (err) {
      log(`Warning: Could not connect with application user: ${err.message}`);
      log('You may need to check user permissions or connection settings');
    }
    
    log('Database setup completed successfully');
    return true;
    
  } catch (error) {
    log(`Error setting up database: ${error.message}`);
    if (error.stack) {
      log(`Stack trace: ${error.stack}`);
    }
    return false;
  } finally {
    if (connection) {
      await connection.end();
      log('Database connection closed');
    }
  }
}

// Run setup if this script is executed directly
if (require.main === module) {
  setupDatabase()
    .then((success) => {
      log(success ? 'Setup completed successfully' : 'Setup completed with warnings');
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      log(`Setup failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = setupDatabase;