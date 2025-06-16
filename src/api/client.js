// api/client.js
const axios = require('axios');
const config = require('../config');
const logger = require('../modules/core/logger');

class ApiClient {
  constructor(agreementGrantToken = null) {
    this.baseUrl = config.api.baseUrl;
    this.appSecretToken = config.api.appSecretToken;
    this.agreementGrantToken = agreementGrantToken || config.api.agreementGrantToken;
    
    this.client = this.createClient();
  }
  
  createClient() {
    const client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-AppSecretToken': this.appSecretToken,
        'X-AgreementGrantToken': this.agreementGrantToken,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // Increased from 10s to 30s to reduce timeouts on large responses
    });
    
    // Add request logging
    client.interceptors.request.use(request => {
      logger.debug(`API Request: ${request.method.toUpperCase()} ${request.baseURL}${request.url}`);
      return request;
    });
    
    // Add response logging
    client.interceptors.response.use(
      response => {
        logger.debug(`API Response: ${response.status} from ${response.config.url}`);
        return response;
      },
      error => {
        if (error.response) {
          logger.error(`API Error: ${error.response.status} from ${error.config.url} - ${error.response.statusText || 'Unknown error'}`);
          if (error.response.data && typeof error.response.data === 'object') {
            logger.debug(`Response details: ${JSON.stringify(error.response.data)}`);
          }
        } else if (error.request) {
          logger.error(`API Request failed: ${error.message || 'No response received'}`);
        } else {
          logger.error(`API Request setup error: ${error.message}`);
        }
        return Promise.reject(error);
      }
    );
    
    return client;
  }

  // Factory method to create client for a specific agreement
  static forAgreement(agreementGrantToken) {
    return new ApiClient(agreementGrantToken);
  }

  // Helper method to handle rate limiting by pausing execution
  async handleRateLimit(error) {
    if (error.response && (error.response.status === 429 || error.response.status === 503)) {
      // Use dynamic backoff time based on headers if available
      const retryAfter = error.response.headers['retry-after'];
      const waitTime = retryAfter ? (parseInt(retryAfter, 10) * 1000) : 5000;
      
      logger.warn(`Rate limit detected (${error.response.status}). Pausing for ${waitTime/1000} seconds...`);
      // Return a promise that resolves after the wait time
      return new Promise(resolve => setTimeout(resolve, waitTime));
    }
    // If not a rate limit error, rethrow
    throw error;
  }

  async get(endpoint, params = {}) {
    try {
      const response = await this.client.get(endpoint, { params });
      return response.data;
    } catch (error) {
      if (error.response && (error.response.status === 429 || error.response.status === 503)) {
        // Handle rate limiting
        await this.handleRateLimit(error);
        // Retry the same request after pause
        logger.info(`Retrying GET request to ${endpoint} after rate limit pause`);
        return this.get(endpoint, params);
      }
      logger.error(`API request failed for ${endpoint}: ${error.message}`);
      throw error;
    }
  }

  async getPaginated(endpoint, params = {}) {
    const results = [];
    // Increased page size to 500 (from 100) to reduce number of API calls
    let currentPage = `${endpoint}?skippages=0&pagesize=500`;
    
    try {
      while (currentPage) {
        // Extract path from full URL if needed
        const path = currentPage.startsWith(this.baseUrl) 
          ? currentPage.substring(this.baseUrl.length) 
          : currentPage;
          
        try {
          const response = await this.client.get(path);
          
          if (response.data.collection) {
            results.push(...response.data.collection);
          }
          
          // Check if there's a next page
          currentPage = response.data.pagination?.nextPage || null;
        } catch (error) {
          if (error.response && (error.response.status === 429 || error.response.status === 503)) {
            // Handle rate limiting
            await this.handleRateLimit(error);
            // Don't update currentPage, so we retry the same page
            logger.info(`Retrying paginated request to ${path} after rate limit pause`);
            continue;
          }
          throw error;
        }
      }
      
      return results;
    } catch (error) {
      logger.error(`API pagination failed for ${endpoint}: ${error.message}`);
      throw error;
    }
  }
  
  // Get agreement information for the current token
  async getAgreementInfo() {
    try {
      const selfData = await this.get('/self');
      return {
        agreementNumber: selfData.agreementNumber,
        companyName: selfData.company?.name || 'Unknown',
        userName: selfData.userName,
        companyVatNumber: selfData.company?.vatNumber || null
      };
    } catch (error) {
      logger.error(`Failed to fetch agreement info: ${error.message}`);
      throw error;
    }
  }
}

module.exports = ApiClient;