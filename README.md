# E-conomic Data Management System

A comprehensive Node.js application for integrating with the E-conomic REST API, providing real-time synchronization, monitoring, and management of financial data with advanced PDF document handling and SharePoint integration.


##  Features

### Core Functionality
- **Real-time E-conomic API Integration** - Synchronize all financial data from multiple E-conomic agreements
- **Multi-Agreement Support** - Manage multiple E-conomic company agreements from a single dashboard
- **Automated PDF Document Management** - Download and link invoices, vouchers, and financial documents
- **SharePoint Integration** - Automatic budget and account mapping file synchronization
- **Health Monitoring System** - Comprehensive system health checks and alerting
- **RESTful API** - Complete REST API for all financial data access

### Data Modules
- **Invoices & Vouchers** - Customer invoices, supplier invoices, finance vouchers with PDF links
- **Accounting Data** - Chart of accounts, accounting years, periods, and journal entries  
- **Customer & Supplier Management** - Complete customer and supplier database
- **Product Catalog** - Products, product groups, and pricing information
- **Department Management** - Departments and departmental cost distributions
- **Payment Terms & VAT** - Payment terms and VAT account configurations

### Advanced Features
- **Intelligent PDF Linking** - Automatic PDF availability checking and document linking
- **PowerBI Optimization** - Pre-computed aggregation tables for PowerBI reporting
- **Automated Sync Scheduling** - Daily automated synchronization with error recovery
- **Log Management** - Automatic log rotation and cleanup
- **Production-Ready Deployment** - PM2 process management with auto-restart

## 🏗 Architecture

### Application Stack
- **Backend**: Node.js with Express.js framework
- **Database**: MySQL with connection pooling
- **Sync Service**: Python Flask API for CSV and SharePoint operations
- **Process Manager**: PM2 for production deployment
- **Frontend**: Bootstrap-based responsive dashboard
- **Logging**: Winston with daily log rotation

### Key Components
```
├── src/
│   ├── app.js              # Main Express application
│   ├── server.js           # Server setup and graceful shutdown
│   ├── modules/            # Modular business logic
│   │   ├── invoices/       # Invoice management
│   │   ├── vouchers/       # Voucher and document handling
│   │   ├── accounts/       # Chart of accounts
│   │   ├── accounting-years/ # Accounting periods and entries
│   │   └── [others]/       # Additional financial modules
│   ├── db/                 # Database migrations and connection
│   └── config/             # Configuration management
├── sync_api.py             # Python sync service
├── public/                 # Frontend dashboard
└── scripts/                # Deployment and maintenance scripts
```

## Quick Start

### Prerequisites
- **Node.js** 18.x or higher
- **MySQL** 8.0 or higher  
- **Python** 3.8+ (for sync service)
- **PM2** (for production deployment)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd economic-api-master
```

2. **Install Node.js dependencies**
```bash
npm install
```

3. **Set up Python environment**
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install Flask sqlalchemy pymysql pandas requests python-dotenv
```

4. **Configure environment variables**
```bash
# Copy template files
cp env.template .env
cp sharepoint.env.template sharepoint.env  
cp python.env.template python.env

# Edit .env with your database and E-conomic API credentials
# Edit sharepoint.env with SharePoint credentials (optional)
# Edit python.env with database URL
```

5. **Set up the database**
```bash
# Create MySQL database
mysql -u root -p -e "CREATE DATABASE economic_data;"

# Run migrations
npm run migrate
```

6. **Start the applications**
```bash
# Development mode
npm run dev

# Start Python sync service (in another terminal)
python sync_api.py

# Production mode
npm run start:prod
```

##  Configuration

### Environment Variables

#### Core Application (.env)
```bash
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_NAME=economic_data
DB_USER=your_db_user
DB_PASSWORD=your_secure_password
DB_ROOT_PASSWORD=your_root_password

# E-conomic API Configuration  
API_BASE_URL=https://restapi.e-conomic.com
APP_SECRET_TOKEN=your_economic_secret_token
AGREEMENT_GRANT_TOKEN=your_agreement_grant_token

# Application Configuration
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
```

