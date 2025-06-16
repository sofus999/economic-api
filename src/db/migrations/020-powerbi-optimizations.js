const db = require('../index');
const logger = require('../../modules/core/logger');

async function up() {
  logger.info('Running migration: 020-powerbi-optimizations');
  
  try {
    // 1. First drop the date dimension table 
    await db.query('DROP TABLE IF EXISTS dim_date');
    
    // Create the date dimension table
    await db.query(`
      CREATE TABLE dim_date (
        date_id INT PRIMARY KEY,  -- YYYYMMDD format
        full_date DATE NOT NULL UNIQUE,
        day_of_week INT NOT NULL,
        day_name VARCHAR(10) NOT NULL,
        day_of_month INT NOT NULL,
        day_of_year INT NOT NULL,
        week_of_year INT NOT NULL,
        month INT NOT NULL,
        month_name VARCHAR(10) NOT NULL,
        quarter INT NOT NULL,
        year INT NOT NULL,
        is_weekend BOOLEAN NOT NULL,
        fiscal_year INT,
        fiscal_quarter INT,
        INDEX idx_date (full_date),
        INDEX idx_year_month (year, month),
        INDEX idx_fiscal (fiscal_year, fiscal_quarter)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create a stored procedure to populate the date dimension
    await db.query(`DROP PROCEDURE IF EXISTS populate_date_dimension;`);
    
    await db.query(`
      CREATE PROCEDURE populate_date_dimension()
      BEGIN
        DECLARE start_date DATE DEFAULT '2019-01-01';
        DECLARE end_date DATE DEFAULT '2040-12-31';
        DECLARE loop_date DATE DEFAULT start_date;
        
        WHILE loop_date <= end_date DO
          INSERT INTO dim_date (
            date_id, 
            full_date,
            day_of_week,
            day_name,
            day_of_month,
            day_of_year,
            week_of_year,
            month,
            month_name,
            quarter,
            year,
            is_weekend
          ) VALUES (
            YEAR(loop_date) * 10000 + MONTH(loop_date) * 100 + DAY(loop_date),
            loop_date,
            WEEKDAY(loop_date) + 1,
            DAYNAME(loop_date),
            DAY(loop_date),
            DAYOFYEAR(loop_date),
            WEEK(loop_date),
            MONTH(loop_date),
            MONTHNAME(loop_date),
            QUARTER(loop_date),
            YEAR(loop_date),
            IF(WEEKDAY(loop_date) >= 5, 1, 0)
          );
          
          SET loop_date = DATE_ADD(loop_date, INTERVAL 1 DAY);
        END WHILE;
      END
    `);
    
    // Call the procedure to populate the dates
    logger.info('Populating date dimension table...');
    await db.query('CALL populate_date_dimension();');
    
    // Drop the procedure after use
    await db.query('DROP PROCEDURE IF EXISTS populate_date_dimension;');

    // Verify the date population
    logger.info('Verifying date dimension...');
    const countResult = await db.query(`
      SELECT 
        COUNT(*) AS total_dates,
        MIN(full_date) AS min_date,
        MAX(full_date) AS max_date,
        DATEDIFF(MAX(full_date), MIN(full_date)) + 1 AS expected_count
      FROM 
        dim_date
    `);
    
    if (countResult && countResult[0] && countResult[0][0]) {
      const result = countResult[0][0];
      logger.info(`Date dimension contains ${result.total_dates} dates from ${result.min_date} to ${result.max_date}`);
      
      if (parseInt(result.total_dates) !== parseInt(result.expected_count)) {
        logger.warn(`WARNING: Date dimension may have gaps. Expected ${result.expected_count} dates but found ${result.total_dates}`);
      } else {
        logger.info('Date dimension verified: continuous date sequence with no gaps');
      }
    } else {
      logger.warn('Could not verify date dimension: unexpected query result structure');
    }

    // 2. Create Customer Dimension Table (for star schema)
    await db.query(`
      CREATE OR REPLACE VIEW dim_customer AS
      SELECT 
        c.customer_number,
        c.agreement_number,
        c.name,
        c.currency,
        c.country,
        c.email,
        c.payment_terms_number,
        c.customer_group_number,
        c.balance,
        c.due_amount,
        c.created_at,
        c.updated_at
      FROM 
        customers c
    `);

    // 3. Create Account Dimension Table
    await db.query(`
      CREATE OR REPLACE VIEW dim_account AS
      SELECT 
        a.account_number,
        a.agreement_number,
        a.name AS account_name,
        a.account_type,
        a.balance,
        a.debit_credit,
        a.created_at,
        a.updated_at
      FROM 
        accounts a
    `);

    // 4. Create Department Dimension Table
    await db.query(`
      CREATE OR REPLACE VIEW dim_department AS
      SELECT 
        d.department_number,
        d.agreement_number,
        d.name AS department_name,
        d.created_at,
        d.updated_at
      FROM 
        departments d
    `);

    // 5. Create Supplier Dimension Table
    await db.query(`
      CREATE OR REPLACE VIEW dim_supplier AS
      SELECT 
        s.supplier_number,
        s.agreement_number,
        s.name AS supplier_name,
        s.supplier_group_number,
        s.currency,
        s.country,
        s.email,
        s.payment_terms_number,
        s.barred,
        s.created_at,
        s.updated_at
      FROM 
        suppliers s
    `);

    // 6. Create Product Dimension Table
    await db.query(`
      CREATE OR REPLACE VIEW dim_product AS
      SELECT 
        p.product_number,
        p.agreement_number,
        p.name AS product_name,
        p.product_group_number,
        p.unit,
        p.price,
        p.cost_price,
        p.barred,
        p.created_at,
        p.updated_at
      FROM 
        products p
    `);

    // 7. Create Invoice Facts View (for star schema)
    await db.query(`
      CREATE OR REPLACE VIEW fact_invoices AS
      SELECT 
        i.invoice_number,
        i.customer_number,
        i.agreement_number,
        YEAR(i.date) * 10000 + MONTH(i.date) * 100 + DAY(i.date) AS invoice_date_id,
        YEAR(i.due_date) * 10000 + MONTH(i.due_date) * 100 + DAY(i.due_date) AS due_date_id,
        i.net_amount,
        i.gross_amount,
        i.vat_amount,
        i.payment_status,
        i.currency,
        i.exchange_rate,
        i.date AS invoice_date,
        i.due_date
      FROM 
        invoices i
    `);

    // 8. Create Invoice Lines Facts View
    await db.query(`
      CREATE OR REPLACE VIEW fact_invoice_lines AS
      SELECT 
        il.invoice_id,
        il.agreement_number,
        il.customer_number,
        il.line_number,
        il.product_number,
        il.quantity,
        il.unit_price,
        il.discount_percentage,
        il.total_net_amount,
        i.date AS invoice_date,
        YEAR(i.date) * 10000 + MONTH(i.date) * 100 + DAY(i.date) AS invoice_date_id
      FROM 
        invoice_lines il
      JOIN 
        invoices i ON il.invoice_id = i.invoice_number 
        AND il.agreement_number = i.agreement_number
        AND il.customer_number = i.customer_number
    `);

    // 9. Create Accounting Entry Facts View
    await db.query(`
      CREATE OR REPLACE VIEW fact_accounting_entries AS
      SELECT 
        ae.entry_number,
        ae.year_id,
        ae.period_number,
        ae.agreement_number,
        ae.account_number,
        ae.amount,
        ae.amount_in_base_currency,
        ae.currency,
        ae.entry_date,
        YEAR(ae.entry_date) * 10000 + MONTH(ae.entry_date) * 100 + DAY(ae.entry_date) AS entry_date_id,
        ae.entry_text,
        ae.entry_type,
        ae.voucher_number
      FROM 
        accounting_entries ae
    `);

    // 10. Create Aggregation Tables for common reports
    
    // 10.1 Monthly Invoice Aggregation
    await db.query(`
      CREATE TABLE IF NOT EXISTS agg_monthly_invoices (
        year INT NOT NULL,
        month INT NOT NULL,
        agreement_number INT NOT NULL,
        customer_number INT,
        currency VARCHAR(3),
        total_invoice_count INT,
        total_net_amount DECIMAL(15,2),
        total_gross_amount DECIMAL(15,2),
        total_vat_amount DECIMAL(15,2),
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (year, month, agreement_number),
        INDEX idx_customer (customer_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 10.2 Monthly Account Balance Aggregation
    await db.query(`
      CREATE TABLE IF NOT EXISTS agg_monthly_account_balances (
        year INT NOT NULL,
        month INT NOT NULL,
        account_number INT NOT NULL,
        agreement_number INT NOT NULL,
        opening_balance DECIMAL(15,2),
        debit_amount DECIMAL(15,2),
        credit_amount DECIMAL(15,2),
        closing_balance DECIMAL(15,2),
        transaction_count INT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (year, month, account_number, agreement_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 10.3 Quarterly Revenue by Department
    await db.query(`
      CREATE TABLE IF NOT EXISTS agg_quarterly_department_revenue (
        year INT NOT NULL,
        quarter INT NOT NULL,
        department_number INT NOT NULL,
        agreement_number INT NOT NULL,
        total_revenue DECIMAL(15,2),
        transaction_count INT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (year, quarter, department_number, agreement_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 11. Create procedure to refresh aggregation tables
    await db.query(`DROP PROCEDURE IF EXISTS sp_refresh_aggregation_tables;`);
    
    await db.query(`
      CREATE PROCEDURE sp_refresh_aggregation_tables()
      BEGIN
        -- Clear and repopulate Monthly Invoice Aggregation
        TRUNCATE TABLE agg_monthly_invoices;
        INSERT IGNORE INTO agg_monthly_invoices (
          year, month, agreement_number, customer_number, currency,
          total_invoice_count, total_net_amount, total_gross_amount, total_vat_amount
        )
        SELECT 
          YEAR(date) AS year,
          MONTH(date) AS month,
          agreement_number,
          customer_number,
          currency,
          COUNT(*) AS total_invoice_count,
          SUM(net_amount) AS total_net_amount,
          SUM(gross_amount) AS total_gross_amount,
          SUM(vat_amount) AS total_vat_amount
        FROM 
          invoices
        WHERE 
          payment_status != 'draft'
          AND date IS NOT NULL  -- Ensure we don't include NULL dates
        GROUP BY 
          YEAR(date), MONTH(date), agreement_number, customer_number, currency;
        
        -- Clear and repopulate Monthly Account Balance Aggregation
        -- (Implementation will depend on your accounting data structure)
        TRUNCATE TABLE agg_monthly_account_balances;
        INSERT IGNORE INTO agg_monthly_account_balances (
          year, month, account_number, agreement_number,
          debit_amount, credit_amount, transaction_count
        )
        SELECT 
          YEAR(ae.entry_date) AS year,
          MONTH(ae.entry_date) AS month,
          ae.account_number,
          ae.agreement_number,
          SUM(CASE WHEN ae.amount_in_base_currency > 0 THEN ae.amount_in_base_currency ELSE 0 END) AS debit_amount,
          SUM(CASE WHEN ae.amount_in_base_currency < 0 THEN ABS(ae.amount_in_base_currency) ELSE 0 END) AS credit_amount,
          COUNT(*) AS transaction_count
        FROM 
          accounting_entries ae
        WHERE
          ae.entry_date IS NOT NULL  -- Ensure we don't include NULL dates
        GROUP BY 
          YEAR(ae.entry_date), MONTH(ae.entry_date), ae.account_number, ae.agreement_number;
          
        -- Update opening and closing balances (simplified calculation)
        UPDATE agg_monthly_account_balances
        SET closing_balance = debit_amount - credit_amount;
        
        -- Clear and repopulate Quarterly Department Revenue
        -- Using a direct query on departments to avoid complex joins that might not work with current schema
        TRUNCATE TABLE agg_quarterly_department_revenue;
        INSERT IGNORE INTO agg_quarterly_department_revenue (
          year, quarter, department_number, agreement_number, total_revenue, transaction_count
        )
        SELECT 
          YEAR(CURDATE()) AS year,
          QUARTER(CURDATE()) AS quarter,
          d.department_number,
          d.agreement_number,
          0 AS total_revenue,  -- Default to 0 for initial load
          0 AS transaction_count  -- Default to 0 for initial load
        FROM 
          departments d;
        
        -- You can update the revenue data later with more specific calculations
        -- This simplified approach ensures the table exists and has basic data
      END
    `);

    // 12. Create an event to refresh aggregation tables daily
    await db.query(`DROP EVENT IF EXISTS evt_daily_refresh_aggregation;`);
    
    try {
      await db.query(`
        CREATE EVENT evt_daily_refresh_aggregation
        ON SCHEDULE EVERY 1 DAY
        STARTS CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 1 HOUR
        DO
          CALL sp_refresh_aggregation_tables();
      `);
      logger.info('Created scheduled event for daily data refresh');
    } catch (eventError) {
      logger.warn('Could not create scheduled event. This might be due to event scheduler being off: ' + eventError.message);
      logger.info('Continuing migration without event scheduler');
    }

    // 13. Create a view to simplify reporting on invoice payments over time
    await db.query(`
      CREATE OR REPLACE VIEW vw_invoice_payment_timeline AS
      SELECT 
        i.invoice_number,
        i.agreement_number,
        i.customer_number,
        c.name AS customer_name,
        i.date AS invoice_date,
        YEAR(i.date) * 10000 + MONTH(i.date) * 100 + DAY(i.date) AS invoice_date_id,
        i.due_date,
        YEAR(i.due_date) * 10000 + MONTH(i.due_date) * 100 + DAY(i.due_date) AS due_date_id,
        i.payment_status,
        i.net_amount,
        i.gross_amount,
        i.vat_amount,
        DATEDIFF(i.due_date, i.date) AS payment_terms_days,
        CASE 
          WHEN i.payment_status = 'paid' THEN 0
          WHEN i.payment_status = 'pending' AND i.due_date >= CURDATE() THEN 0
          WHEN i.payment_status = 'overdue' OR (i.payment_status = 'pending' AND i.due_date < CURDATE()) THEN DATEDIFF(CURDATE(), i.due_date)
          ELSE 0
        END AS days_overdue
      FROM 
        invoices i
      LEFT JOIN 
        customers c ON i.customer_number = c.customer_number AND i.agreement_number = c.agreement_number
      WHERE 
        i.payment_status != 'draft'
        AND i.date IS NOT NULL  -- Ensure we don't include NULL dates
    `);

    logger.info('Migration 020-powerbi-optimizations completed successfully');
  } catch (error) {
    logger.error('Error running migration 020-powerbi-optimizations:', error.message);
    throw error;
  }
}

async function down() {
  logger.info('Reverting migration: 020-powerbi-optimizations');
  
  try {
    // Drop aggregation refresh event
    try {
      await db.query('DROP EVENT IF EXISTS evt_daily_refresh_aggregation');
      logger.info('Dropped event: evt_daily_refresh_aggregation');
    } catch (eventError) {
      logger.warn('Error dropping event: ' + eventError.message);
    }
    
    // Drop stored procedure
    try {
      await db.query('DROP PROCEDURE IF EXISTS sp_refresh_aggregation_tables');
      logger.info('Dropped procedure: sp_refresh_aggregation_tables');
    } catch (procError) {
      logger.warn('Error dropping procedure: ' + procError.message);
    }
    
    // Drop views in reverse order
    const views = [
      'vw_invoice_payment_timeline',
      'fact_accounting_entries',
      'fact_invoice_lines',
      'fact_invoices',
      'dim_product',
      'dim_supplier',
      'dim_department',
      'dim_account',
      'dim_customer'
    ];
    
    for (const view of views) {
      try {
        await db.query(`DROP VIEW IF EXISTS ${view}`);
        logger.info(`Dropped view: ${view}`);
      } catch (viewError) {
        logger.warn(`Error dropping view ${view}: ${viewError.message}`);
      }
    }
    
    // Drop aggregation tables
    const tables = [
      'agg_quarterly_department_revenue',
      'agg_monthly_account_balances',
      'agg_monthly_invoices',
      'dim_date'
    ];
    
    for (const table of tables) {
      try {
        await db.query(`DROP TABLE IF EXISTS ${table}`);
        logger.info(`Dropped table: ${table}`);
      } catch (tableError) {
        logger.warn(`Error dropping table ${table}: ${tableError.message}`);
      }
    }
    
    logger.info('Migration 020-powerbi-optimizations reverted successfully');
  } catch (error) {
    logger.error('Error reverting migration 020-powerbi-optimizations:', error.message);
    throw error;
  }
}

module.exports = { up, down }; 