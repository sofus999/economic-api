const express = require('express');
const invoiceController = require('./invoice.controller');
const db = require('../../db');
const InvoiceService = require('./invoice.service');

const router = express.Router();

// Main sync route - syncs all invoice types across all agreements
router.post('/sync', invoiceController.syncAllInvoices);

// Agreement-specific sync route
router.post('/agreements/:id/sync', invoiceController.syncAgreementInvoices);

// Get all invoices
router.get('/', invoiceController.getAllInvoices);

// Get invoice by invoice number and agreement number
router.get('/:agreement_number/:invoice_number', invoiceController.getInvoiceById);

// Get PDF for invoice with agreement number - direct implementation
router.get('/:agreement_number/:invoice_number/pdf', async (req, res) => {
  try {
    const { invoice_number, agreement_number } = req.params;
    
    // Convert to integers
    const invNumber = parseInt(invoice_number, 10);
    const agrNumber = parseInt(agreement_number, 10);
    
    // Use the enhanced service method to get the PDF
    const pdfStream = await InvoiceService.getInvoicePdf(invNumber, agrNumber);
    
    if (!pdfStream) {
      // Send a more detailed error response
      return res.status(404).json({ 
        error: 'PDF Not Found', 
        details: 'The PDF could not be found for this invoice. It might not exist or it may be in a different state.'
      });
    }
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${agrNumber}-${invNumber}.pdf"`);
    
    // Stream the PDF to the response
    pdfStream.pipe(res);
    
    // Handle any stream errors
    pdfStream.on('error', (streamError) => {
      console.error('PDF stream error:', streamError.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream Error', details: streamError.message });
      }
    });
    
  } catch (error) {
    console.error('PDF stream error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cleanup route for duplicate invoices
router.post('/cleanup', invoiceController.cleanupDuplicates);

// PDF test route - pass url and token directly for testing
router.get('/test-pdf', async (req, res) => {
  try {
    const { url, token } = req.query;
    
    if (!url || !token) {
      return res.status(400).json({ error: 'URL and token are required query parameters' });
    }
    
    // Get app secret token from config
    const appSecretToken = require('../../config').api.appSecretToken;
    
    console.log(`Test PDF route: Fetching from ${url}`);
    console.log(`Using token: ${token.substring(0, 10)}...`);
    
    // Make direct request with axios
    const axios = require('axios');
    const response = await axios({
      method: 'GET',
      url: url,
      headers: {
        'X-AppSecretToken': appSecretToken,
        'X-AgreementGrantToken': token,
        'Content-Type': 'application/json'
      },
      responseType: 'stream'
    });
    
    // Set appropriate headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="test.pdf"');
    
    // Pipe directly to response
    response.data.pipe(res);
  } catch (error) {
    console.error('PDF test error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;