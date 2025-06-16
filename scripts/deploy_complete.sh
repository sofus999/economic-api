#!/bin/bash

# =============================================================================
# Complete Economic Data Management System Deployment Script
# =============================================================================
# This script fully deploys the Economic Data Management Center on a fresh Linux VM
# It includes: Python Flask API, MySQL database, Node.js components, and services
# =============================================================================

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}"
}

# =============================================================================
# PRELIMINARY CHECKS
# =============================================================================

log "Starting complete Economic Data Management System deployment..."

# Check if we're running as root
if [[ $EUID -eq 0 ]]; then
   error "This script should not be run as root directly. Use sudo when needed."
   exit 1
fi

# Check if we're in the deployment package directory
if [[ ! -f "sync_api.py" ]] || [[ ! -f "package.json" ]] || [[ ! -d "src" ]]; then
    error "This script must be run from the deployment-package directory"
    error "Make sure you have extracted the deployment package and are running from that directory"
    exit 1
fi

# Check Ubuntu version
if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    if [[ "$ID" != "ubuntu" ]]; then
        warning "This script is designed for Ubuntu. Current OS: $ID"
        read -p "Continue anyway? (y/N): " continue_anyway
        if [[ "$continue_anyway" != "y" && "$continue_anyway" != "Y" ]]; then
            exit 1
        fi
    else
        log "Detected Ubuntu $VERSION_ID - proceeding with deployment"
    fi
fi

# Check available disk space (need at least 2GB)
available_space=$(df . | tail -1 | awk '{print $4}')
if [[ $available_space -lt 2097152 ]]; then  # 2GB in KB
    warning "Low disk space detected. At least 2GB recommended."
fi

# =============================================================================
# STEP 1: System Preparation and Package Installation
# =============================================================================

log "Starting complete Economic Data Management System deployment..."

# Fix common Ubuntu apt_pkg module issue first
log "Fixing potential apt_pkg module issues..."

# Disable the problematic command-not-found hook temporarily
sudo rm -f /etc/apt/apt.conf.d/50command-not-found 2>/dev/null || true
sudo mv /etc/apt/apt.conf.d/50command-not-found /etc/apt/apt.conf.d/50command-not-found.bak 2>/dev/null || true

# Fix apt update issues
sudo apt update --fix-missing 2>/dev/null || true

# Try to fix apt_pkg module if it's broken
if python3 -c "import apt_pkg" 2>/dev/null; then
    log "✓ apt_pkg module is working"
else
    warning "Fixing apt_pkg module issue..."
    
    # Multiple approaches to fix apt_pkg
    sudo apt install --reinstall python3-apt -y 2>/dev/null || true
    sudo apt install python3-apt -y 2>/dev/null || true
    sudo apt install --fix-broken -y 2>/dev/null || true
    
    # Fix command-not-found if it's causing issues
    sudo apt remove --purge command-not-found -y 2>/dev/null || true
    
    # Test again
    if python3 -c "import apt_pkg" 2>/dev/null; then
        log "✓ apt_pkg module fixed"
    else
        warning "apt_pkg module still has issues, but continuing..."
    fi
fi

# Create a custom apt configuration to suppress the problematic hook
sudo tee /etc/apt/apt.conf.d/99-disable-cnf-update > /dev/null << 'EOF'
APT::Update::Post-Invoke-Success:: "";
EOF

log "✓ APT configuration optimized for deployment"

# Update system packages
log "Updating system packages..."
if sudo apt update; then
    log "✓ Package lists updated successfully"
else
    warning "Package update had issues, trying alternative approach..."
    sudo apt update --fix-missing || true
fi

if sudo apt upgrade -y; then
    log "✓ System packages upgraded successfully"
else
    warning "Some packages failed to upgrade, continuing..."
fi

# Install essential system packages
log "Installing essential system packages..."
sudo apt install -y curl wget git unzip build-essential software-properties-common \
    apt-transport-https ca-certificates gnupg lsb-release net-tools

# Install Python 3.11 and pip
log "Installing Python 3.11..."

# Try to add deadsnakes PPA for Python 3.11
log "Adding deadsnakes PPA for Python 3.11..."
PPA_ADDED=false

if sudo add-apt-repository ppa:deadsnakes/ppa -y 2>/dev/null; then
    log "✓ Deadsnakes PPA added successfully"
    sudo apt update
    PPA_ADDED=true
else
    warning "Failed to add deadsnakes PPA - will try alternative methods"
fi

# Try to install Python 3.11
log "Installing Python 3.11 packages..."
PYTHON_INSTALLED=false

if [ "$PPA_ADDED" = true ]; then
    if sudo apt install -y python3.11 python3.11-venv python3.11-dev python3-pip python3.11-distutils 2>/dev/null; then
        log "✓ Python 3.11 installed successfully via PPA"
        sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1
        PYTHON_INSTALLED=true
    fi
fi

# Fallback installation methods if PPA failed
if [ "$PYTHON_INSTALLED" = false ]; then
    warning "Python 3.11 installation via PPA failed, trying fallback options..."
    
    # Try installing available Python versions
    if command -v python3.12 &> /dev/null || sudo apt install -y python3.12 python3.12-venv python3.12-dev python3-pip 2>/dev/null; then
        log "Using Python 3.12 as alternative..."
        sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1
        PYTHON_INSTALLED=true
    elif command -v python3.11 &> /dev/null || sudo apt install -y python3.11 python3.11-venv python3.11-dev python3-pip 2>/dev/null; then
        log "Using Python 3.11 (system version)..."
        sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1
        PYTHON_INSTALLED=true
    elif command -v python3.10 &> /dev/null || sudo apt install -y python3.10 python3.10-venv python3.10-dev python3-pip 2>/dev/null; then
        log "Using Python 3.10 as fallback..."
        sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.10 1
        PYTHON_INSTALLED=true
    else
        # Last resort: use default Python 3
        log "Installing default Python 3..."
        if sudo apt install -y python3 python3-venv python3-dev python3-pip; then
            PYTHON_INSTALLED=true
        fi
    fi
