#!/usr/bin/env node

/**
 * Manual Sync Trigger Script
 * 
 * This script allows manual triggering of different sync operations for testing.
 */

require('dotenv').config();
const axios = require('axios');
const logger = require('../src/modules/core/logger');

const SYNC_ENDPOINTS = {
  daily: '/api/sync/daily',
  full: '/api/sync/full',
  all: '/api/sync',
  status: '/api/sync/status'
};

async function triggerSync(type = 'daily') {
  try {
    if (!SYNC_ENDPOINTS[type]) {
      throw new Error(`Unknown sync type: ${type}. Available: ${Object.keys(SYNC_ENDPOINTS).join(', ')}`);
    }
    
    const baseUrl = 'http://localhost:3000';
    const endpoint = SYNC_ENDPOINTS[type];
    const url = `${baseUrl}${endpoint}`;
    
    logger.info(`🚀 Triggering ${type} sync...`);
    logger.info(`📡 Calling: ${url}`);
    
    const startTime = Date.now();
    
    if (type === 'status') {
      // GET request for status
      const response = await axios.get(url, {
        timeout: 10000 // 10 second timeout for status
      });
      
      console.log('\n📊 SYNC STATUS RESPONSE:');
      console.log('=======================');
      console.log(JSON.stringify(response.data, null, 2));
      
    } else {
      // POST request for sync operations
      const response = await axios.post(url, {}, {
        timeout: 7200000, // 2 hour timeout for sync operations
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const duration = Date.now() - startTime;
      
      console.log('\n✅ SYNC COMPLETED SUCCESSFULLY!');
      console.log('===============================');
      console.log(`Duration: ${duration}ms (${(duration / 1000).toFixed(1)}s)`);
      console.log(`Total Records: ${response.data.totalCount || 'Unknown'}`);
      console.log(`Sync Type: ${response.data.syncType || type}`);
      
      if (response.data.results) {
        console.log('\n📋 DETAILED RESULTS:');
        console.log('===================');
        
        for (const [service, result] of Object.entries(response.data.results)) {
          const status = result.status || 'unknown';
          const count = result.totalCount || result.recordCount || 0;
          const emoji = status === 'success' ? '✅' : status === 'error' ? '❌' : status === 'skipped' ? '⏭️' : '❓';
          
          console.log(`${emoji} ${service}: ${count} records (${status})`);
          
          if (result.error) {
            console.log(`   Error: ${result.error}`);
          }
          if (result.reason) {
            console.log(`   Reason: ${result.reason}`);
          }
        }
      }
    }
    
    process.exit(0);
    
  } catch (error) {
    logger.error(`❌ ${type} sync failed:`, error.message);
    
    if (error.response) {
      console.log('\n🔍 ERROR RESPONSE:');
      console.log('==================');
      console.log(`Status: ${error.response.status}`);
      console.log(`Message: ${error.response.statusText}`);
      if (error.response.data) {
        console.log('Data:', JSON.stringify(error.response.data, null, 2));
      }
    }
    
    process.exit(1);
  }
}

// Get sync type from command line arguments
const syncType = process.argv[2] || 'daily';

if (require.main === module) {
  console.log('🔄 Manual Sync Trigger');
  console.log('======================');
  console.log(`Sync Type: ${syncType}`);
  console.log(`Available types: ${Object.keys(SYNC_ENDPOINTS).join(', ')}`);
  console.log('');
  
  triggerSync(syncType);
}

module.exports = { triggerSync }; 