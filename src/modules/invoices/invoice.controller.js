const invoiceService = require('./invoice.service');
const logger = require('../core/logger');

class InvoiceController {
  // Sync all invoices across all agreements
  async syncAllInvoices(req, res, next) {
    try {
      // Parse performance options from query parameters
      const options = {
        skipLineItems: req.query.skipLineItems === 'true',
        maxLineItems: parseInt(req.query.maxLineItems) || 10
      };
      
      const result = await invoiceService.syncAllInvoices(options);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
  
  // Sync invoices for a specific agreement
  async syncAgreementInvoices(req, res, next) {
    try {
      const { id } = req.params;
      
      // Parse performance options from query parameters
      const options = {
        skipLineItems: req.query.skipLineItems === 'true',
        maxLineItems: parseInt(req.query.maxLineItems) || 10
      };
      
      const result = await invoiceService.syncInvoicesByAgreementId(id, options);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
  
  // Get all invoices
  async getAllInvoices(req, res, next) {
    try {
      const invoices = await invoiceService.getAllInvoices();
      res.json(invoices);
    } catch (error) {
      next(error);
    }
  }

  // Get invoice by ID
  async getInvoiceById(req, res, next) {
    try {
      const { invoice_number, agreement_number } = req.params;
      const invoice = await invoiceService.getInvoiceById(invoice_number, agreement_number);
      if (!invoice) {
        return res.status(404).json({ error: { message: 'Invoice not found', code: 'NOT_FOUND' } });
      }
      res.json(invoice);
    } catch (error) {
      next(error);
    }
  }

  // Get PDF for invoice
  async getInvoicePdf(req, res, next) {
    try {
      const { invoice_number, agreement_number } = req.params;
      const pdfStream = await invoiceService.getInvoicePdf(invoice_number, agreement_number);
      
      if (!pdfStream) {
        return res.status(404).json({ error: { message: 'PDF not found', code: 'PDF_NOT_FOUND' } });
      }
      
      // Set appropriate headers for PDF file
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="invoice-${agreement_number}-${invoice_number}.pdf"`);
      
      // Pipe the PDF stream to the response
      pdfStream.pipe(res);
    } catch (error) {
      logger.error(`Error fetching PDF for invoice ${req.params.invoice_number} (agreement ${req.params.agreement_number}):`, error.message);
      next(error);
    }
  }

  // Clean up duplicate invoices
  async cleanupDuplicates(req, res, next) {
    try {
      const results = await invoiceService.cleanupDuplicateInvoices();
      res.json(results);
    } catch (error) {
      next(error);
    }
  }


}

module.exports = new InvoiceController();