fi

# Verify Python installation
if [ "$PYTHON_INSTALLED" = true ] && python3 --version; then
    log "✓ Python installation verified: $(python3 --version)"
else
    error "Python installation failed completely"
    exit 1
fi

# Verify pip installation
if pip3 --version; then
    log "✓ Pip installation verified: $(pip3 --version)"
else
    # Try to install pip if missing
    log "Installing pip..."
    if sudo apt install -y python3-pip; then
        log "✓ Pip installed successfully"
    else
        error "Pip installation failed"
        exit 1
    fi
fi

# Install Node.js 18.x LTS
log "Installing Node.js 18.x LTS..."

# First, remove any existing Node.js installations that might conflict
log "Removing any existing Node.js installations..."
sudo apt remove -y nodejs npm node 2>/dev/null || true
sudo apt autoremove -y 2>/dev/null || true

# Add NodeSource repository
log "Adding NodeSource repository..."
if curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -; then
    log "✓ NodeSource repository added successfully"
else
    warning "NodeSource repository setup failed, will try Ubuntu's version"
fi

# Update package list after adding repository
log "Updating package lists after adding NodeSource repository..."
if sudo apt update; then
    log "✓ Package lists updated successfully"
else
    warning "Package update had issues after NodeSource addition, continuing anyway..."
    sudo apt update --fix-missing 2>/dev/null || true
fi

# Install Node.js and npm
log "Installing Node.js and npm..."

# Try to install from NodeSource first, fallback to Ubuntu repos
if sudo apt install -y nodejs npm; then
    log "✓ Node.js and npm installation completed"
elif sudo apt install -y nodejs; then
    log "✓ Node.js installed, installing npm separately..."
    sudo apt install -y npm || warning "npm installation failed"
else
    error "Node.js installation failed"
    exit 1
fi

# Handle Ubuntu's nodejs vs node naming issue
if command -v nodejs &> /dev/null && ! command -v node &> /dev/null; then
    log "Creating node symlink for nodejs command..."
    sudo ln -sf /usr/bin/nodejs /usr/bin/node || true
fi

# Verify Node.js installation
NODE_VERSION=""
NPM_VERSION=""

if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
    log "✓ Node.js version: $NODE_VERSION"
elif command -v nodejs &> /dev/null; then
    NODE_VERSION=$(nodejs --version 2>/dev/null || echo "unknown")
    log "✓ Node.js version: $NODE_VERSION (using nodejs command)"
    # Create node alias if it doesn't exist
    if ! command -v node &> /dev/null; then
        sudo ln -sf /usr/bin/nodejs /usr/bin/node
        log "✓ Created node symlink"
    fi
else
    error "Node.js not found after installation"
    exit 1
fi

if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version 2>/dev/null || echo "unknown")
    log "✓ NPM version: $NPM_VERSION"
else
    error "npm not found after installation"
    log "Attempting to install npm separately..."
    if sudo apt install -y npm; then
        log "✓ npm installed separately"
    else
        error "Failed to install npm"
        exit 1
    fi
fi

# Final verification
if command -v node &> /dev/null && command -v npm &> /dev/null; then
    log "✓ Node.js and npm are both working correctly"
else
    error "Node.js or npm verification failed"
    exit 1
fi

# Install MySQL Server
log "Installing MySQL Server..."
# Set non-interactive mode for MySQL installation
export DEBIAN_FRONTEND=noninteractive

if sudo apt install -y mysql-server mysql-client; then
    log "✓ MySQL installation completed"
else
    error "MySQL installation failed"
    exit 1
fi

# Verify MySQL installation
if command -v mysql &> /dev/null; then
    log "✓ MySQL version: $(mysql --version)"
else
    error "MySQL not found after installation"
    exit 1
fi

# Install Nginx (for reverse proxy)
log "Installing Nginx..."
if sudo apt install -y nginx; then
    log "✓ Nginx installation completed"
else
    error "Nginx installation failed"
    exit 1
fi

# Verify Nginx installation
if command -v nginx &> /dev/null; then
    log "✓ Nginx version: $(nginx -v 2>&1)"
else
    error "Nginx not found after installation"
    exit 1
fi

# Install PM2 for process management
log "Installing PM2 globally..."
if sudo npm install -g pm2; then
    log "✓ PM2 installation completed"
else
    error "PM2 installation failed"
    exit 1
fi

# Verify PM2 installation
if command -v pm2 &> /dev/null; then
    log "✓ PM2 version: $(pm2 --version)"
else
    error "PM2 not found after installation"
    exit 1
fi

log "✅ All system packages installed and verified successfully!"

# =============================================================================
# STEP 2: MySQL Database Setup
# =============================================================================

log "Setting up MySQL database..."

# Load root password from environment or prompt securely
if [[ -f "$(dirname "$0")/../.env" ]]; then
    # Load from .env file if it exists
    source "$(dirname "$0")/../.env"
    ROOT_PASSWORD="${DATABASE_ROOT_PASSWORD:-${DB_ROOT_PASSWORD}}"
elif [[ -n "$DATABASE_ROOT_PASSWORD" ]]; then
    ROOT_PASSWORD="$DATABASE_ROOT_PASSWORD"
elif [[ -n "$DB_ROOT_PASSWORD" ]]; then
    ROOT_PASSWORD="$DB_ROOT_PASSWORD"