#### SharePoint Integration (sharepoint.env)
```bash
SHAREPOINT_USERNAME=your_username@company.com
SHAREPOINT_PASSWORD=your_password
SHAREPOINT_SITE_URL=https://company.sharepoint.com/sites/YourSite
SHAREPOINT_ECONOMICS_FOLDER=/sites/YourSite/Documents/Economics/Account Mappings
SHAREPOINT_BUDGET_FOLDER=/sites/YourSite/Documents/Economics/Budget
```

### E-conomic API Setup

1. **Create E-conomic App Registration**
   - Log in to E-conomic Developer Portal
   - Create new application
   - Note down the App Secret Token

2. **Set up Agreement Access**
   - Request agreement access from E-conomic account owners
   - Each agreement provides a Grant Token
   - Add tokens via the web interface at `/health`

##  Usage

### Web Dashboard
- **Main Dashboard**: `http://localhost:3000` - Account balance overview and financial data
- **Health Monitoring**: `http://localhost:5000/health` - System health and management
- **Sync Dashboard**: `http://localhost:5000` - Synchronization operations and monitoring

### API Endpoints

#### Financial Data
```bash
# Accounts
GET /api/accounts                    # List all accounts
GET /api/accounts/:agreement/:number # Account details with entries

# Invoices  
GET /api/invoices                    # List invoices
GET /api/invoices/:agreement/:number/pdf # Download invoice PDF

# Vouchers
GET /api/vouchers/:agreement/:number # Voucher details  
GET /api/vouchers/:agreement/:number/pdf # Download voucher PDF

# Accounting Data
GET /api/accounting-years            # Accounting years and periods
GET /api/customers                   # Customer database
GET /api/suppliers                   # Supplier database
GET /api/departments                 # Department structure
GET /api/products                    # Product catalog
```

#### Synchronization
```bash
# Manual sync operations
POST /api/sync/all                   # Full data synchronization
POST /api/sync/daily                 # Daily sync (current year only)
POST /api/sync/full                  # Full sync with PDF checking

# Individual module sync
POST /api/sync/invoices             # Sync invoices only
POST /api/sync/accounts             # Sync chart of accounts
POST /api/sync/customers            # Sync customer database
```

### Database Schema

Key tables include:
- `invoices` & `invoice_lines` - Invoice data with line items
- `accounts` - Chart of accounts with balances
- `accounting_entries` - Journal entries and transactions
- `customers` & `suppliers` - Contact databases
- `products` & `product_groups` - Product catalog
- `departments` & `departmental_distributions` - Organizational structure
- `sync_logs` - Synchronization history and error tracking
- `agreement_configs` - Multi-agreement management

## Synchronization

### Automated Daily Sync
The system runs automated daily synchronization at 3 AM:
- Syncs current accounting year data with PDF checking
- Updates invoices, customers, and reference data
- Logs all operations with error recovery
- Automatic retry with exponential backoff

### Manual Sync Operations
Use the health dashboard (`http://localhost:5000/health`) to:
- Trigger immediate synchronization
- Monitor sync progress and logs
- Handle sync errors and conflicts
- Register new agreement tokens

### SharePoint Integration
Automatically downloads and imports:
- Budget mapping files from SharePoint
- Account mapping configurations
- Updates database with latest financial planning data

##  Health Monitoring

Access the health dashboard at `http://localhost:5000/health` for:

### System Status
- **Database Connectivity** - Connection pool status
- **API Authentication** - E-conomic API access verification  
- **Sync Health** - Recent synchronization status
- **Error Rates** - Sync error monitoring with alerts

### Critical Alerts
- **Missing Account Mappings** - Agreements without account mapping
- **Missing Budget Data** - Agreements without budget records
- **High Error Rates** - Sync failures requiring attention

### Agreement Management
- Add new E-conomic agreement tokens
- Monitor per-agreement sync status
- View agreement-specific data counts

##  Production Deployment

### Using PM2 (Recommended)
```bash
# Install PM2 globally
npm install -g pm2

# Start all services
npm run start:prod

# Monitor services
pm2 status
pm2 logs

# Auto-restart on server reboot
pm2 startup
pm2 save
```

