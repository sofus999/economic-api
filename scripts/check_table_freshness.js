#!/usr/bin/env node

/**
 * Check Table Freshness Script
 * 
 * This script checks when each table was last updated to identify stale data.
 * Useful for debugging sync issues.
 */

require('dotenv').config();
const db = require('../src/db');
const logger = require('../src/modules/core/logger');

const TABLES_TO_CHECK = [
  'accounts',
  'accounting_entries', 
  'invoices',
  'customers',
  'suppliers',
  'products',
  'vat_accounts',
  'payment_terms',
  'departments',
  'journals'
];

async function checkTableFreshness() {
  try {
    logger.info('🔍 Checking table freshness...');
    
    const results = {};
    
    for (const table of TABLES_TO_CHECK) {
      try {
        // Check if table has updated_at column
        const columns = await db.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = ? 
          AND COLUMN_NAME IN ('updated_at', 'created_at')
        `, [table]);
        
        if (columns.length === 0) {
          results[table] = {
            status: 'no_timestamp_columns',
            message: 'Table has no updated_at or created_at columns'
          };
          continue;
        }
        
        // Get table statistics
        const hasUpdatedAt = columns.some(col => col.COLUMN_NAME === 'updated_at');
        const timestampCol = hasUpdatedAt ? 'updated_at' : 'created_at';
        
        const stats = await db.query(`
          SELECT 
            COUNT(*) as total_records,
            MAX(${timestampCol}) as latest_update,
            MIN(${timestampCol}) as earliest_record,
            COUNT(CASE WHEN ${timestampCol} >= DATE_SUB(NOW(), INTERVAL 1 DAY) THEN 1 END) as last_24h,
            COUNT(CASE WHEN ${timestampCol} >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as last_7d,
            COUNT(CASE WHEN ${timestampCol} >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as last_30d
          FROM ${table}
        `);
        
        const stat = stats[0];
        const latestUpdate = new Date(stat.latest_update);
        const daysSinceUpdate = Math.floor((Date.now() - latestUpdate.getTime()) / (1000 * 60 * 60 * 24));
        
        results[table] = {
          status: daysSinceUpdate > 7 ? 'stale' : daysSinceUpdate > 1 ? 'aging' : 'fresh',
          total_records: stat.total_records,
          latest_update: latestUpdate.toISOString(),
          days_since_update: daysSinceUpdate,
          records_last_24h: stat.last_24h,
          records_last_7d: stat.last_7d,
          records_last_30d: stat.last_30d,
          timestamp_column: timestampCol
        };
        
      } catch (error) {
        results[table] = {
          status: 'error',
          error: error.message
        };
      }
    }
    
    // Print results
    console.log('\n📊 TABLE FRESHNESS REPORT');
    console.log('========================\n');
    
    const fresh = [];
    const aging = [];
    const stale = [];
    const errors = [];
    
    for (const [table, data] of Object.entries(results)) {
      const status = data.status;
      const emoji = status === 'fresh' ? '✅' : 
                   status === 'aging' ? '⚠️' : 
                   status === 'stale' ? '❌' : '💥';
      
      console.log(`${emoji} ${table.toUpperCase()}`);
      console.log(`   Status: ${status}`);
      
      if (data.total_records !== undefined) {
        console.log(`   Records: ${data.total_records}`);
        console.log(`   Last Update: ${data.latest_update} (${data.days_since_update} days ago)`);
        console.log(`   Recent Activity: ${data.records_last_24h} (24h) | ${data.records_last_7d} (7d) | ${data.records_last_30d} (30d)`);
      } else if (data.error) {
        console.log(`   Error: ${data.error}`);
      } else {
        console.log(`   Message: ${data.message}`);
      }
      console.log('');
      
      if (status === 'fresh') fresh.push(table);
      else if (status === 'aging') aging.push(table);
      else if (status === 'stale') stale.push(table);
      else errors.push(table);
    }
    
    // Summary
    console.log('📋 SUMMARY');
    console.log('==========');
    console.log(`✅ Fresh (updated within 24h): ${fresh.length} tables`);
    console.log(`⚠️  Aging (1-7 days old): ${aging.length} tables`);
    console.log(`❌ Stale (>7 days old): ${stale.length} tables`);
    console.log(`💥 Errors: ${errors.length} tables`);
    
    if (stale.length > 0) {
      console.log(`\n🚨 STALE TABLES REQUIRING ATTENTION:`);
      stale.forEach(table => console.log(`   - ${table}`));
    }
    
    if (aging.length > 0) {
      console.log(`\n⚠️  AGING TABLES TO MONITOR:`);
      aging.forEach(table => console.log(`   - ${table}`));
    }
    
    // Return exit code based on stale tables
    process.exit(stale.length > 0 ? 1 : 0);
    
  } catch (error) {
    logger.error('Error checking table freshness:', error.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  checkTableFreshness();
}

module.exports = { checkTableFreshness }; 