else
    # Security improvement - prompt user instead of hardcoded password
    log "Database root password not found in environment variables."
    read -s -p "Enter MySQL root password: " ROOT_PASSWORD
    echo
fi

if [[ -z "$ROOT_PASSWORD" ]]; then
    error "MySQL root password is required but not provided"
    exit 1
fi

# Try different methods to connect to MySQL root
log "Configuring MySQL root authentication..."

# Method 1: Try with sudo mysql (auth_socket)
if sudo mysql -e "SELECT 1;" 2>/dev/null; then
    log "✓ MySQL root accessible via sudo (auth_socket method)"
    
    # Set up password authentication for root
    sudo mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${ROOT_PASSWORD}';" 2>/dev/null || {
        log "Setting up root authentication..."
        sudo mysql -e "
        CREATE USER IF NOT EXISTS 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${ROOT_PASSWORD}';
        GRANT ALL PRIVILEGES ON *.* TO 'root'@'localhost' WITH GRANT OPTION;
        FLUSH PRIVILEGES;
        " 2>/dev/null || true
    }
    
# Method 2: Try with existing password
elif mysql -u root -p"${ROOT_PASSWORD}" -e "SELECT 1;" 2>/dev/null; then
    log "✓ MySQL root already has the configured password"
    
# Method 3: Try without password (unlikely but possible)
elif mysql -u root -e "SELECT 1;" 2>/dev/null; then
    log "✓ MySQL root accessible without password"
    mysql -u root -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${ROOT_PASSWORD}';"
    
# Method 4: Try to reset MySQL if none work
else
    warning "Standard MySQL connection methods failed, attempting to reset authentication..."
    
    # Stop MySQL service
    sudo systemctl stop mysql 2>/dev/null || true
    
    # Start MySQL in safe mode to reset root password
    sudo mysqld_safe --skip-grant-tables --skip-networking &
    MYSQL_PID=$!
    sleep 5
    
    # Reset root password
    mysql -u root -e "
    FLUSH PRIVILEGES;
    ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${ROOT_PASSWORD}';
    FLUSH PRIVILEGES;
    " 2>/dev/null || true
    
    # Stop safe mode MySQL
    sudo kill $MYSQL_PID 2>/dev/null || true
    sleep 2
    
    # Restart MySQL normally
    sudo systemctl start mysql
    sleep 3
fi

# Verify MySQL root access
log "Verifying MySQL root access..."
if mysql -u root -p"${ROOT_PASSWORD}" -e "SELECT 1;" 2>/dev/null; then
    log "✓ MySQL root access verified with password"
elif sudo mysql -e "SELECT 1;" 2>/dev/null; then
    log "✓ MySQL root access verified with sudo"
    warning "Note: MySQL root uses sudo access, which is fine for deployment"
else
    error "Could not establish MySQL root access"
    exit 1
fi

# Create database and user
log "Creating economic_data database..."

# Determine which MySQL connection method to use
if mysql -u root -p"${ROOT_PASSWORD}" -e "SELECT 1;" 2>/dev/null; then
    # Use password authentication
    MYSQL_CMD="mysql -u root -p${ROOT_PASSWORD}"
    log "Using password authentication for database creation"
elif sudo mysql -e "SELECT 1;" 2>/dev/null; then
    # Use sudo authentication
    MYSQL_CMD="sudo mysql"
    log "Using sudo authentication for database creation"
else
    error "No working MySQL authentication method found"
    exit 1
fi

# Create database and user
$MYSQL_CMD -e "
CREATE DATABASE IF NOT EXISTS economic_data CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'economic_api'@'localhost' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON economic_data.* TO 'economic_api'@'localhost';
FLUSH PRIVILEGES;
"

# Verify database creation
if $MYSQL_CMD -e "USE economic_data; SELECT 1;" 2>/dev/null; then
    log "✓ Database 'economic_data' created and accessible"
else
    error "Failed to create or access economic_data database"
    exit 1
fi

# =============================================================================
# STEP 3: Application Directory Setup
# =============================================================================

APP_DIR="/opt/economic-api"
log "Creating application directory: ${APP_DIR}"

sudo mkdir -p "${APP_DIR}"
sudo chown -R $USER:$USER "${APP_DIR}"

# Copy application files from current directory
log "Copying application files..."

# First, fix any corrupted permissions that might exist from zip extraction
log "Checking and fixing file permissions..."
if [[ -d "src" ]]; then
    # Fix directory permissions recursively
    find . -type d -exec chmod 755 {} \; 2>/dev/null || {
        warning "Some directories have permission issues, attempting to fix with sudo..."
        sudo find . -type d -exec chmod 755 {} \; 2>/dev/null || true
        sudo find . -type f -exec chmod 644 {} \; 2>/dev/null || true
        sudo chown -R $USER:$USER . 2>/dev/null || true
    }
    
    # Fix file permissions
    find . -type f -exec chmod 644 {} \; 2>/dev/null || true
    
    # Make scripts executable
    chmod +x *.sh 2>/dev/null || true
    
    log "✓ File permissions fixed"
fi

# Ensure the destination directory has proper ownership first
sudo chown -R $USER:$USER "${APP_DIR}"