### Service Configuration
The ecosystem includes:
- `economic-api` - Main Node.js application (port 3000)
- `economic-sync-api` - Python sync service (port 5000)  
- `economic-daily-sync` - Daily sync cron job (3 AM)
- `economic-log-cleanup` - Log rotation (1 AM)
- `economic-db-log-cleanup` - Database log cleanup (4 AM)

### Nginx Configuration (Optional)
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /health {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

##  Development

### Project Structure
```
economic-api-master/
├── src/
│   ├── modules/           # Business logic modules
│   ├── db/               # Database migrations and connection
│   ├── config/           # Configuration management
│   └── routes/           # Express route definitions
├── public/               # Frontend dashboard files
├── scripts/              # Deployment and maintenance scripts
├── logs/                 # Application log files
└── ecosystem.config.js   # PM2 process configuration
```

### Adding New Modules
1. Create module directory in `src/modules/`
2. Implement: `model.js`, `service.js`, `controller.js`, `routes.js`
3. Add database migration in `src/db/migrations/`
4. Register routes in `src/app.js`

### Database Migrations
```bash
# Run migrations
npm run migrate

# Create new migration
# Add file in src/db/migrations/ following naming convention
# 001-description.js, 002-description.js, etc.
```

## 📝 Available Scripts

```bash
npm start                    # Start production server
npm run dev                  # Start development server with debug logging
npm run migrate              # Run database migrations
npm run cleanup-logs         # Clean up old log files
npm run cleanup-db-logs      # Clean up database sync logs
npm run start:prod           # Start with PM2 in production
npm run stop:prod            # Stop PM2 processes
npm run restart:prod         # Restart PM2 processes
npm run status               # Check PM2 status
```

##  Logging

### Log Files
- `logs/application.log` - Main application events
- `logs/sync-api.log` - Python sync service logs
- `logs/pm2-*.log` - PM2 process logs
- Database sync logs stored in `sync_logs` table

### Log Levels
- **ERROR** - System errors requiring attention
- **WARN** - Warnings and recoverable issues  
- **INFO** - General operational information
- **DEBUG** - Detailed debugging information

##  Security

### Security Considerations
- All credentials stored in environment files (never in code)
- Database connections use secure credentials
- API tokens encrypted and managed securely
- File permissions restricted on environment files

### Security Setup
See [SECURITY_SETUP.md](SECURITY_SETUP.md) for detailed security configuration.

##  Troubleshooting

### Common Issues

#### Sync Failures
```bash
# Check sync logs
tail -f logs/application.log

# Check database sync logs
mysql -u root -p economic_data -e "SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 10;"

# Restart sync service
pm2 restart economic-sync-api
```

#### Database Connection Issues
```bash
# Test database connection
mysql -u economic_api -p economic_data

# Check database process
sudo systemctl status mysql
```

#### PDF Download Issues
- Verify E-conomic API permissions for document access
- Check agreement token validity
- Monitor API rate limits in logs

### Service Management Scripts
```bash
# Check all services
./scripts/check_services.sh

# Restart all services  
./scripts/restart_services.sh

# Trigger manual sync
./scripts/trigger_daily_sync.sh
```

## Performance Optimization

### Database Optimization
- Pre-computed aggregation tables for PowerBI
- Indexed tables for fast querying
- Connection pooling for concurrent access
- Automatic cleanup of old sync logs

### Sync Optimization
- Parallel processing where possible
- Incremental sync for large datasets
- PDF availability checking to reduce API calls
- Intelligent retry logic with exponential backoff

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

### Development Guidelines
- Follow existing code structure and naming conventions
- Add appropriate error handling and logging
- Update documentation for new features
- Test sync operations thoroughly before deployment

## License

This project is licensed under the ISC License.


##  Additional Documentation

- [Security Setup Guide](SECURITY_SETUP.md) - Detailed security configuration
- [Health Monitoring Documentation](HEALTH_MONITORING_README.md) - Monitoring system details
- [Voucher PDF Implementation](VOUCHER_PDF_IMPLEMENTATION.md) - PDF handling documentation


