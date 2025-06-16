# Security Setup Guide

⚠️ **IMPORTANT**: This application requires sensitive configuration data. Follow these steps to set up the environment securely.

## 🛡️ Initial Setup

### 1. Environment Configuration

Copy the template files and configure with your actual credentials:

```bash
# Copy environment templates
cp env.template .env
cp sharepoint.env.template sharepoint.env
cp python.env.template python.env
```

### 2. Configure Database Settings

Edit `.env` with your database credentials:
```bash
DB_HOST=localhost
DB_PORT=3306
DB_NAME=economic_data
DB_USER=your_actual_db_user
DB_PASSWORD=your_secure_password
DB_ROOT_USER=root
DB_ROOT_PASSWORD=your_root_password
APP_SECRET_TOKEN=generate_a_secure_random_token
```

### 3. Configure SharePoint Access

Edit `sharepoint.env` with your SharePoint credentials:
```bash
SHAREPOINT_USERNAME=your_actual_username@yourdomain.com
SHAREPOINT_PASSWORD=your_actual_password
SHAREPOINT_SITE_URL=https://yourcompany.sharepoint.com/sites/YourSite
```

### 4. Configure Python Environment

Edit `python.env` with your database connection:
```bash
DATABASE_URL=mysql+pymysql://your_actual_user:your_actual_password@localhost:3306/economic_data
```

## 🔐 Security Best Practices

### Generate Secure Tokens
```bash
# Generate a secure secret token (Linux/Mac)
openssl rand -base64 32

# Or use Python
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### File Permissions
Ensure environment files have restricted permissions:
```bash
chmod 600 .env
chmod 600 sharepoint.env
chmod 600 python.env
```

## 🚨 What NOT to commit to Git

The following files contain sensitive data and are excluded via `.gitignore`:
- `.env` - Database and application secrets
- `sharepoint.env` - SharePoint credentials
- `python.env` - Python environment variables
- `*.log` - Log files may contain sensitive information
- `uploads/` - Uploaded files
- `downloads/` - Downloaded files
- `backups/` - Backup files
- `venv/` - Virtual environment

## ✅ Safe to Commit

Template files are safe to commit:
- `env.template`
- `sharepoint.env.template`
- `python.env.template`
- This `SECURITY_SETUP.md` file

## 🔄 For Team Members

1. Clone the repository
2. Follow this setup guide
3. Never commit actual credentials
4. Use the template files as reference

## 📞 Support

If you need help with setup or have security concerns, contact the development team. 