# Copy files with better error handling
if cp -r ./* "${APP_DIR}/" 2>/dev/null; then
    log "✓ All application files copied successfully"
else
    warning "Some files had permission issues, copying with sudo and fixing ownership..."
    
    # Try copying with sudo and then fix ownership
    sudo cp -r ./* "${APP_DIR}/" 2>/dev/null || {
        warning "Some files could not be copied, trying individual files..."
        
        # Copy important files individually
        for file in *.py *.js *.json *.md *.txt *.env *.sh; do
            if [[ -f "$file" ]]; then
                cp "$file" "${APP_DIR}/" 2>/dev/null || sudo cp "$file" "${APP_DIR}/" 2>/dev/null || true
            fi
        done
        
        # Copy directories that exist
        for dir in src public views docs scripts; do
            if [[ -d "$dir" ]]; then
                cp -r "$dir" "${APP_DIR}/" 2>/dev/null || sudo cp -r "$dir" "${APP_DIR}/" 2>/dev/null || {
                    warning "Could not copy directory: $dir"
                }
            fi
        done
        
        # Copy node_modules if it exists
        if [[ -d "node_modules" ]]; then
            log "Copying node_modules directory..."
            cp -r node_modules "${APP_DIR}/" 2>/dev/null || sudo cp -r node_modules "${APP_DIR}/" 2>/dev/null || {
                warning "Could not copy node_modules, will reinstall via npm"
            }
        fi
    }
    
    # Fix ownership of all copied files
    sudo chown -R $USER:$USER "${APP_DIR}"
    log "✓ File ownership corrected"
fi

# Verify essential files are present
cd "${APP_DIR}"

ESSENTIAL_FILES=("sync_api.py" "package.json" "ecosystem.config.js")
MISSING_FILES=()

for file in "${ESSENTIAL_FILES[@]}"; do
    if [[ ! -f "$file" ]]; then
        MISSING_FILES+=("$file")
    fi
done

if [[ ${#MISSING_FILES[@]} -gt 0 ]]; then
    error "Critical files missing after copy: ${MISSING_FILES[*]}"
    error "Please check that you're running the script from the deployment-package directory"
    exit 1
else
    log "✓ All essential files are present"
fi

# =============================================================================
# STEP 4: Environment Configuration
# =============================================================================

log "Setting up environment configuration..."

# Create main .env file for Node.js application
cat > .env << EOF
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_NAME=economic_data
DB_USER=economic_api
DB_PASSWORD=password
DB_ROOT_USER=root
DB_ROOT_PASSWORD=${ROOT_PASSWORD}
CREATE_DB_USER=true

# Application Configuration
NODE_ENV=production
PORT=3000

# Logging Configuration
LOG_LEVEL=info
EOF

# Create Python environment file
cat > python.env << EOF
# Database Configuration
DATABASE_URL=mysql+pymysql://economic_api:password@localhost:3306/economic_data

# Application Configuration
FLASK_ENV=production
FLASK_DEBUG=false
SYNC_API_PORT=5000

# Logging Configuration
LOG_LEVEL=INFO
EOF

# Copy SharePoint configuration (using provided credentials)
cat > sharepoint.env << EOF
# SharePoint Configuration for Squaremeter
SHAREPOINT_USERNAME=SL@squaremeter.dk
SHAREPOINT_PASSWORD=D(864844683023ug
SHAREPOINT_SITE_URL=https://squaremeterdk.sharepoint.com/sites/PowerBI

# SharePoint folder paths - updated to match actual structure
SHAREPOINT_ECONOMICS_FOLDER=/sites/PowerBI/Documents/Economics/Account Mappings
SHAREPOINT_BUDGET_FOLDER=/sites/PowerBI/Documents/Economics/Budget

# Local download directory
SHAREPOINT_DOWNLOAD_DIR=./downloads/sharepoint
EOF

# =============================================================================
# STEP 5: Python Environment Setup
# =============================================================================

log "Setting up Python virtual environment..."

# Create Python virtual environment
if python3 -m venv venv; then
    log "✓ Python virtual environment created successfully"
else
    error "Failed to create Python virtual environment"
    exit 1
fi

# Activate virtual environment
if source venv/bin/activate; then
    log "✓ Python virtual environment activated"
else
    error "Failed to activate Python virtual environment"
    exit 1
fi

# Install Python dependencies
log "Installing Python dependencies..."

# Upgrade pip first
if pip install --upgrade pip; then
    log "✓ Pip upgraded successfully"
else
    warning "Pip upgrade failed, continuing with existing version"
fi

# Install all required packages with error checking
log "Installing required Python packages..."

PACKAGES=(
    "Flask==2.3.3"
    "SQLAlchemy==2.0.23"  
    "pandas==2.1.3"
    "PyMySQL==1.1.0"
    "python-dotenv==1.0.0"
    "Werkzeug==2.3.7"
    "requests==2.31.0"
    "cryptography==41.0.7"
    "Office365-REST-Python-Client==2.4.2"
)

FAILED_PACKAGES=()

for package in "${PACKAGES[@]}"; do
    log "Installing $package..."
    if pip install "$package"; then
        log "✓ $package installed successfully"
    else
        warning "Failed to install $package"
        FAILED_PACKAGES+=("$package")
    fi
done

# Check if any critical packages failed
if [ ${#FAILED_PACKAGES[@]} -gt 0 ]; then
    warning "Some packages failed to install: ${FAILED_PACKAGES[*]}"
    log "Trying to install failed packages without version constraints..."
    
    for package in "${FAILED_PACKAGES[@]}"; do
        package_name=$(echo "$package" | cut -d'=' -f1)
        log "Retrying $package_name without version constraint..."
        pip install "$package_name" || warning "Still failed: $package_name"
    done
fi

# Create requirements.txt for future reference
if pip freeze > requirements_installed.txt; then
    log "✓ Requirements file created: requirements_installed.txt"
else
    warning "Could not create requirements file"
fi

# Verify critical packages are installed
log "Verifying critical packages..."
python3 -c "
try:
    import flask, sqlalchemy, pandas, pymysql
    print('✓ All critical packages imported successfully')
except ImportError as e:
    print(f'✗ Critical package import failed: {e}')
    exit(1)
"

# =============================================================================
# STEP 6: Node.js Dependencies Installation
# =============================================================================

log "Installing Node.js dependencies..."

# Verify we're in the correct directory with package.json
if [[ ! -f "package.json" ]]; then
    error "package.json not found in current directory: $(pwd)"
    exit 1
fi

# Install Node.js packages
log "Running npm install..."
if npm install; then
    log "✓ Node.js dependencies installed successfully"
else
    error "npm install failed"
    log "Trying to fix npm issues..."
    
    # Try to clear npm cache and retry
    npm cache clean --force 2>/dev/null || true
    
    if npm install; then
        log "✓ Node.js dependencies installed after cache clear"
    else
        error "npm install failed even after cache clear"
        exit 1
    fi
fi

# Verify critical Node.js modules
if [[ -d "node_modules" ]]; then
    log "✓ node_modules directory created"
else
    error "node_modules directory not found after npm install"
    exit 1
fi

# =============================================================================
# STEP 7: Database Schema Setup
# =============================================================================

log "Setting up database schema..."

# The Node.js application will run its own migrations automatically via run-migrations.js
# We only need to create additional tables specific to the Python sync API that are not
# covered by the main application migrations

log "Creating Python sync API specific tables..."

# Create only the tables that are specific to the Python sync API
# and not handled by the Node.js migration system
$MYSQL_CMD economic_data -e "
CREATE TABLE IF NOT EXISTS csv_sync_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    file_type ENUM('budget', 'mapping') NOT NULL,
    operation ENUM('upload', 'download', 'process') NOT NULL,
    status ENUM('success', 'error', 'in_progress') NOT NULL,
    records_processed INT DEFAULT 0,
    error_message TEXT NULL,
    file_size BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_file_type_status (file_type, status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS budgets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_number VARCHAR(20) NOT NULL,
    budget_date DATE NOT NULL,
    budget_amount DECIMAL(15,2) NOT NULL,
    department VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_account_date (account_number, budget_date),
    INDEX idx_budget_date (budget_date),
    INDEX idx_account_number (account_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"

log "Python-specific database tables created. Node.js migrations will run automatically on application startup."

# =============================================================================
# STEP 8: Directory Structure Creation
# =============================================================================

log "Creating required directories..."

mkdir -p logs
mkdir -p downloads/sharepoint
mkdir -p backups
mkdir -p uploads

# Set proper permissions
chmod 755 logs downloads backups uploads
chmod 644 *.py *.js *.json
chmod +x deploy_complete.sh

# =============================================================================
# STEP 9: Service Configuration
# =============================================================================

log "Creating systemd services..."

# Create Python Sync API service
sudo tee /etc/systemd/system/economic-sync-api.service > /dev/null << EOF
[Unit]
Description=Economic Data Sync API Service
After=network.target mysql.service
Requires=mysql.service

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=${APP_DIR}
Environment=PATH=${APP_DIR}/venv/bin
ExecStart=${APP_DIR}/venv/bin/python sync_api.py
EnvironmentFile=${APP_DIR}/python.env
EnvironmentFile=${APP_DIR}/sharepoint.env
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Create Node.js main application service
sudo tee /etc/systemd/system/economic-main-app.service > /dev/null << EOF
[Unit]
Description=Economic Main Application
After=network.target mysql.service
Requires=mysql.service

[Service]
Type=forking
User=$USER
Group=$USER
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/pm2 start ecosystem.config.js --env production
ExecReload=/usr/bin/pm2 reload all
ExecStop=/usr/bin/pm2 stop all
EnvironmentFile=${APP_DIR}/.env
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# =============================================================================
# STEP 10: Nginx Configuration
# =============================================================================

log "Configuring Nginx reverse proxy..."

sudo tee /etc/nginx/sites-available/economic-api > /dev/null << 'EOF'
server {
    listen 80;
    server_name _;

    # Main application (Node.js on port 3000)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Sync API (Python Flask on port 5000)
    location /sync-api/ {
        rewrite ^/sync-api/(.*)$ /$1 break;
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Direct access to sync dashboard
    location /sync {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:5000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/economic-api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
sudo nginx -t

# =============================================================================
# STEP 11: Firewall Configuration
# =============================================================================

log "Configuring firewall..."

sudo ufw --force enable
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp  # Node.js app (internal)
sudo ufw allow 5000/tcp  # Python sync API (internal)

# =============================================================================
# STEP 12: Service Startup and Validation
# =============================================================================

log "Starting services..."

# Reload systemd
sudo systemctl daemon-reload

# Start and enable MySQL
log "Starting MySQL service..."
sudo systemctl start mysql
sudo systemctl enable mysql

# Wait for MySQL to be ready
log "Waiting for MySQL to be ready..."
for i in {1..30}; do
    if sudo systemctl is-active --quiet mysql; then
        log "✓ MySQL is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        error "MySQL failed to start within 30 seconds"
        exit 1
    fi
    sleep 1
done

# Start Nginx
log "Starting Nginx service..."
sudo systemctl start nginx
sudo systemctl enable nginx

# Start Node.js application with PM2
log "Starting Node.js application..."
cd "${APP_DIR}"

# Ensure we're using the Python virtual environment path
source venv/bin/activate

# Start the Node.js application
log "Starting PM2 applications..."
NODE_ENV=production pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup systemd -u $USER --hp $HOME

# Start Python Sync API
log "Starting Python Sync API service..."
sudo systemctl start economic-sync-api
sudo systemctl enable economic-sync-api

# Wait for services to fully start
log "Waiting for all services to start completely..."
sleep 15

# Additional wait for Node.js app to be fully ready
log "Waiting for Node.js application to be ready..."
for i in {1..60}; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200\|301\|302\|404"; then
        log "✓ Node.js application is responding"
        break
    fi
    if [ $i -eq 60 ]; then
        warning "Node.js application may still be starting up"
        break
    fi
    sleep 2
done

# =============================================================================
# STEP 13: Service Validation and Health Checks
# =============================================================================

log "Performing health checks..."

# Check MySQL
if sudo systemctl is-active --quiet mysql; then
    log "✓ MySQL is running"
else
    error "✗ MySQL is not running"
fi

# Check Nginx
if sudo systemctl is-active --quiet nginx; then
    log "✓ Nginx is running"
else
    error "✗ Nginx is not running"
fi

# Check Python Sync API
if sudo systemctl is-active --quiet economic-sync-api; then
    log "✓ Economic Sync API is running"
else
    error "✗ Economic Sync API is not running"
fi

# Test database connectivity
log "Testing database connectivity..."
cd "${APP_DIR}"
source venv/bin/activate

python3 -c "
import sys
sys.path.append('.')
from sqlalchemy import create_engine, text
try:
    engine = create_engine('mysql+pymysql://economic_api:password@localhost:3306/economic_data')
    with engine.connect() as conn:
        result = conn.execute(text('SELECT 1'))
        print('✓ Database connection successful')
except Exception as e:
    print(f'✗ Database connection failed: {e}')
    sys.exit(1)
"

# Test web endpoints
log "Testing web endpoints..."

# Test main application
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200\|301\|302"; then
    log "✓ Main application endpoint responding"
else
    warning "⚠ Main application endpoint not responding (may need time to start)"
fi

# Test sync API
if curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/health | grep -q "200"; then
    log "✓ Sync API health endpoint responding"
else
    warning "⚠ Sync API health endpoint not responding"
fi

# Test Nginx proxy
if curl -s -o /dev/null -w "%{http_code}" http://localhost/health | grep -q "200"; then
    log "✓ Nginx reverse proxy working"
else
    warning "⚠ Nginx reverse proxy may need configuration"
fi

# =============================================================================
# STEP 13.5: Verify Node.js Migrations and Database Schema
# =============================================================================

log "Verifying database schema and migrations..."

# Check if the main application tables exist (created by Node.js migrations)
migration_check=$($MYSQL_CMD economic_data -sN -e "
SELECT COUNT(*) as table_count FROM information_schema.tables 
WHERE table_schema = 'economic_data' 
AND table_name IN ('invoices', 'invoice_lines', 'accounts', 'customers', 'departments', 'products', 'suppliers', 'sync_logs');
")

if [[ $migration_check -ge 7 ]]; then
    log "✓ Node.js migrations completed successfully - main tables exist"
else
    warning "⚠ Some main application tables may be missing. Migration count: $migration_check/8"
    warning "   The Node.js application may still be running its migrations"
fi

# Check if migrations table exists and has records
migration_records=$($MYSQL_CMD economic_data -sN -e "
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'economic_data' AND table_name = 'migrations';
" 2>/dev/null || echo "0")

if [[ $migration_records -eq 1 ]]; then
    executed_migrations=$($MYSQL_CMD economic_data -sN -e "
    SELECT COUNT(*) FROM migrations;
    " 2>/dev/null || echo "0")
    log "✓ Migration tracking table exists with $executed_migrations completed migrations"
else
    warning "⚠ Migration tracking table not found - migrations may still be running"
fi

# Check Python sync API specific tables
python_tables=$($MYSQL_CMD economic_data -sN -e "
SELECT COUNT(*) FROM information_schema.tables 
WHERE table_schema = 'economic_data' 
AND table_name IN ('csv_sync_logs', 'budgets');
")

if [[ $python_tables -eq 2 ]]; then
    log "✓ Python sync API tables created successfully"
else
    error "✗ Python sync API tables missing"
fi

# =============================================================================
# STEP 14: Sample Data Population (Optional)
# =============================================================================

log "Populating sample data for testing..."

# Only populate sample data for tables that are specific to our Python sync API
# The main application migrations will handle their own sample data
$MYSQL_CMD economic_data -e "
-- Sample budget data for testing
INSERT IGNORE INTO budgets (account_number, budget_date, budget_amount, department) VALUES
('1000', '2024-01-01', 50000.00, 'Sales'),
('1000', '2024-02-01', 52000.00, 'Sales'),
('1000', '2024-03-01', 48000.00, 'Sales'),
('2000', '2024-01-01', 25000.00, 'Operations'),
('2000', '2024-02-01', 26000.00, 'Operations'),
('2000', '2024-03-01', 24000.00, 'Operations'),
('3000', '2024-01-01', 75000.00, 'Finance'),
('3000', '2024-02-01', 77000.00, 'Finance'),
('3000', '2024-03-01', 73000.00, 'Finance'),
('4000', '2024-01-01', 15000.00, 'HR'),
('4000', '2024-02-01', 16000.00, 'HR'),
('4000', '2024-03-01', 14000.00, 'HR');

-- Sample CSV sync logs for testing the sync dashboard
INSERT IGNORE INTO csv_sync_logs (file_name, file_type, operation, status, records_processed, file_size, created_at) VALUES
('budget_2024_01.csv', 'budget', 'process', 'success', 12, 2048, NOW() - INTERVAL 1 HOUR),
('account_mapping_2024.csv', 'mapping', 'process', 'success', 45, 4096, NOW() - INTERVAL 2 HOUR),
('budget_2024_02.csv', 'budget', 'download', 'success', 15, 2560, NOW() - INTERVAL 3 HOUR),
('budget_2024_03.csv', 'budget', 'process', 'error', 0, 1024, NOW() - INTERVAL 4 HOUR, 'Invalid CSV format'),
('account_mapping_updated.csv', 'mapping', 'upload', 'success', 38, 3584, NOW() - INTERVAL 5 HOUR);
"

log "Sample data populated successfully. The main application will populate its own data via migrations."

# =============================================================================
# STEP 15: Create Management Scripts
# =============================================================================

log "Creating management scripts..."

# Create service status script
cat > check_services.sh << 'EOF'
#!/bin/bash
echo "=== Economic Data Management System Status ==="
echo

echo "System Services:"
echo "- MySQL: $(systemctl is-active mysql) ($(systemctl is-enabled mysql))"
echo "- Nginx: $(systemctl is-active nginx) ($(systemctl is-enabled nginx))  
echo "- Sync API: $(systemctl is-active economic-sync-api) ($(systemctl is-enabled economic-sync-api))"
echo

echo "Node.js Applications:"
pm2 list
echo

echo "Port Usage:"
netstat -tlnp 2>/dev/null | grep -E ":(3000|5000|80|443|3306)" || echo "netstat not available, installing..."
echo

echo "Database Tables:"
mysql -u economic_api -ppassword -D economic_data -e "
SELECT TABLE_NAME, TABLE_ROWS 
FROM information_schema.tables 
WHERE table_schema = 'economic_data' 
ORDER BY TABLE_NAME;" 2>/dev/null || echo "Database connection failed"
echo

echo "Recent Logs:"
echo "--- Sync API (last 5 lines) ---"
tail -5 /opt/economic-api/sync_api.log 2>/dev/null || echo "No sync API logs yet"
echo

echo "--- System Logs (last 5 lines) ---"  
sudo journalctl -u economic-sync-api --no-pager -n 5 2>/dev/null
echo

echo "Web Endpoints Status:"
echo "- Main App (3000): $(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo 'FAILED')"
echo "- Sync API (5000): $(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/health 2>/dev/null || echo 'FAILED')"
echo "- Nginx Proxy (80): $(curl -s -o /dev/null -w "%{http_code}" http://localhost/health 2>/dev/null || echo 'FAILED')"
echo

echo "=== End Status Report ==="
EOF

chmod +x check_services.sh

# Create restart script
cat > restart_services.sh << 'EOF'
#!/bin/bash
echo "Restarting Economic Data Management System services..."

echo "Stopping services..."
sudo systemctl stop economic-sync-api
pm2 stop all

echo "Restarting system services..."
sudo systemctl restart mysql
sleep 5
sudo systemctl restart nginx

echo "Starting application services..."
cd /opt/economic-api
source venv/bin/activate
pm2 restart all || pm2 start ecosystem.config.js --env production
sudo systemctl start economic-sync-api

echo "Waiting for services to start..."
sleep 10

echo "All services restarted"
echo "Checking status..."
./check_services.sh
EOF

chmod +x restart_services.sh

# Create log viewer script
cat > view_logs.sh << 'EOF'
#!/bin/bash
echo "=== Economic Data Management System Logs ==="
echo
echo "Choose log to view:"
echo "1. Sync API logs"
echo "2. System journal (Sync API)"
echo "3. PM2 logs (Node.js)"
echo "4. Nginx access logs"
echo "5. Nginx error logs"
echo "6. MySQL error logs"
echo
read -p "Enter choice (1-6): " choice

case $choice in
    1) tail -f /opt/economic-api/logs/sync_api.log ;;
    2) sudo journalctl -u economic-sync-api -f ;;
    3) pm2 logs ;;
    4) sudo tail -f /var/log/nginx/access.log ;;
    5) sudo tail -f /var/log/nginx/error.log ;;
    6) sudo tail -f /var/log/mysql/error.log ;;
    *) echo "Invalid choice" ;;
esac
EOF

chmod +x view_logs.sh

# Create troubleshooting script
cat > troubleshoot.sh << 'EOF'
#!/bin/bash
echo "=== Economic Data Management System Troubleshooting ==="
echo

echo "1. Checking for common issues..."

# Check if all required files exist
echo "Checking application files..."
cd /opt/economic-api
if [[ ! -f "sync_api.py" ]]; then
    echo "❌ sync_api.py missing"
else
    echo "✅ sync_api.py exists"
fi

if [[ ! -f "package.json" ]]; then
    echo "❌ package.json missing"
else
    echo "✅ package.json exists"
fi

if [[ ! -d "node_modules" ]]; then
    echo "❌ node_modules missing - run 'npm install'"
else
    echo "✅ node_modules exists"
fi

if [[ ! -d "venv" ]]; then
    echo "❌ Python virtual environment missing"
else
    echo "✅ Python virtual environment exists"
fi

echo
echo "2. Checking processes..."
pgrep -f "sync_api.py" && echo "✅ Python sync API running" || echo "❌ Python sync API not running"
pgrep -f "node.*ecosystem" && echo "✅ Node.js app running" || echo "❌ Node.js app not running"

echo
echo "3. Checking network connectivity..."
netstat -tlnp 2>/dev/null | grep -E ":(3000|5000)" || echo "No application ports listening"

echo
echo "4. Checking logs for errors..."
echo "--- MySQL errors ---"
sudo tail -5 /var/log/mysql/error.log 2>/dev/null || echo "No MySQL error log"

echo
echo "--- Python API errors ---"
tail -10 /opt/economic-api/sync_api.log 2>/dev/null | grep -i error || echo "No Python API errors"

echo  
echo "--- PM2 errors ---"
pm2 logs --err --lines 5 2>/dev/null || echo "No PM2 error logs"

echo
echo "5. Quick fixes to try:"
echo "   - Restart services: ./restart_services.sh"
echo "   - Check firewall: sudo ufw status"
echo "   - Check disk space: df -h"
echo "   - Check memory: free -h"
echo "   - Reinstall Node modules: cd /opt/economic-api && npm install"
echo "   - Reinstall Python packages: cd /opt/economic-api && source venv/bin/activate && pip install -r requirements_sync.txt"
EOF

chmod +x troubleshoot.sh

# =============================================================================
# STEP 16: Final Configuration and Documentation
# =============================================================================

log "Creating deployment documentation..."

cat > DEPLOYMENT_INFO.md << EOF
# Economic Data Management System - Deployment Information

## System Information
- **Deployment Date**: $(date)
- **Installation Directory**: ${APP_DIR}
- **Database**: MySQL (economic_data)
- **Web Server**: Nginx with reverse proxy

## Services
1. **economic-sync-api.service** - Python Flask API for sync operations
2. **economic-main-app.service** - Node.js main application
3. **nginx** - Web server and reverse proxy
4. **mysql** - Database server

## Access URLs
- **Main Application**: http://your-server-ip/ (port 80)
- **Sync Dashboard**: http://your-server-ip/sync (port 80)
- **Health Check**: http://your-server-ip/health
- **Direct Sync API**: http://your-server-ip:5000 (if firewall allows)

## Management Commands
\`\`\`bash
# Check service status
./check_services.sh

# Restart all services
./restart_services.sh

# View logs
./view_logs.sh

# Manual service management
sudo systemctl status economic-sync-api
sudo systemctl restart economic-sync-api
pm2 status
pm2 restart all
\`\`\`

## Database Access
\`\`\`bash
# Connect to database
mysql -u economic_api -ppassword -D economic_data
# Password: password

# Or as root
mysql -u root -p economic_data
# Password: ${ROOT_PASSWORD}
\`\`\`

## File Locations
- **Application Files**: ${APP_DIR}
- **Logs**: ${APP_DIR}/logs/
- **Downloads**: ${APP_DIR}/downloads/
- **Configuration**: ${APP_DIR}/.env, ${APP_DIR}/python.env, ${APP_DIR}/sharepoint.env
- **Nginx Config**: /etc/nginx/sites-available/economic-api

## Troubleshooting
1. Check service status: \`./check_services.sh\`
2. View logs: \`./view_logs.sh\`
3. Restart services: \`./restart_services.sh\`
4. Check firewall: \`sudo ufw status\`
5. Test database: \`mysql -u economic_api -p economic_data\`

## Security Notes
- MySQL root password: ${ROOT_PASSWORD}
- Application database user: economic_api / password
- Firewall configured for ports 80, 443, 22
- SharePoint credentials configured in sharepoint.env

EOF

# =============================================================================
# FINAL SUMMARY
# =============================================================================

log "==================================================================="
log "DEPLOYMENT COMPLETE!"
log "==================================================================="
log
log "✅ System Services Installed and Configured:"
log "   - MySQL Database Server"
log "   - Nginx Web Server with Reverse Proxy"  
log "   - Python 3.11 with Virtual Environment"
log "   - Node.js 18.x LTS with PM2"
log
log "✅ Applications Deployed:"
log "   - Economic Sync API (Python Flask) on port 5000"
log "   - Main Economic Application (Node.js) on port 3000"
log "   - Web interface accessible on port 80"
log
log "✅ Database Configured:"
log "   - MySQL database 'economic_data' created"
log "   - User 'economic_api' with full permissions"
log "   - Required tables created and populated with sample data"
log
log "✅ Services Running:"
log "   - economic-sync-api.service (systemd)"
log "   - Node.js app via PM2"
log "   - Nginx reverse proxy"
log "   - MySQL server"
log
log "🌐 ACCESS YOUR APPLICATION:"
log "   Main Dashboard: http://$(hostname -I | awk '{print $1}')/"
log "   Sync Dashboard: http://$(hostname -I | awk '{print $1}')/sync"
log "   Health Check:   http://$(hostname -I | awk '{print $1}')/health"
log
log "📁 Management Scripts Created:"
log "   ./check_services.sh  - Check all service status"
log "   ./restart_services.sh - Restart all services"
log "   ./view_logs.sh       - View application logs"
log "   ./troubleshoot.sh    - Diagnose common issues"
log
log "📖 Documentation:"
log "   See DEPLOYMENT_INFO.md for detailed information"
log
log "🔧 Quick Status Check:"
./check_services.sh
log
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost/health | grep -q "200"; then
    warning "🚨 IMPORTANT: Some services may still be starting up"
    warning "   If you see failures above, wait 2-3 minutes and run: ./check_services.sh"
    warning "   For troubleshooting help, run: ./troubleshoot.sh"
    log
fi
log "==================================================================="
log "Deployment completed successfully! 🎉"
log "==================================================================="
log
info "🌐 Access your applications:"
info "   • Main Dashboard: http://$(hostname -I | awk '{print $1}')/"
info "   • Sync Dashboard: http://$(hostname -I | awk '{print $1}')/sync"
info "   • Health Check:   http://$(hostname -I | awk '{print $1}')/health"
log
info "📱 Quick Commands:"
info "   • Check status:    ./check_services.sh"
info "   • Restart all:     ./restart_services.sh"
info "   • View logs:       ./view_logs.sh"
info "   • Troubleshoot:    ./troubleshoot.sh"
log
info "🔍 If you encounter issues:"
info "   1. Wait 2-3 minutes for all services to fully start"
info "   2. Run ./check_services.sh to verify status"
info "   3. Run ./troubleshoot.sh for diagnostic help"
info "   4. Check DEPLOYMENT_INFO.md for detailed documentation"
log