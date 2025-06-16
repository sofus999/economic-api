const express = require('express');
const expressWinston = require('express-winston');
const path = require('path');
const { errorHandler } = require('./modules/core/error.handler');
const logger = require('./modules/core/logger');

// Import routes
const invoiceRoutes = require('./modules/invoices/invoice.routes');
const agreementRoutes = require('./modules/agreements/agreement.routes');
const paymentTermsRoutes = require('./modules/payment-terms/payment-terms.routes');
const productGroupsRoutes = require('./modules/product-groups/product-group.routes');
const productsRoutes = require('./modules/products/product.routes');
const supplierGroupsRoutes = require('./modules/supplier-groups/supplier-group.routes');
const suppliersRoutes = require('./modules/suppliers/supplier.routes');
const vatAccountsRoutes = require('./modules/vat-accounts/vat-account.routes');
const accountingYearRoutes = require('./modules/accounting-years/accounting-year.routes');
const accountRoutes = require('./modules/accounts/account.routes');
const customerRoutes = require('./modules/customers/customer.routes');
const departmentRoutes = require('./modules/departments/department.routes');
const departmentalDistributionRoutes = require('./modules/departmental-distributions/departmental-distribution.routes');
const journalRoutes = require('./modules/journals/journal.routes');
const syncRoutes = require('./modules/sync/sync.routes'); // Sync API route. General purpose sync route

// Create Express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Add request ID to each request
app.use((req, res, next) => {
  req.id = logger.requestId();
  next();
});

// Request logging middleware
app.use(expressWinston.logger({
  winstonInstance: logger,
  meta: true,
  msg: 'HTTP {{req.method}} {{req.url}}',
  expressFormat: true,
  colorize: false,
  ignoreRoute: (req, res) => {
    // Don't log health check routes to reduce noise
    return req.url === '/health' || req.url.startsWith('/static/');
  },
  dynamicMeta: (req, res) => {
    return {
      requestId: req.id,
      userId: req.user ? req.user.id : null
    };
  }
}));

// Simple health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Endpoints for modules
app.use('/api/invoices', invoiceRoutes);
app.use('/api/agreements', agreementRoutes);
app.use('/api/payment-terms', paymentTermsRoutes);
app.use('/api/product-group', productGroupsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/supplier-groups', supplierGroupsRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/vat-accounts', vatAccountsRoutes);
app.use('/api/accounting-years', accountingYearRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/departmental-distributions', departmentalDistributionRoutes);
app.use('/api/journals', journalRoutes);

// Sync all modules API route. This should be registered before the 404 handler
app.use('/api/sync', syncRoutes); 

// Serve UI pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/accounts', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/accounts/:agreement_number/:account_number', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error logging middleware
app.use(expressWinston.errorLogger({
  winstonInstance: logger,
  msg: 'HTTP {{err.status || 500}} - {{err.message}}',
  meta: true
}));

// Error handling middleware
app.use(errorHandler);

// 404 handler should be last
app.use((req, res) => {
  res.status(404).json({ error: { message: 'Not Found', code: 'NOT_FOUND' } });
});

module.exports = app;