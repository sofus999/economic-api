#!/usr/bin/env python3
"""
sync_api.py

Enhanced Flask API service for comprehensive sync monitoring and management.
This service provides:
- CSV file sync operations (budget/mapping files)
- Integration with main e-conomic API sync logs
- Unified monitoring dashboard for admin team
- Real-time status and error tracking

Usage:
    python sync_api.py
"""

from flask import Flask, request, jsonify, render_template_string, send_from_directory
import subprocess
import os
import logging
import traceback
import json
from datetime import datetime, timedelta
from sqlalchemy import create_engine, text
import pandas as pd
import sys
import requests
import time
from urllib.parse import urljoin
from dotenv import load_dotenv
import threading

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sharepoint.env'))
# Also load the main .env file for database credentials
load_dotenv()

# Import SharePoint client
try:
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from scripts.sharepoint_client import download_squaremeter_files, create_squaremeter_client
    SHAREPOINT_AVAILABLE = True
except ImportError as e:
    SHAREPOINT_AVAILABLE = False
    logging.warning(f"SharePoint client not available: {e}")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('sync_api.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Database connection - using environment variables for security
DB_ROOT_PASSWORD = os.getenv('DATABASE_ROOT_PASSWORD', os.getenv('DB_ROOT_PASSWORD', ''))
if not DB_ROOT_PASSWORD:
    raise ValueError("DATABASE_ROOT_PASSWORD must be set in environment variables")

ENGINE = create_engine(
    f"mysql+pymysql://root:{DB_ROOT_PASSWORD}@127.0.0.1/economic_data",
    pool_recycle=3600,
    pool_pre_ping=True,
)

# API Configuration for Health Checks
API_BASE_URL = os.getenv('API_BASE_URL', 'https://restapi.e-conomic.com')
APP_SECRET_TOKEN = os.getenv('APP_SECRET_TOKEN', '')
MAIN_API_URL = 'http://127.0.0.1:3000'

# Enhanced HTML template with SquareMeter professional design
ENHANCED_DASHBOARD_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>SquareMeter Economic Data Center</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 0;
            background: #fafbfc;
            color: #2c3e50;
            line-height: 1.6;
            font-weight: 400;
        }
        
        .header {
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            padding: 60px 0 40px 0;
            text-align: center;
            border-bottom: 1px solid #e9ecef;
            box-shadow: 0 4px 20px rgba(44,62,80,0.15);
            position: relative;
            overflow: hidden;
        }
        
        .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E") repeat;
            z-index: 1;
        }
        
        .header-content {
            position: relative;
            z-index: 2;
        }
        
        .logo-container {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
            gap: 20px;
        }
        
        .squaremeter-logo {
            background: #ffffff;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(255,255,255,0.2);
            font-family: 'Inter', sans-serif;
            font-weight: 700;
            font-size: 1.5rem;
            color: #2c3e50;
            letter-spacing: -0.025em;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .logo-icon {
            width: 32px;
            height: 32px;
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 900;
            font-size: 18px;
        }
        
        .header h1 {
            font-size: 2.5rem;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 12px;
            letter-spacing: -0.025em;
            text-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .header .subtitle {
            font-size: 1.1rem;
            color: rgba(255,255,255,0.9);
            font-weight: 400;
            max-width: 600px;
            margin: 0 auto;
            text-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 40px 24px;
        }
        
        .dashboard-grid {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 32px;
            margin-bottom: 40px;
        }
        
        .card {
            background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
            border-radius: 16px;
            padding: 32px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
            border: 1px solid rgba(255,255,255,0.8);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #3498db 0%, #2ecc71 25%, #f39c12 50%, #e74c3c 75%, #9b59b6 100%);
            z-index: 1;
        }
        
        .card:hover {
            box-shadow: 0 12px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.08);
            transform: translateY(-4px);
        }
        
        .card h2, .card h3 {
            color: #1a1a1a;
            margin-top: 0;
            font-weight: 600;
            margin-bottom: 24px;
            font-size: 1.125rem;
        }
        
        .card h2 {
            font-size: 1.25rem;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
            margin-bottom: 32px;
        }
        
        .stat-card {
            background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
            padding: 24px 20px;
            border-radius: 12px;
            text-align: center;
            border: 1px solid #e9ecef;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        .stat-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, #3498db, #2ecc71, #f39c12, #e74c3c);
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .stat-card:hover::before {
            opacity: 1;
        }
        
        .stat-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 24px rgba(0,0,0,0.1);
            background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%);
        }
        
        .stat-number {
            font-size: 24px;
            font-weight: 700;
            color: #1a1a1a;
            margin-bottom: 4px;
            letter-spacing: -0.025em;
        }
        
        .stat-label {
            color: #6c757d;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 500;
        }
        
        .sync-operations {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 12px;
            padding: 28px;
            margin-bottom: 24px;
            border: 1px solid rgba(52,152,219,0.1);
            position: relative;
        }
        
        .sync-operations::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, #3498db 0%, #2ecc71 100%);
            border-radius: 12px 12px 0 0;
        }
        
        .sync-operations h3 {
            margin-bottom: 20px;
            color: #1a1a1a;
            font-size: 1rem;
            font-weight: 600;
        }
        
        .button-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
            margin-bottom: 20px;
        }
        
        .button {
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            color: white;
            padding: 14px 24px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s ease;
            box-shadow: 0 4px 16px rgba(52,152,219,0.3);
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            letter-spacing: 0.025em;
            position: relative;
            overflow: hidden;
        }
        
        .button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
        }
        
        .button:hover::before {
            left: 100%;
        }
        
        .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 24px rgba(52,152,219,0.4);
            background: linear-gradient(135deg, #2980b9 0%, #3498db 100%);
        }
        
        .button:disabled {
            background: linear-gradient(135deg, #bdc3c7 0%, #95a5a6 100%);
            cursor: not-allowed;
            transform: none;
            box-shadow: 0 2px 8px rgba(189,195,199,0.3);
        }
        
        .button.secondary {
            background: linear-gradient(135deg, #95a5a6 0%, #7f8c8d 100%);
            box-shadow: 0 4px 16px rgba(149,165,166,0.3);
        }
        
        .button.secondary:hover {
            background: linear-gradient(135deg, #7f8c8d 0%, #95a5a6 100%);
            box-shadow: 0 6px 24px rgba(149,165,166,0.4);
        }
        
        .button.success {
            background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
            box-shadow: 0 4px 16px rgba(39,174,96,0.3);
        }
        
        .button.success:hover {
            background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%);
            box-shadow: 0 6px 24px rgba(39,174,96,0.4);
        }
        
        .status {
            margin-top: 20px;
            padding: 16px;
            border-radius: 6px;
            font-size: 14px;
            line-height: 1.4;
            border: 1px solid;
        }
        
        .status.success {
            background-color: rgba(40,167,69,0.1);
            color: #155724;
            border-color: rgba(40,167,69,0.2);
        }
        
        .status.error {
            background-color: rgba(220,53,69,0.1);
            color: #721c24;
            border-color: rgba(220,53,69,0.2);
        }
        
        .status.warning {
            background-color: rgba(255,193,7,0.1);
            color: #856404;
            border-color: rgba(255,193,7,0.2);
        }
        
        .status.info {
            background-color: rgba(13,110,253,0.1);
            color: #084298;
            border-color: rgba(13,110,253,0.2);
        }
        
        .quick-status {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
        }
        
        .quick-status h3 {
            margin-bottom: 16px;
            color: #1a1a1a;
            font-size: 1rem;
            font-weight: 600;
        }
        
        .status-item {
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid #e9ecef;
        }
        
        .status-item:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: none;
        }
        
        .status-label {
            font-weight: 500;
            color: #495057;
            font-size: 13px;
            margin-bottom: 4px;
        }
        
        .status-value {
            color: #6c757d;
            font-size: 12px;
        }
        
        .status-value.running {
            color: #28a745;
            font-weight: 500;
        }
        
        .tabs {
            display: flex;
            border-bottom: 1px solid #e9ecef;
            margin-bottom: 24px;
            gap: 0;
        }
        
        .tab {
            padding: 12px 20px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            color: #6c757d;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            transition: all 0.2s ease;
            letter-spacing: 0.025em;
        }
        
        .tab:hover {
            color: #495057;
            background: #f8f9fa;
        }
        
        .tab.active {
            color: #495057;
            border-bottom-color: #495057;
            background: #f8f9fa;
        }
        
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
        }
        
        .entity-filter {
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .entity-filter label {
            font-size: 14px;
            font-weight: 500;
            color: #495057;
        }
        
        .entity-filter select {
            padding: 8px 12px;
            border: 1px solid #ced4da;
            border-radius: 4px;
            font-size: 13px;
            color: #495057;
            background: white;
        }
        
        .sync-entry {
            background: white;
            padding: 16px;
            border-radius: 6px;
            margin-bottom: 12px;
            border: 1px solid #e9ecef;
            transition: all 0.2s ease;
        }
        
        .sync-entry:hover {
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }
        
        .sync-entry.success {
            border-left: 3px solid #28a745;
        }
        
        .sync-entry.error {
            border-left: 3px solid #dc3545;
        }
        
        .sync-entry.partial {
            border-left: 3px solid #ffc107;
        }
        
        .sync-meta {
            font-size: 12px;
            color: #6c757d;
            margin-top: 6px;
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #6c757d;
            font-size: 14px;
        }
        
        .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid #e9ecef;
            border-top: 2px solid #495057;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 12px auto;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .refresh-indicator {
            font-size: 12px;
            margin-left: 8px;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .refresh-indicator.show {
            opacity: 1;
        }
        
        .status-badge {
            font-size: 11px;
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: 600;
            letter-spacing: 0.5px;
        }
        
        .status-badge.success {
            background: rgba(40,167,69,0.1);
            color: #28a745;
            border: 1px solid rgba(40,167,69,0.2);
        }
        
        .status-badge.error {
            background: rgba(220,53,69,0.1);
            color: #dc3545;
            border: 1px solid rgba(220,53,69,0.2);
        }
        
        .status-badge.partial {
            background: rgba(255,193,7,0.1);
            color: #ffc107;
            border: 1px solid rgba(255,193,7,0.2);
        }
        
        .status-badge.running {
            background: rgba(13,110,253,0.1);
            color: #0d6efd;
            border: 1px solid rgba(13,110,253,0.2);
        }
        
        @media (max-width: 768px) {
            .dashboard-grid {
                grid-template-columns: 1fr;
                gap: 24px;
            }
            
            .button-grid {
                grid-template-columns: 1fr;
            }
            
            .stats-grid {
                grid-template-columns: repeat(2, 1fr);
            }
            
            .tabs {
                overflow-x: auto;
                -webkit-overflow-scrolling: touch;
            }
        }
        
        .status-healthy { background-color: #27ae60; }
        .status-warning { background-color: #f39c12; }
        .status-error { background-color: #e74c3c; }
        .status-unknown { background-color: #95a5a6; }
        .status-explanation {
            margin-top: 12px;
            padding: 12px 16px;
            background-color: rgba(52,73,94,0.1);
            border-left: 4px solid #34495e;
            border-radius: 4px;
            font-size: 14px;
            color: #2c3e50;
            line-height: 1.4;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .logs-container {
            background: #f8f9fa;
            border-radius: 8px;
            overflow: hidden;
        }
        
        .logs-header {
            background: #e9ecef;
            padding: 12px 16px;
            border-bottom: 1px solid #dee2e6;
        }
        
        .logs-header h4 {
            margin: 0 0 4px 0;
            font-size: 16px;
            color: #2c3e50;
        }
        
        .logs-content {
            max-height: 400px;
            overflow-y: auto;
            padding: 8px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            line-height: 1.4;
        }
        
        .log-line {
            padding: 2px 4px;
            margin: 1px 0;
            border-radius: 3px;
            word-wrap: break-word;
        }
        
        .log-line.error {
            background-color: rgba(220, 53, 69, 0.1);
            color: #721c24;
            border-left: 3px solid #dc3545;
        }
        
        .log-line.warning {
            background-color: rgba(255, 193, 7, 0.1);
            color: #856404;
            border-left: 3px solid #ffc107;
        }
        
        .log-line.info {
            background-color: rgba(0, 123, 255, 0.1);
            color: #004085;
            border-left: 3px solid #007bff;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div class="logo-container">
                <div class="squaremeter-logo">
                    <img src="/static/images/squaremeter-logo.svg" alt="SquareMeter" style="height: 40px;">
                </div>
            </div>
            <h1>Economic Data Center</h1>
            <p class="subtitle">Professional data synchronization and monitoring platform for E-conomic API integration</p>
        </div>
    </div>
    
    <div class="container">
        <div class="dashboard-grid">
            <div class="card">
                <h2>📊 System Metrics</h2>
                <div class="stats-grid" id="stats">
                    <div class="stat-card">
                        <div class="stat-number">-</div>
                        <div class="stat-label">Loading</div>
                    </div>
                </div>
                
                <div class="sync-operations">
                    <h3>Data Synchronization</h3>
                    <div class="button-grid">
                        <button class="button" onclick="triggerSharePointSync()" id="sharePointSyncBtn">
                            <span>☁️</span> SharePoint Sync
                        </button>
                        <button class="button" onclick="triggerEconomicFullSync()" id="economicFullSyncBtn">
                            <span>🔄</span> Full E-conomic Sync
                        </button>
                        <button class="button" onclick="triggerEconomicInvoiceSync()" id="economicInvoiceSyncBtn">
                            <span>📄</span> Invoice Sync
                        </button>
                        <button class="button secondary" onclick="testSharePointConnection()">
                            <span>🔗</span> Test Connection
                        </button>
                        <button class="button secondary" onclick="checkMainSyncStatus()">
                            <span>📈</span> System Status
                        </button>
                        <button class="button secondary" onclick="refreshDashboard()">
                            <span>🔄</span> Refresh
                        </button>
                    </div>
                    <div style="text-align: center;">
                        <a href="/health" class="button success" style="text-decoration: none;">
                            <span>🏥</span> Health Monitor
                        </a>
                    </div>
                </div>
                
                <div class="status" id="status" style="display: none;"></div>
            </div>
            
            <div class="card">
                <h3>🔄 System Status</h3>
                <div class="quick-status">
                    <div id="quickStatus">
                        <div class="loading">
                            <div class="spinner"></div>
                            Loading system status...
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="card">
            <div class="tabs">
                <div class="tab active" onclick="switchTab('sync-history')">📋 Sync History</div>
                <div class="tab" onclick="switchTab('system-logs')">📝 System Logs</div>
                <div class="tab" onclick="switchTab('error-logs')">⚠️ Error Analysis</div>
            </div>
            
            <div id="sync-history" class="tab-content active">
                <div class="entity-filter">
                    <label for="entityFilter">Filter by type:</label>
                    <select id="entityFilter" onchange="loadSyncHistory()">
                        <option value="all">All Operations</option>
                        <option value="sharepoint">SharePoint Import</option>
                        <option value="account_mapping">Account Mappings</option>
                        <option value="budget">Budget Data</option>
                        <option value="invoices">Invoices</option>
                        <option value="accounts">Accounts</option>
                        <option value="customers">Customers</option>
                        <option value="products">Products</option>
                        <option value="departments">Departments</option>
                    </select>
                    <span class="refresh-indicator" id="historyRefresh">🔄</span>
                </div>
                <div class="sync-history" id="syncHistoryContent">
                    <!-- Sync history will be loaded here -->
                </div>
            </div>
            
            <div id="system-logs" class="tab-content">
                <div class="sync-logs" id="systemLogs">
                    <!-- System logs will be loaded here -->
                </div>
            </div>
            
            <div id="error-logs" class="tab-content">
                <div class="sync-logs" id="errorLogs">
                    <!-- Error logs will be loaded here -->
                </div>
            </div>
        </div>
    </div>

    <script>
        async function loadEnhancedStats() {
            try {
                const response = await fetch('/enhanced-stats');
                const stats = await response.json();
                
                console.log('Stats received:', stats); // Debug log
                
                const statsDiv = document.getElementById('stats');
                const formatNumber = (num) => {
                    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
                    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
                    return num.toString();
                };
                
                statsDiv.innerHTML = `
                    <div class="stat-card">
                        <div class="stat-number">${stats.agreements || 0}</div>
                        <div class="stat-label">Active Agreements</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${formatNumber(stats.sync_operations_today || 0)}</div>
                        <div class="stat-label">Sync Operations</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${formatNumber(stats.total_invoices || 0)}</div>
                        <div class="stat-label">Total Invoices</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${stats.account_mappings || 0}</div>
                        <div class="stat-label">Account Mappings</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${stats.budget_records || 0}</div>
                        <div class="stat-label">Budget Records</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${stats.failed_operations || 0}</div>
                        <div class="stat-label">Failed Operations</div>
                    </div>
                `;
            } catch (error) {
                console.error('Error loading stats:', error);
                document.getElementById('stats').innerHTML = `
                    <div class="stat-card">
                        <div class="stat-number">⚠️</div>
                        <div class="stat-label">Error Loading</div>
                    </div>
                `;
            }
        }

        async function loadQuickStatus() {
            try {
                console.log('Loading quick status...'); // Debug log
                const response = await fetch('/quick-status');
                const result = await response.json();
                
                console.log('Quick status received:', result); // Debug log
                
                const statusDiv = document.getElementById('quickStatus');
                if (!statusDiv) {
                    console.error('quickStatus element not found!');
                    return;
                }
                
                const lastSharePointSync = result.lastSharePointSync ? new Date(result.lastSharePointSync).toLocaleString() : 'Never';
                const lastMainSync = result.lastMainSync ? new Date(result.lastMainSync).toLocaleString() : 'Never';
                
                let syncStatusHtml = '';
                if (result.isSyncRunning && result.runningSyncDetails) {
                    const runningSince = new Date(result.runningSyncDetails.started_at).toLocaleTimeString();
                    const entityDisplay = result.runningSyncDetails.entity.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    
                    syncStatusHtml = `
                        <div class="status-item">
                            <div class="status-label">Current Operation</div>
                            <div class="status-value running">
                                ⏳ ${entityDisplay} - Running since ${runningSince}
                            </div>
                        </div>
                    `;
                } else {
                    syncStatusHtml = `
                        <div class="status-item">
                            <div class="status-label">System Status</div>
                            <div class="status-value">✅ Ready for operations</div>
                        </div>
                    `;
                }
                
                statusDiv.innerHTML = `
                    ${syncStatusHtml}
                    <div class="status-item">
                        <div class="status-label">Database Connection</div>
                        <div class="status-value">
                            ${result.dbStatus === 'Connected' ? '🟢' : '🔴'} ${result.dbStatus}
                        </div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">Last E-conomic Sync</div>
                        <div class="status-value">${lastMainSync}</div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">Last SharePoint Import</div>
                        <div class="status-value">${lastSharePointSync}</div>
                    </div>
                    <div class="status-item">
                        <div class="status-label">Recent Error Count</div>
                        <div class="status-value">
                            ${result.recentErrors > 0 ? '⚠️' : '✅'} ${result.recentErrors} errors
                        </div>
                    </div>
                `;
                
                // Update sync buttons state
                const economicFullSyncBtn = document.getElementById('economicFullSyncBtn');
                const economicInvoiceSyncBtn = document.getElementById('economicInvoiceSyncBtn');
                const sharePointSyncBtn = document.getElementById('sharePointSyncBtn');
                
                if (result.isSyncRunning) {
                    if (economicFullSyncBtn) {
                        economicFullSyncBtn.disabled = true;
                        economicFullSyncBtn.innerHTML = '⏳ Sync Running...';
                    }
                    if (economicInvoiceSyncBtn) {
                        economicInvoiceSyncBtn.disabled = true;
                        economicInvoiceSyncBtn.innerHTML = '⏳ Sync Running...';
                    }
                    if (sharePointSyncBtn) {
                        sharePointSyncBtn.disabled = true;
                        sharePointSyncBtn.innerHTML = '⏳ Sync Running...';
                    }
                } else {
                    if (economicFullSyncBtn) {
                        economicFullSyncBtn.disabled = false;
                        economicFullSyncBtn.innerHTML = '<span>🔄</span> Full E-conomic Sync';
                    }
                    if (economicInvoiceSyncBtn) {
                        economicInvoiceSyncBtn.disabled = false;
                        economicInvoiceSyncBtn.innerHTML = '<span>📄</span> Invoice Sync';
                    }
                    if (sharePointSyncBtn) {
                        sharePointSyncBtn.disabled = false;
                        sharePointSyncBtn.innerHTML = '<span>☁️</span> SharePoint Sync';
                    }
                }
                
            } catch (error) {
                console.error('Error loading quick status:', error);
                const statusDiv = document.getElementById('quickStatus');
                if (statusDiv) {
                    statusDiv.innerHTML = `
                        <div class="status-item">
                            <div class="status-label">Error</div>
                            <div class="status-value">❌ Failed to load status</div>
                        </div>
                    `;
                }
            }
        }

        async function triggerSharePointSync() {
            const btn = document.getElementById('sharePointSyncBtn');
            if (btn && btn.disabled) return;
            
            const originalText = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '⏳ Starting SharePoint sync...';
            }
            
            showStatus('info', 'Starting SharePoint sync operation...');
            
            try {
                const response = await fetch('/sync-sharepoint', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showStatus('success', `✅ SharePoint sync completed successfully! ${result.message || ''}`);
                    setTimeout(() => {
                        loadQuickStatus();
                        loadEnhancedStats();
                        loadSyncHistory();
                    }, 1000);
                } else {
                    showStatus('error', `❌ SharePoint sync failed: ${result.message || 'Unknown error'}`);
                }
            } catch (error) {
                console.error('Error triggering SharePoint sync:', error);
                showStatus('error', `❌ SharePoint sync failed: ${error.message}`);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            }
        }
        
        async function triggerEconomicFullSync() {
            const btn = document.getElementById('economicFullSyncBtn');
            if (btn && btn.disabled) return;
            
            const originalText = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '⏳ Starting full sync...';
            }
            
            showStatus('info', 'Starting full E-conomic sync operation...');
            
            try {
                const response = await fetch('/sync-economic-full', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showStatus('success', `✅ Full E-conomic sync started successfully! ${result.message || ''}`);
                    setTimeout(() => {
                        loadQuickStatus();
                        loadEnhancedStats();
                        loadSyncHistory();
                    }, 1000);
                } else {
                    showStatus('error', `❌ Full sync failed: ${result.message || 'Unknown error'}`);
                }
            } catch (error) {
                console.error('Error triggering full sync:', error);
                showStatus('error', `❌ Full sync failed: ${error.message}`);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            }
        }
        
        async function triggerEconomicInvoiceSync() {
            const btn = document.getElementById('economicInvoiceSyncBtn');
            if (btn && btn.disabled) return;
            
            const originalText = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '⏳ Starting invoice sync...';
            }
            
            showStatus('info', 'Starting E-conomic invoice sync operation...');
            
            try {
                const response = await fetch('/sync-economic-invoices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const result = await response.json();
                
                if (response.ok) {
                    showStatus('success', `✅ Invoice sync started successfully! ${result.message || ''}`);
                    setTimeout(() => {
                        loadQuickStatus();
                        loadEnhancedStats();
                        loadSyncHistory();
                    }, 1000);
                } else {
                    showStatus('error', `❌ Invoice sync failed: ${result.message || 'Unknown error'}`);
                }
            } catch (error) {
                console.error('Error triggering invoice sync:', error);
                showStatus('error', `❌ Invoice sync failed: ${error.message}`);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            }
        }
        
        function showStatus(type, message) {
            let statusArea = document.getElementById('statusMessages');
            if (!statusArea) {
                statusArea = document.createElement('div');
                statusArea.id = 'statusMessages';
                statusArea.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 1000;
                    max-width: 400px;
                `;
                document.body.appendChild(statusArea);
            }
            
            const statusMessage = document.createElement('div');
            statusMessage.style.cssText = `
                padding: 12px 16px;
                margin-bottom: 8px;
                border-radius: 6px;
                color: white;
                font-weight: 500;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                animation: slideIn 0.3s ease-out;
                cursor: pointer;
            `;
            
            switch (type) {
                case 'success':
                    statusMessage.style.backgroundColor = '#10b981';
                    break;
                case 'error':
                    statusMessage.style.backgroundColor = '#ef4444';
                    break;
                case 'info':
                    statusMessage.style.backgroundColor = '#3b82f6';
                    break;
                default:
                    statusMessage.style.backgroundColor = '#6b7280';
            }
            
            statusMessage.textContent = message;
            statusMessage.onclick = () => statusMessage.remove();
            
            statusArea.appendChild(statusMessage);
            
            setTimeout(() => {
                if (statusMessage.parentNode) {
                    statusMessage.remove();
                }
            }, 5000);
        }
        
        async function loadSyncHistory() {
            try {
                // Get filter value from dropdown
                const entityFilter = document.getElementById('entityFilter');
                const filterValue = entityFilter ? entityFilter.value : 'all';
                
                const response = await fetch(`/sync-history?filter=${filterValue}`);
                const history = await response.json();
                
                const historyDiv = document.getElementById('syncHistoryContent');
                if (!historyDiv) {
                    console.error('syncHistoryContent element not found!');
                    return;
                }
                
                if (!history.history || history.history.length === 0) {
                    historyDiv.innerHTML = '<div class="status-item"><div class="status-label">Recent Activity</div><div class="status-value">No recent sync operations found for this filter</div></div>';
                    return;
                }
                
                let historyHtml = '';
                history.history.forEach(sync => {
                    const startTime = new Date(sync.started_at).toLocaleString();
                    const duration = sync.duration_ms ? `${Math.round(sync.duration_ms / 1000)}s` : 'N/A';
                    const statusIcon = sync.status === 'success' ? '✅' : sync.status === 'error' ? '❌' : '⏳';
                    
                    historyHtml += `
                        <div class="sync-operation">
                            <div class="operation-header">
                                <span class="operation-status">${statusIcon}</span>
                                <span class="operation-name">${sync.entity_display}</span>
                                <span class="operation-time">${startTime}</span>
                            </div>
                            <div class="operation-details">
                                Duration: ${duration} | Records: ${sync.record_count || 0}
                                ${sync.error_message ? `<br><span class="error-msg">Error: ${sync.error_message}</span>` : ''}
                            </div>
                        </div>
                    `;
                });
                
                historyDiv.innerHTML = historyHtml;
                
            } catch (error) {
                console.error('Error loading sync history:', error);
                const historyDiv = document.getElementById('syncHistoryContent');
                if (historyDiv) {
                    historyDiv.innerHTML = '<div class="status-item"><div class="status-label">Error</div><div class="status-value">❌ Failed to load history</div></div>';
                }
            }
        }
        
        function switchTab(tabName) {
            const allTabs = document.querySelectorAll('.tab-content');
            allTabs.forEach(tab => tab.classList.remove('active'));
            
            const allTabButtons = document.querySelectorAll('.tab');
            allTabButtons.forEach(tab => tab.classList.remove('active'));
            
            const selectedTab = document.getElementById(tabName);
            if (selectedTab) {
                selectedTab.classList.add('active');
            }
            
            const clickedTab = [...allTabButtons].find(tab => tab.textContent.includes(tabName.replace('-', ' ')));
            if (clickedTab) {
                clickedTab.classList.add('active');
            }
            
            if (tabName === 'sync-history') {
                loadSyncHistory();
            } else if (tabName === 'system-logs') {
                loadSystemLogs();
            } else if (tabName === 'error-logs') {
                loadErrorLogs();
            }
        }
        
        function testSharePointConnection() {
            showStatus('info', 'Testing SharePoint connection...');
            fetch('/test-sharepoint')
                .then(response => response.json())
                .then(data => {
                    if (data.status === 'success') {
                        showStatus('success', '✅ SharePoint connection successful!');
                    } else {
                        showStatus('error', `❌ SharePoint connection failed: ${data.message}`);
                    }
                })
                .catch(error => {
                    showStatus('error', `❌ Connection test failed: ${error.message}`);
                });
        }
        
        function checkMainSyncStatus() {
            showStatus('info', 'Checking main sync status...');
            fetch('/main-sync-status')
                .then(response => response.json())
                .then(data => {
                    showStatus('info', `📊 Sync Status: ${data.message || 'Status checked'}`);
                })
                .catch(error => {
                    showStatus('error', `❌ Failed to check status: ${error.message}`);
                });
        }
        
        function refreshDashboard() {
            showStatus('info', '🔄 Refreshing dashboard...');
            loadEnhancedStats();
            loadQuickStatus();
            loadSyncHistory();
            showStatus('success', '✅ Dashboard refreshed!');
        }
        
        async function loadSystemLogs() {
            const logsDiv = document.getElementById('systemLogs');
            if (!logsDiv) {
                console.error('systemLogs element not found!');
                return;
            }
            
            logsDiv.innerHTML = '<div class="loading">Loading system logs...</div>';
            
            try {
                const response = await fetch('/system-logs');
                const data = await response.json();
                
                if (data.logs) {
                    // Format logs for display
                    const formattedLogs = data.logs
                        .split('\\n')
                        .filter(line => line.trim()) // Remove empty lines
                        .slice(-50) // Show last 50 lines
                        .map(line => {
                            // Escape HTML to prevent issues
                            const escapedLine = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
                            // Color code log levels
                            if (line.includes('ERROR')) {
                                return '<div class="log-line error">' + escapedLine + '</div>';
                            } else if (line.includes('WARN')) {
                                return '<div class="log-line warning">' + escapedLine + '</div>';
                            } else if (line.includes('INFO')) {
                                return '<div class="log-line info">' + escapedLine + '</div>';
                            } else {
                                return '<div class="log-line">' + escapedLine + '</div>';
                            }
                        })
                        .join('');
                    
                    logsDiv.innerHTML = 
                        '<div class="logs-container">' +
                            '<div class="logs-header">' +
                                '<h4>Recent System Logs (Last 50 lines)</h4>' +
                                '<small>Last updated: ' + new Date(data.timestamp).toLocaleString() + '</small>' +
                            '</div>' +
                            '<div class="logs-content">' +
                                formattedLogs +
                            '</div>' +
                        '</div>';
                } else {
                    logsDiv.innerHTML = '<div class="status-item"><div class="status-label">System Logs</div><div class="status-value">No logs available</div></div>';
                }
            } catch (error) {
                console.error('Error loading system logs:', error);
                logsDiv.innerHTML = '<div class="status-item"><div class="status-label">Error</div><div class="status-value">❌ Failed to load system logs</div></div>';
            }
        }
        
        async function loadErrorLogs() {
            const logsDiv = document.getElementById('errorLogs');
            if (!logsDiv) {
                console.error('errorLogs element not found!');
                return;
            }
            
            logsDiv.innerHTML = '<div class="loading">Loading error logs...</div>';
            
            try {
                const response = await fetch('/error-logs');
                const data = await response.json();
                
                if (data.logs && data.logs !== "No error logs for today ✅") {
                    // Format error logs for display
                    const formattedLogs = data.logs
                        .split('\\n')
                        .filter(line => line.trim()) // Remove empty lines
                        .slice(-100) // Show last 100 lines for errors
                        .map(line => '<div class="log-line error">' + line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') + '</div>')
                        .join('');
                    
                    logsDiv.innerHTML = 
                        '<div class="logs-container">' +
                            '<div class="logs-header">' +
                                '<h4>Recent Error Logs (Last 100 lines)</h4>' +
                                '<small>Last updated: ' + new Date(data.timestamp).toLocaleString() + '</small>' +
                            '</div>' +
                            '<div class="logs-content">' +
                                formattedLogs +
                            '</div>' +
                        '</div>';
                } else {
                    logsDiv.innerHTML = 
                        '<div class="status-item">' +
                            '<div class="status-label">Error Analysis</div>' +
                            '<div class="status-value">✅ No error logs for today</div>' +
                        '</div>';
                }
            } catch (error) {
                console.error('Error loading error logs:', error);
                logsDiv.innerHTML = '<div class="status-item"><div class="status-label">Error</div><div class="status-value">❌ Failed to load error logs</div></div>';
            }
        }
        
        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', function() {
            console.log('Dashboard initializing...');
            loadEnhancedStats();
            loadQuickStatus();
            loadSyncHistory();
            
            setInterval(() => {
                loadEnhancedStats();
                loadQuickStatus();
            }, 30000);
            
            console.log('Dashboard initialized');
        });
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            
            .status-item {
                display: flex;
                justify-content: space-between;
                padding: 12px 0;
                border-bottom: 1px solid #f0f0f0;
            }
            
            .status-item:last-child {
                border-bottom: none;
            }
            
            .status-label {
                font-weight: 600;
                color: #2c3e50;
            }
            
            .status-value {
                color: #34495e;
                font-weight: 500;
            }
            
            .sync-operation {
                background: #f8f9fa;
                border: 1px solid #e9ecef;
                border-radius: 8px;
                padding: 16px;
                margin-bottom: 12px;
            }
            
            .operation-header {
                display: flex;
                align-items: center;
                gap: 12px;
                font-weight: 600;
                margin-bottom: 8px;
            }
            
            .operation-details {
                font-size: 0.9em;
                color: #6c757d;
            }
            
            .error-msg {
                color: #dc3545;
                font-weight: 500;
            }
            
            .loading {
                text-align: center;
                padding: 40px;
                color: #6c757d;
            }
            
            .spinner {
                border: 2px solid #f3f3f3;
                border-top: 2px solid #3498db;
                border-radius: 50%;
                width: 20px;
                height: 20px;
                animation: spin 1s linear infinite;
                margin: 0 auto 16px;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            .logs-container {
                background: #f8f9fa;
                border: 1px solid #e9ecef;
                border-radius: 8px;
                overflow: hidden;
            }
            
            .logs-header {
                background: #fff;
                padding: 16px;
                border-bottom: 1px solid #e9ecef;
            }
            
            .logs-header h4 {
                margin: 0 0 8px 0;
                color: #2c3e50;
                font-weight: 600;
            }
            
            .logs-header small {
                color: #6c757d;
                font-size: 0.85em;
            }
            
            .logs-content {
                max-height: 400px;
                overflow-y: auto;
                padding: 16px;
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                font-size: 0.85em;
                line-height: 1.4;
            }
            
            .log-line {
                margin-bottom: 4px;
                padding: 4px 8px;
                border-radius: 4px;
                word-wrap: break-word;
            }
            
            .log-line.error {
                background-color: rgba(220, 53, 69, 0.1);
                color: #dc3545;
                border-left: 3px solid #dc3545;
            }
            
            .log-line.warning {
                background-color: rgba(255, 193, 7, 0.1);
                color: #856404;
                border-left: 3px solid #ffc107;
            }
            
            .log-line.info {
                background-color: rgba(13, 202, 240, 0.1);
                color: #0c5460;
                border-left: 3px solid #0dcaf0;
            }
        `;
        document.head.appendChild(style);
    </script>
</body>
</html>
"""

# Health Check HTML Template
HEALTH_DASHBOARD_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>SquareMeter System Health Monitor</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 0;
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            min-height: 100vh;
            padding: 20px;
            color: #2c3e50;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            color: #2c3e50;
        }
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 15px;
            font-weight: 700;
            letter-spacing: -0.02em;
        }
        .refresh-info {
            color: #6c757d;
            font-size: 14px;
            font-weight: 500;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 24px;
            margin-bottom: 30px;
        }
        .card {
            background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
            border-radius: 16px;
            padding: 32px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
            border: 1px solid rgba(255,255,255,0.8);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #3498db 0%, #2ecc71 25%, #f39c12 50%, #e74c3c 75%, #9b59b6 100%);
            z-index: 1;
        }
        
        .card:hover {
            box-shadow: 0 12px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.08);
            transform: translateY(-4px);
        }
        
        .card h3 {
            margin-top: 0;
            color: #2c3e50;
            border-bottom: 2px solid #f1f3f4;
            padding-bottom: 12px;
            font-weight: 600;
            font-size: 1.25rem;
        }
        .status-indicator {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 10px;
        }
        .status-healthy { background-color: #27ae60; }
        .status-warning { background-color: #f39c12; }
        .status-error { background-color: #e74c3c; }
        .status-unknown { background-color: #95a5a6; }
        .status-explanation {
            margin-top: 12px;
            padding: 12px 16px;
            background-color: rgba(52,73,94,0.1);
            border-left: 4px solid #34495e;
            border-radius: 4px;
            font-size: 14px;
            color: #2c3e50;
            line-height: 1.4;
        }
        .test-result {
            margin: 12px 0;
            padding: 16px;
            border-radius: 8px;
            border: 1px solid;
            font-weight: 500;
        }
        .test-result.pass {
            background-color: rgba(39,174,96,0.1);
            color: #27ae60;
            border-color: rgba(39,174,96,0.2);
        }
        .test-result.fail {
            background-color: rgba(231,76,60,0.1);
            color: #e74c3c;
            border-color: rgba(231,76,60,0.2);
        }
        .test-result.warning {
            background-color: rgba(241,196,15,0.1);
            color: #f39c12;
            border-color: rgba(241,196,15,0.2);
        }
        .alert {
            padding: 18px;
            margin: 12px 0;
            border-radius: 12px;
            border: 1px solid;
            font-weight: 500;
        }
        .alert.critical {
            background-color: rgba(231,76,60,0.1);
            color: #e74c3c;
            border-color: rgba(231,76,60,0.2);
        }
        .alert.warning {
            background-color: rgba(241,196,15,0.1);
            color: #f39c12;
            border-color: rgba(241,196,15,0.2);
        }
        .alert.info {
            background-color: rgba(52,152,219,0.1);
            color: #3498db;
            border-color: rgba(52,152,219,0.2);
        }
        .button {
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            color: white;
            padding: 14px 24px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s ease;
            box-shadow: 0 4px 16px rgba(52,152,219,0.3);
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            letter-spacing: 0.025em;
            position: relative;
            overflow: hidden;
        }
        
        .button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
        }
        
        .button:hover::before {
            left: 100%;
        }
        
        .button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 24px rgba(52,152,219,0.4);
            background: linear-gradient(135deg, #2980b9 0%, #3498db 100%);
        }
        
        .button:disabled {
            background: linear-gradient(135deg, #bdc3c7 0%, #95a5a6 100%);
            cursor: not-allowed;
            transform: none;
            box-shadow: 0 2px 8px rgba(189,195,199,0.3);
        }
        
        .button.secondary {
            background: linear-gradient(135deg, #95a5a6 0%, #7f8c8d 100%);
            box-shadow: 0 4px 16px rgba(149,165,166,0.3);
        }
        
        .button.secondary:hover {
            background: linear-gradient(135deg, #7f8c8d 0%, #95a5a6 100%);
            box-shadow: 0 6px 24px rgba(149,165,166,0.4);
        }
        
        .button.success {
            background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
            box-shadow: 0 4px 16px rgba(39,174,96,0.3);
        }
        
        .button.success:hover {
            background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%);
            box-shadow: 0 6px 24px rgba(39,174,96,0.4);
        }
        
        .timestamp {
            font-size: 0.9em;
            color: #7f8c8d;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid #ecf0f1;
        }
        
        .metric {
            display: flex;
            justify-content: space-between;
            margin: 12px 0;
            padding: 8px 0;
            border-bottom: 1px solid #ecf0f1;
        }
        
        .metric:last-child {
            border-bottom: none;
        }
        
        .metric-label {
            font-weight: 500;
            color: #5d6d7e;
        }
        
        .metric-value {
            font-weight: 600;
            color: #2c3e50;
        }
        
        .loading {
            text-align: center;
            padding: 20px;
            color: #7f8c8d;
            font-style: italic;
        }
        
        .actions {
            text-align: center;
            margin: 30px 0;
        }
        
        .actions .button {
            margin: 0 8px;
        }
        
        .token-section {
            margin-top: 40px;
            background: rgba(255,255,255,0.8);
            border-radius: 12px;
            padding: 24px;
            border: 1px solid #e1e8ed;
        }
        
        .token-section h3 {
            margin-top: 0;
            color: #2c3e50;
            border-bottom: 2px solid #f1f3f4;
            padding-bottom: 12px;
        }
        
        .token-input {
            width: 100%;
            max-width: 400px;
            padding: 12px;
            margin: 12px 8px;
            border: 2px solid #ddd;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.3s ease;
        }
        
        .token-input:focus {
            outline: none;
            border-color: #3498db;
            box-shadow: 0 0 0 3px rgba(52,152,219,0.1);
        }
        
        /* Logo styling */
        .header img {
            height: 48px;
            margin-bottom: 16px;
        }
    </style>
    <script>
        let healthData = {};
        
        async function loadHealthData() {
            try {
                const response = await fetch('/health-api');
                healthData = await response.json();
                updateHealthDisplay();
            } catch (error) {
                console.error('Error loading health data:', error);
                document.getElementById('health-content').innerHTML = 
                    '<div class="alert critical">Error loading health data: ' + error.message + '</div>';
            }
        }
        
        function updateHealthDisplay() {
            const content = document.getElementById('health-content');
            if (!healthData.checks) {
                content.innerHTML = '<div class="loading">Loading health data...</div>';
                return;
            }
            
            let html = '';
            
            // System Health Overview
            html += '<div class="card"><h3>🏥 System Health Overview</h3>';
            const overallStatus = healthData.overall_status;
            const statusClass = overallStatus === 'healthy' ? 'status-healthy' : 
                               overallStatus === 'warning' ? 'status-warning' : 'status-error';
            html += `<div><span class="status-indicator ${statusClass}"></span><strong>Overall Status: ${overallStatus.toUpperCase()}</strong></div>`;
            if (healthData.status_explanation) {
                html += `<div class="status-explanation">${healthData.status_explanation}</div>`;
            }
            html += `<div class="timestamp">Last Updated: ${new Date(healthData.timestamp).toLocaleString()}</div></div>`;
            
            // Health Checks
            html += '<div class="card"><h3>🔍 Health Checks</h3>';
            for (const [check, result] of Object.entries(healthData.checks)) {
                const resultClass = result.status === 'pass' ? 'pass' : result.status === 'warning' ? 'warning' : 'fail';
                html += `<div class="test-result ${resultClass}">
                    <strong>${check}:</strong> ${result.message}
                    ${result.details ? '<br><small>' + result.details + '</small>' : ''}
                </div>`;
            }
            html += '</div>';
            
            // Critical Alerts
            if (healthData.alerts && healthData.alerts.length > 0) {
                html += '<div class="card"><h3>🚨 Critical Alerts</h3>';
                healthData.alerts.forEach(alert => {
                    html += `<div class="alert ${alert.severity}">
                        <strong>${alert.title}</strong><br>
                        ${alert.message}
                    </div>`;
                });
                html += '</div>';
            }
            
            // Database Metrics
            if (healthData.database_metrics) {
                html += '<div class="card"><h3>💾 Database Metrics</h3>';
                for (const [metric, value] of Object.entries(healthData.database_metrics)) {
                    html += `<div class="metric">
                        <span class="metric-label">${metric.replace(/_/g, ' ').toUpperCase()}</span>
                        <span class="metric-value">${value}</span>
                    </div>`;
                }
                html += '</div>';
            }
            
            // API Test Results
            if (healthData.api_tests) {
                html += '<div class="card"><h3>🌐 API Tests</h3>';
                for (const [test, result] of Object.entries(healthData.api_tests)) {
                    const resultClass = result.status === 'pass' ? 'pass' : 'fail';
                    html += `<div class="test-result ${resultClass}">
                        <strong>${test}:</strong> ${result.message}
                        ${result.response_time ? '<br><small>Response time: ' + result.response_time + 'ms</small>' : ''}
                    </div>`;
                }
                html += '</div>';
            }
            
            content.innerHTML = html;
        }
        
        async function addToken() {
            const token = document.getElementById('new-token').value.trim();
            if (!token) {
                alert('Please enter a token');
                return;
            }
            
            try {
                const response = await fetch('/add-token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ token: token })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('Token added successfully!');
                    document.getElementById('new-token').value = '';
                    loadHealthData(); // Refresh health data
                } else {
                    alert('Error adding token: ' + result.error);
                }
            } catch (error) {
                alert('Error adding token: ' + error.message);
            }
        }
        
        function refreshData() {
            loadHealthData();
        }
        
        // Auto-refresh every 30 seconds
        setInterval(loadHealthData, 30000);
        
        // Load initial data when page loads
        document.addEventListener('DOMContentLoaded', loadHealthData);
    </script>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="/static/images/squaremeter-logo.svg" alt="SquareMeter Logo" />
            <h1>System Health Monitor</h1>
            <div class="refresh-info">
                Auto-refreshes every 30 seconds | 
                <a href="/" class="button secondary" style="text-decoration: none; padding: 8px 16px; font-size: 12px;">← Back to Dashboard</a>
                <button onclick="refreshData()" class="button" style="padding: 8px 16px; font-size: 12px;">🔄 Refresh Now</button>
            </div>
        </div>
        
        <div id="health-content" class="grid">
            <div class="loading">Loading health data...</div>
        </div>
        
        <div class="token-section">
            <h3>🔑 Add Agreement Token</h3>
            <p>Add a new agreement grant token to the system for E-conomic API access.</p>
            <div style="text-align: center;">
                <input type="text" id="new-token" placeholder="Enter agreement grant token" class="token-input">
                <button onclick="addToken()" class="button success">Add Token</button>
            </div>
        </div>
    </div>
</body>
</html>
"""

@app.route('/')
def dashboard():
    """Enhanced dashboard interface"""
    return render_template_string(ENHANCED_DASHBOARD_HTML)

@app.route('/sync-csv', methods=['POST'])
def trigger_csv_sync():
    """Trigger CSV sync operation"""
    try:
        logger.info("Starting CSV sync operation...")
        
        script_dir = os.path.dirname(os.path.abspath(__file__))
        import_script = os.path.join(script_dir, 'scripts', 'import_budget_mapping.py')
        
        if not os.path.exists(import_script):
            import_script = os.path.join(script_dir, 'import_budget_mapping.py')
            
        if not os.path.exists(import_script):
            raise FileNotFoundError("import_budget_mapping.py not found")
        
        # Use the same Python executable that's running this script to ensure same environment
        python_executable = sys.executable
        
        result = subprocess.run(
            [python_executable, import_script], 
            capture_output=True, 
            text=True,
            cwd=os.path.dirname(import_script) if '/' in import_script else None
        )
        
        if result.returncode == 0:
            logger.info("CSV sync completed successfully")
            return jsonify({
                'status': 'success',
                'timestamp': datetime.now().isoformat(),
                'message': 'CSV sync completed successfully',
                'details': result.stdout.split('\n')[-10:]
            })
        else:
            logger.error(f"CSV sync failed: {result.stderr}")
            return jsonify({
                'status': 'error',
                'timestamp': datetime.now().isoformat(),
                'message': f'CSV sync failed: {result.stderr}',
                'return_code': result.returncode
            }), 500
            
    except Exception as e:
        logger.error(f"Exception during CSV sync: {str(e)}")
        return jsonify({
            'status': 'error',
            'timestamp': datetime.now().isoformat(),
            'message': f'Internal error: {str(e)}'
        }), 500

@app.route('/sync-sharepoint', methods=['POST'])
def trigger_sharepoint_sync():
    """Trigger SharePoint sync operation - EXACTLY like import_budget_mapping.py"""
    sync_start_time = datetime.now()
    sync_log_id = None
    
    try:
        if not SHAREPOINT_AVAILABLE:
            return jsonify({
                'status': 'error',
                'timestamp': sync_start_time.isoformat(),
                'message': 'SharePoint client is not available. Please install Office365-REST-Python-Client.'
            }), 500
        
        logger.info("Starting SharePoint sync operation...")
        
        # Check if a sync is already running
        with ENGINE.begin() as conn:
            result = conn.execute(text("""
                SELECT COUNT(*) as count FROM sync_logs 
                WHERE status = 'running' AND entity = 'sharepoint_sync'
            """))
            if result.fetchone()[0] > 0:
                return jsonify({
                    'status': 'error',
                    'timestamp': sync_start_time.isoformat(),
                    'message': 'SharePoint sync is already running. Please wait for it to complete.'
                }), 409
        
        # Create running log entry
        with ENGINE.begin() as conn:
            result = conn.execute(text("""
                INSERT INTO sync_logs (entity, operation, record_count, status, started_at)
                VALUES (:entity, :operation, :record_count, :status, :started_at)
            """), {
                'entity': 'sharepoint_sync',
                'operation': 'download_and_import',
                'record_count': 0,
                'status': 'running',
                'started_at': sync_start_time
            })
            sync_log_id = result.lastrowid
        
        # Get credentials from environment
        username = os.getenv('SHAREPOINT_USERNAME')
        password = os.getenv('SHAREPOINT_PASSWORD')
        
        if not username or not password:
            # Update log entry with error
            if sync_log_id:
                with ENGINE.begin() as conn:
                    conn.execute(text("""
                        UPDATE sync_logs SET status = 'error', error_message = :error_message, 
                        completed_at = :completed_at, duration_ms = :duration_ms
                        WHERE id = :id
                    """), {
                        'error_message': 'SharePoint credentials not configured',
                        'completed_at': datetime.now(),
                        'duration_ms': int((datetime.now() - sync_start_time).total_seconds() * 1000),
                        'id': sync_log_id
                    })
            
            return jsonify({
                'status': 'error',
                'timestamp': datetime.now().isoformat(),
                'message': 'SharePoint credentials not configured. Please set SHAREPOINT_USERNAME and SHAREPOINT_PASSWORD.'
            }), 500
        
        # 1. CREATE TABLES IF NOT PRESENT - EXACTLY like import_budget_mapping.py
        logger.info("💾  Creating/checking tables...")
        with ENGINE.begin() as conn:
            conn.exec_driver_sql(
                """
                CREATE TABLE IF NOT EXISTS account_mapping (
                  account_number       VARCHAR(20)  NOT NULL,
                  agreement_number     VARCHAR(20)  NOT NULL,
                  mapping_description  VARCHAR(255),
                  category             VARCHAR(255),
                  sub_category         VARCHAR(255),
                  AccountKey           VARCHAR(50)  NOT NULL,
                  PRIMARY KEY (AccountKey)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            
            # Add category column to account_mapping if it doesn't exist
            try:
                conn.exec_driver_sql("SELECT category FROM account_mapping LIMIT 1")
                logger.info("✔ Category column already exists in account_mapping table")
            except:
                conn.exec_driver_sql("ALTER TABLE account_mapping ADD COLUMN category VARCHAR(255) AFTER mapping_description")
                logger.info("✔ Added category column to account_mapping table")

            # Add sub_category column to account_mapping if it doesn't exist
            try:
                conn.exec_driver_sql("SELECT sub_category FROM account_mapping LIMIT 1")
                logger.info("✔ Sub_category column already exists in account_mapping table")
            except:
                conn.exec_driver_sql("ALTER TABLE account_mapping ADD COLUMN sub_category VARCHAR(255) AFTER category")
                logger.info("✔ Added sub_category column to account_mapping table")

            conn.exec_driver_sql(
                """
                CREATE TABLE IF NOT EXISTS budget (
                  account_number       VARCHAR(20)  NOT NULL,
                  mapping_description  VARCHAR(255),
                  category             VARCHAR(255),
                  sub_category         VARCHAR(255),
                  year                 INT          NOT NULL,
                  month                INT          NOT NULL,
                  amount               DECIMAL(15,2),
                  agreement_number     VARCHAR(20)  NOT NULL,
                  AccountKey           VARCHAR(50)  NOT NULL,
                  PRIMARY KEY (AccountKey, year, month)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
                """
            )
            
            # Add category column to budget if it doesn't exist
            try:
                conn.exec_driver_sql("SELECT category FROM budget LIMIT 1")
                logger.info("✔ Category column already exists in budget table")
            except:
                conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN category VARCHAR(255) AFTER mapping_description")
                logger.info("✔ Added category column to budget table")

            # Add sub_category column to budget if it doesn't exist
            try:
                conn.exec_driver_sql("SELECT sub_category FROM budget LIMIT 1")
                logger.info("✔ Sub_category column already exists in budget table")
            except:
                conn.exec_driver_sql("ALTER TABLE budget ADD COLUMN sub_category VARCHAR(255) AFTER category")
                logger.info("✔ Added sub_category column to budget table")

        logger.info("✔  Tables are ready.")
        
        # Download files from SharePoint
        download_result = download_squaremeter_files(username, password)
        
        if not download_result['success']:
            logger.error(f"SharePoint download failed: {download_result.get('error', 'Unknown error')}")
            
            # Log the failed operation to database
            try:
                with ENGINE.begin() as conn:
                    conn.execute(text("""
                        INSERT INTO sync_logs (entity, operation, record_count, status, error_message, started_at, completed_at, duration_ms)
                        VALUES (:entity, :operation, :record_count, :status, :error_message, :started_at, :completed_at, :duration_ms)
                    """), {
                        'entity': 'sharepoint_sync',
                        'operation': 'download_and_import',
                        'record_count': 0,
                        'status': 'error',
                        'error_message': download_result.get('error', 'Unknown error'),
                        'started_at': sync_start_time,
                        'completed_at': datetime.now(),
                        'duration_ms': int((datetime.now() - sync_start_time).total_seconds() * 1000)
                    })
            except Exception as e:
                logger.error(f"Failed to log error to database: {str(e)}")
            
            return jsonify({
                'status': 'error',
                'timestamp': datetime.now().isoformat(),
                'message': f"SharePoint download failed: {download_result.get('error', 'Unknown error')}"
            }), 500
        
        logger.info(f"→ Found {len(download_result.get('account_files', []))} mapping files, {len(download_result.get('budget_files', []))} budget files")
        
        if not download_result.get('account_files') and not download_result.get('budget_files'):
            return jsonify({
                'status': 'warning',
                'timestamp': datetime.now().isoformat(),
                'message': '⚠  Nothing to import – no files found.'
            })
        
        import_results = []
        
        # 2. LOAD / MERGE ACCOUNT-MAPPING - EXACTLY like import_budget_mapping.py
        all_map = []
        if download_result.get('account_files'):
            logger.info(f"Processing {len(download_result['account_files'])} account mapping files...")
            
            for file_name in download_result['account_files']:
                # Match both naming patterns: accounts_mapping_* and squaremeter_accounts_mapping_*
                if ('accounts_mapping' in file_name.lower() or 
                    'squaremeter_accounts_mapping' in file_name.lower()):
                    try:
                        file_path = os.path.join('./downloads/sharepoint/economics', file_name)
                        df = process_csv_file(file_path, 'account_mapping')
                        if isinstance(df, pd.DataFrame):
                            all_map.append(df)
                        else:
                            import_results.append(f"Error processing {file_name}: {df}")
                    except Exception as e:
                        import_results.append(f"Error processing {file_name}: {str(e)}")
            
            if all_map:
                # Concatenate and deduplicate EXACTLY like import_budget_mapping.py
                map_df = (
                    pd.concat(all_map, ignore_index=True)
                    .drop_duplicates(subset=["AccountKey"])
                    .astype({"account_number": str, "agreement_number": str})
                )
                
                # Truncate and reload EXACTLY like import_budget_mapping.py
                with ENGINE.begin() as conn:
                    conn.exec_driver_sql("TRUNCATE TABLE account_mapping")
                map_df.to_sql("account_mapping", ENGINE, if_exists="append", index=False)
                logger.info(f"✔  Loaded {len(map_df)} mapping rows into account_mapping")
                import_results.append(f"Account mapping: Imported {len(map_df)} records")
            else:
                logger.warning("✖  No valid mapping rows")
                import_results.append("Account mapping: No valid rows found")
        
        # Reload lookup for budget processing EXACTLY like import_budget_mapping.py
        lookup = pd.read_sql(
            "SELECT account_number, agreement_number, mapping_description, category, sub_category, AccountKey "
            "FROM account_mapping",
            ENGINE,
        )
        
        # 3. LOAD BUDGET FILES - EXACTLY like import_budget_mapping.py
        all_bud = []
        if download_result.get('budget_files'):
            logger.info(f"Processing {len(download_result['budget_files'])} budget files...")
            
            for file_name in download_result['budget_files']:
                if 'budget' in file_name.lower():
                    try:
                        file_path = os.path.join('./downloads/sharepoint/budget', file_name)
                        df = process_csv_file(file_path, 'budget')
                        if isinstance(df, pd.DataFrame):
                            # → LOOKUP real account_number / AccountKey EXACTLY like import_budget_mapping.py
                            df = df.merge(
                                lookup,
                                on=["mapping_description", "agreement_number"],
                                how="left",
                            )
                            unmatched = df["AccountKey"].isna().sum()
                            if unmatched:
                                logger.warning(f"  ⚠  {unmatched} lines in {file_name} had no mapping – skipped")
                                df = df.dropna(subset=["AccountKey"])

                            df["account_number"] = df["account_number"].astype(str)
                            final_df = df[
                                [
                                    "account_number",
                                    "mapping_description",
                                    "category",
                                    "sub_category",
                                    "year",
                                    "month",
                                    "amount",
                                    "agreement_number",
                                    "AccountKey",
                                ]
                            ]
                            all_bud.append(final_df)
                            logger.info(f"✔  {file_name}: kept {len(final_df)} budget rows")
                        else:
                            import_results.append(f"Error processing {file_name}: {df}")
                    except Exception as e:
                        logger.error(f"✖  {file_name}: {str(e)}")
                        import traceback
                        traceback.print_exc()
                        import_results.append(f"Error processing {file_name}: {str(e)}")
            
            if all_bud:
                # Concatenate and deduplicate EXACTLY like import_budget_mapping.py
                bud_df = pd.concat(all_bud, ignore_index=True)
                
                # Keep only one entry per mapping_description and agreement_number per month/year
                deduped_bud_df = bud_df.drop_duplicates(
                    subset=['mapping_description', 'agreement_number', 'year', 'month']
                )
                
                # Truncate and reload EXACTLY like import_budget_mapping.py
                with ENGINE.begin() as conn:
                    conn.exec_driver_sql("TRUNCATE TABLE budget")
                deduped_bud_df.to_sql("budget", ENGINE, if_exists="append", index=False)
                logger.info(f"✔  Loaded {len(deduped_bud_df)} rows into budget (after removing duplicates)")
                import_results.append(f"Budget: Imported {len(deduped_bud_df)} records")
            else:
                logger.warning("✖  No budget rows loaded")
                import_results.append("Budget: No valid rows found")
        
        logger.info("✅  Import finished successfully.")
        
        # Update the running log entry to completed
        total_records = 0
        if all_map:
            total_records += len(all_map[0]) if all_map else 0
        if all_bud:
            total_records += sum(len(df) for df in all_bud)
        
        if sync_log_id:
            with ENGINE.begin() as conn:
                conn.execute(text("""
                    UPDATE sync_logs SET status = 'success', record_count = :record_count,
                    completed_at = :completed_at, duration_ms = :duration_ms
                    WHERE id = :id
                """), {
                    'record_count': total_records,
                    'completed_at': datetime.now(),
                    'duration_ms': int((datetime.now() - sync_start_time).total_seconds() * 1000),
                    'id': sync_log_id
                })
        
        return jsonify({
            'status': 'success',
            'timestamp': datetime.now().isoformat(),
            'message': 'SharePoint sync completed successfully',
            'details': {
                'account_files': download_result.get('account_files', []),
                'budget_files': download_result.get('budget_files', []),
                'import_results': import_results
            }
        })
        
    except Exception as e:
        logger.error(f"Exception during SharePoint sync: {str(e)}")
        import traceback
        traceback.print_exc()
        
        # Update running log entry with error
        if sync_log_id:
            try:
                with ENGINE.begin() as conn:
                    conn.execute(text("""
                        UPDATE sync_logs SET status = 'error', error_message = :error_message,
                        completed_at = :completed_at, duration_ms = :duration_ms
                        WHERE id = :id
                    """), {
                        'error_message': str(e),
                        'completed_at': datetime.now(),
                        'duration_ms': int((datetime.now() - sync_start_time).total_seconds() * 1000),
                        'id': sync_log_id
                    })
            except Exception as update_error:
                logger.error(f"Failed to update sync log with error: {str(update_error)}")
        
        return jsonify({
            'status': 'error',
            'timestamp': datetime.now().isoformat(),
            'message': f'Internal error: {str(e)}'
        }), 500

@app.route('/test-sharepoint', methods=['GET'])
def test_sharepoint_connection():
    """Test SharePoint connection"""
    try:
        if not SHAREPOINT_AVAILABLE:
            return jsonify({
                'status': 'error',
                'message': 'SharePoint client is not available'
            }), 500
        
        username = os.getenv('SHAREPOINT_USERNAME')
        password = os.getenv('SHAREPOINT_PASSWORD')
        
        if not username or not password:
            return jsonify({
                'status': 'error',
                'message': 'SharePoint credentials not configured'
            }), 500
        
        # Test connection
        client = create_squaremeter_client(username, password)
        if client.connect():
            return jsonify({
                'status': 'success',
                'message': 'SharePoint connection successful',
                'username': username,
                'site_url': os.getenv('SHAREPOINT_SITE_URL')
            })
        else:
            return jsonify({
                'status': 'error',
                'message': 'Failed to connect to SharePoint'
            }), 500
            
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Error testing SharePoint connection: {str(e)}'
        }), 500

def process_csv_file(file_path: str, table_type: str) -> str:
    """
    Process a CSV file and import it to the database - EXACTLY like import_budget_mapping.py
    
    Args:
        file_path: Path to the CSV file
        table_type: Type of table ('account_mapping' or 'budget')
    
    Returns:
        str: Result message
    """
    try:
        if not os.path.exists(file_path):
            return f"File not found: {file_path}"
        
        logger.info(f"Processing {table_type} file: {file_path}")
        
        if table_type == 'account_mapping':
            # Extract agreement number from filename - EXACTLY like import_budget_mapping.py
            filename = os.path.basename(file_path)
            import re
            agr_match = re.search(r"_(\d+)\.csv$", filename)
            agreement = agr_match.group(1) if agr_match else "0000000"
            
            # Read CSV EXACTLY like import_budget_mapping.py
            df = pd.read_csv(file_path, sep=";")
            logger.info(f"📊  {filename}: Read {len(df)} total rows from CSV")
            
            # Heuristic column detection EXACTLY like import_budget_mapping.py
            acc_col = next(c for c in df.columns if re.search(r"account|nr", c, re.I))
            map_col = next(c for c in df.columns if re.search(r"mapping", c, re.I))
            
            # Try to find Category column (case-insensitive)
            cat_col = next((c for c in df.columns if c.lower() == "category"), None)
            
            # Try to find Sub_Category column (case-insensitive)
            sub_cat_col = next((c for c in df.columns if c.lower() == "sub_category"), None)
            
            # Create column list based on available columns
            cols_to_use = [acc_col, map_col]
            rename_dict = {acc_col: "account_number", map_col: "mapping_description"}
            
            if cat_col:
                cols_to_use.append(cat_col)
                rename_dict[cat_col] = "category"

            if sub_cat_col:
                cols_to_use.append(sub_cat_col)
                rename_dict[sub_cat_col] = "sub_category"

            df = df[cols_to_use].rename(columns=rename_dict)
            
            # Only filter out completely empty rows - keep everything else including #N/A
            initial_count = len(df)
            df = df.dropna(how='all')  # Only drop if ALL columns are NaN
            after_dropna = len(df)
            
            # Don't filter out #N/A or empty strings - keep everything
            df["agreement_number"] = agreement
            df["AccountKey"] = df["account_number"].astype(str) + "_" + agreement
            
            # Ensure category column exists (with empty values if not found in CSV)
            if "category" not in df.columns:
                df["category"] = None
                
            # Ensure sub_category column exists (with empty values if not found in CSV)
            if "sub_category" not in df.columns:
                df["sub_category"] = None
                
            logger.info(f"✔  {filename}: {len(df)} rows (dropped {initial_count - after_dropna} completely empty rows)")
            
            return df  # Return DataFrame for batch processing
            
        elif table_type == 'budget':
            # Extract filename and year/agreement EXACTLY like import_budget_mapping.py
            filename = os.path.basename(file_path)
            import re
            m = re.search(r"budget_(\d{4})_(\d+)\.csv$", filename, re.I)
            if m:
                year = int(m.group(1))
                agreement = m.group(2)
            else:
                # old pattern budget_<agr>.csv (year will be 2024)
                m = re.search(r"budget_(\d+)\.csv$", filename, re.I)
                agreement = m.group(1) if m else "0000000"
                year = 2024

            logger.info(f"Processing budget file: {file_path}")
            logger.info(f"Extracted: year={year}, agreement={agreement}")

            # Read CSV EXACTLY like import_budget_mapping.py
            raw = pd.read_csv(file_path, sep=";", header=2)  # Row 3 has the proper headers
            raw.rename(columns={raw.columns[0]: "mapping_description"}, inplace=True)
            raw = raw.dropna(how="all")
            
            logger.info(f"Raw CSV loaded: {len(raw)} rows, {len(raw.columns)} columns")
            logger.info(f"Raw columns: {list(raw.columns)}")

            # Find the 12 month columns - accounting for Primo column EXACTLY like import_budget_mapping.py
            cols = raw.columns.tolist()
            logger.info(f"DEBUG: All columns in {filename}: {cols}")
            
            if re.search(r"primo", " ".join(cols), re.I):
                primo_idx = next(i for i, c in enumerate(cols) if re.search(r"primo", c, re.I))
                month_cols = cols[primo_idx + 1 : primo_idx + 13]  # Skip Primo, take next 12
                logger.info(f"DEBUG: Found Primo at index {primo_idx}, month_cols: {month_cols}")
            else:
                month_cols = cols[1:13]
                logger.info(f"DEBUG: No Primo found, using cols[1:13]: {month_cols}")

            # Melt EXACTLY like import_budget_mapping.py
            df = raw.melt(
                id_vars=["mapping_description"],
                value_vars=month_cols,
                var_name="month_name",
                value_name="amount",
            )
            
            # Month number by position (1…12) - January should be month 1
            df["month"] = df["month_name"].apply(lambda c: month_cols.index(c) + 1)
            logger.info(f"DEBUG: Sample of month assignments: {df[['month_name', 'month']].drop_duplicates().head()}")
            df["year"] = year
            df["agreement_number"] = agreement

            logger.info(f"After melt: {len(df)} records")

            # Clean amounts EXACTLY like import_budget_mapping.py
            df["amount"] = (
                df["amount"]
                .astype(str)
                .str.replace(r"[^\d,.\-]", "", regex=True)
                .str.replace(",", ".", regex=False)
            )
            df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
            df = df.dropna(subset=["amount"])

            logger.info(f"After amount cleaning: {len(df)} records")

            # Drop totals / empty rows EXACTLY like import_budget_mapping.py
            df = df[
                ~df["mapping_description"]
                .astype(str)
                .str.contains(r"TOTAL|COMMENT|STATEMENT|BALANCE|CASH|^$", case=False, regex=True)
            ]

            logger.info(f"After filtering: {len(df)} records")

            return df  # Return DataFrame for batch processing
    
        else:
            return f"Unknown table type: {table_type}"
            
    except Exception as e:
        logger.error(f"Error processing {file_path}: {str(e)}")
        import traceback
        traceback.print_exc()
        return f"Error: {str(e)}"

@app.route('/enhanced-stats', methods=['GET'])
def get_enhanced_stats():
    """Get comprehensive statistics including main app data"""
    try:
        with ENGINE.begin() as conn:
            # CSV-related stats
            result = conn.execute(text("SELECT COUNT(*) as count FROM account_mapping"))
            account_mappings = result.fetchone()[0]
            
            result = conn.execute(text("SELECT COUNT(*) as count FROM budget"))
            budget_records = result.fetchone()[0]
            
            result = conn.execute(text("SELECT COUNT(DISTINCT agreement_number) as count FROM account_mapping"))
            agreements = result.fetchone()[0]
            
            # Main app stats
            try:
                result = conn.execute(text("SELECT COUNT(*) as count FROM invoices"))
                total_invoices = result.fetchone()[0]
            except:
                total_invoices = 0
            
            # Sync operations today
            today = datetime.now().date()
            try:
                result = conn.execute(text("""
                    SELECT COUNT(*) as count FROM sync_logs 
                    WHERE DATE(started_at) = :today
                """), {'today': today})
                sync_operations_today = result.fetchone()[0]
            except:
                sync_operations_today = 0
            
            # Failed operations today
            try:
                result = conn.execute(text("""
                    SELECT COUNT(*) as count FROM sync_logs 
                    WHERE DATE(started_at) = :today AND status IN ('error', 'partial')
                """), {'today': today})
                failed_operations = result.fetchone()[0]
            except:
                failed_operations = 0
            
        return jsonify({
            'account_mappings': account_mappings,
            'budget_records': budget_records,
            'total_invoices': total_invoices,
            'agreements': agreements,
            'sync_operations_today': sync_operations_today,
            'failed_operations': failed_operations,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error getting enhanced stats: {str(e)}")
        return jsonify({
            'account_mappings': 0,
            'budget_records': 0,
            'total_invoices': 0,
            'agreements': 0,
            'sync_operations_today': 0,
            'failed_operations': 0,
            'error': str(e)
        }), 500

@app.route('/quick-status', methods=['GET'])
def get_quick_status():
    """Get quick status overview"""
    try:
        # Test database connection
        with ENGINE.begin() as conn:
            conn.execute(text("SELECT 1"))
            db_status = "Connected"
            
            # Get last SharePoint sync from database instead of log file
            last_sharepoint_sync = None
            try:
                result = conn.execute(text("""
                    SELECT MAX(completed_at) as last_sync FROM sync_logs 
                    WHERE entity = 'sharepoint_sync' AND status = 'success'
                """))
                row = result.fetchone()
                if row and row[0]:
                    last_sharepoint_sync = row[0].isoformat()
            except:
                # Fallback to log file parsing if database query fails
                try:
                    if os.path.exists('sync_api.log'):
                        with open('sync_api.log', 'r') as f:
                            lines = f.readlines()
                            for line in reversed(lines):
                                if 'SharePoint sync completed successfully' in line:
                                    # Extract the timestamp from the beginning of the log line
                                    timestamp_str = line.split(' - ')[0]
                                    # Convert to ISO format for consistent parsing
                                    parsed_time = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S,%f')
                                    last_sharepoint_sync = parsed_time.isoformat()
                                    break
                except Exception as parse_error:
                    logger.warning(f"Could not parse SharePoint sync timestamp: {parse_error}")
                    pass
            
            # Get last main app sync
            last_main_sync = None
            try:
                result = conn.execute(text("""
                    SELECT MAX(completed_at) as last_sync FROM sync_logs 
                    WHERE status = 'success' AND entity LIKE '%_all_agreements'
                """))
                row = result.fetchone()
                if row and row[0]:
                    last_main_sync = row[0].isoformat()
            except:
                pass
            
            # Get recent errors (last 24 hours)
            recent_errors = 0
            try:
                yesterday = datetime.now() - timedelta(days=1)
                result = conn.execute(text("""
                    SELECT COUNT(*) as count FROM sync_logs 
                    WHERE started_at >= :yesterday AND status IN ('error', 'partial')
                """), {'yesterday': yesterday})
                recent_errors = result.fetchone()[0]
            except:
                pass
                
            # Check for currently running syncs (All types including SharePoint)
            is_sync_running = False
            running_sync_details = None
            try:
                result = conn.execute(text("""
                    SELECT entity, operation, started_at FROM sync_logs 
                    WHERE status = 'running'
                    ORDER BY started_at DESC LIMIT 1
                """))
                row = result.fetchone()
                if row:
                    is_sync_running = True
                    running_sync_details = {
                        'entity': row[0],
                        'operation': row[1],
                        'started_at': row[2].isoformat() if row[2] else None
                    }
            except:
                pass
                
    except Exception as e:
        db_status = f"Error: {str(e)}"
        last_sharepoint_sync = None
        last_main_sync = None
        recent_errors = None
        is_sync_running = False
    
    return jsonify({
        'dbStatus': db_status,
        'lastSharePointSync': last_sharepoint_sync,
        'lastMainSync': last_main_sync,
        'recentErrors': recent_errors,
        'isSyncRunning': is_sync_running,
        'runningSyncDetails': running_sync_details,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/sync-history', methods=['GET'])
def get_sync_history():
    """Get sync operation history"""
    try:
        entity_filter = request.args.get('filter', 'all')
        
        with ENGINE.begin() as conn:
            base_query = """
                SELECT 
                    entity,
                    operation,
                    record_count,
                    status,
                    error_message,
                    started_at,
                    completed_at,
                    duration_ms
                FROM sync_logs 
            """
            
            params = {}
            if entity_filter != 'all':
                if entity_filter == 'sharepoint':
                    base_query += " WHERE entity IN ('sharepoint_sync', 'account_mapping', 'budget') AND operation LIKE '%sharepoint%' "
                elif entity_filter == 'account_mapping':
                    base_query += " WHERE entity = 'account_mapping' "
                elif entity_filter == 'budget':
                    base_query += " WHERE entity = 'budget' "
                else:
                    base_query += " WHERE entity LIKE :filter "
                    params['filter'] = f"%{entity_filter}%"
            
            base_query += " ORDER BY started_at DESC LIMIT 50"
            
            result = conn.execute(text(base_query), params)
            rows = result.fetchall()
            
            history = []
            for row in rows:
                # Create display name for entity
                entity_display = row[0]
                if '_' in entity_display:
                    parts = entity_display.split('_')
                    if parts[-1].isdigit():  # Agreement number
                        entity_display = f"{' '.join(parts[:-1]).title()} (Agreement {parts[-1]})"
                    else:
                        entity_display = ' '.join(parts).title()
                else:
                    entity_display = entity_display.title()
                
                history.append({
                    'entity': row[0],
                    'entity_display': entity_display,
                    'operation': row[1].title(),
                    'record_count': row[2] or 0,
                    'status': row[3],
                    'error_message': row[4],
                    'started_at': row[5].strftime('%Y-%m-%d %H:%M:%S') if row[5] else '',
                    'completed_at': row[6].strftime('%Y-%m-%d %H:%M:%S') if row[6] else '',
                    'duration_ms': row[7] or 0
                })
        
        return jsonify({
            'history': history,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Error getting sync history: {str(e)}")
        return jsonify({
            'history': [],
            'error': str(e)
        }), 500

@app.route('/main-sync-status', methods=['GET'])
def get_main_sync_status():
    """Get status of main e-conomic sync operations"""
    try:
        with ENGINE.begin() as conn:
            # Get last successful sync
            result = conn.execute(text("""
                SELECT MAX(completed_at) as last_sync FROM sync_logs 
                WHERE status = 'success'
            """))
            row = result.fetchone()
            last_sync = row[0].isoformat() if row and row[0] else None
            
            # Get today's operations
            today = datetime.now().date()
            result = conn.execute(text("""
                SELECT COUNT(*) as count FROM sync_logs 
                WHERE DATE(started_at) = :today
            """), {'today': today})
            today_operations = result.fetchone()[0]
            
            # Get failed operations
            result = conn.execute(text("""
                SELECT COUNT(*) as count FROM sync_logs 
                WHERE DATE(started_at) = :today AND status IN ('error', 'partial')
            """), {'today': today})
            failed_operations = result.fetchone()[0]
        
        return jsonify({
            'lastSync': last_sync,
            'todayOperations': today_operations,
            'failedOperations': failed_operations,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({
            'lastSync': None,
            'todayOperations': 0,
            'failedOperations': 0,
            'error': str(e)
        }), 500

@app.route('/system-logs', methods=['GET'])
def get_system_logs():
    """Get system logs from main application"""
    try:
        logs_content = ""
        
        # Read the most recent application log
        log_files = [
            'logs/app-{}.log'.format(datetime.now().strftime('%Y-%m-%d')),
            'logs/combined-{}.log'.format(datetime.now().strftime('%Y-%m-%d'))
        ]
        
        for log_file in log_files:
            if os.path.exists(log_file):
                with open(log_file, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                    # Get last 100 lines and strip trailing newlines
                    logs_content = ''.join(lines[-100:]).strip()
                break
        
        if not logs_content:
            logs_content = "No recent system logs found"
            
        return jsonify({
            'logs': logs_content,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({
            'logs': f"Error reading system logs: {str(e)}",
            'timestamp': datetime.now().isoformat()
        }), 500

@app.route('/error-logs', methods=['GET'])
def get_error_logs():
    """Get error logs from main application"""
    try:
        logs_content = ""
        
        # Read the most recent error log
        error_log = 'logs/error-{}.log'.format(datetime.now().strftime('%Y-%m-%d'))
        
        if os.path.exists(error_log):
            with open(error_log, 'r', encoding='utf-8') as f:
                logs_content = f.read().strip()
        
        if not logs_content:
            logs_content = "No error logs for today ✅"
            
        return jsonify({
            'logs': logs_content,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({
            'logs': f"Error reading error logs: {str(e)}",
            'timestamp': datetime.now().isoformat()
        }), 500

@app.route('/sync-economic-full', methods=['POST'])
def trigger_economic_full_sync():
    """Trigger full E-conomic API sync with running status tracking"""
    return trigger_economic_sync('full_sync', '/api/sync', 'Full E-conomic sync')

@app.route('/sync-economic-invoices', methods=['POST'])
def trigger_economic_invoice_sync():
    """Trigger E-conomic invoice sync with running status tracking"""
    return trigger_economic_sync('invoices_all_agreements', '/api/invoices/sync', 'Invoice sync')

def trigger_economic_sync(entity_name, api_endpoint, display_name):
    """Generic function to trigger E-conomic API syncs with running status tracking"""
    sync_start_time = datetime.now()
    sync_log_id = None
    
    try:
        # Check if a sync is already running
        with ENGINE.begin() as conn:
            result = conn.execute(text("""
                SELECT COUNT(*) as count FROM sync_logs 
                WHERE status = 'running' AND entity = :entity
            """), {'entity': entity_name})
            if result.fetchone()[0] > 0:
                return jsonify({
                    'status': 'error',
                    'timestamp': sync_start_time.isoformat(),
                    'message': f'{display_name} is already running. Please wait for it to complete.'
                }), 409
        
        # Create running log entry
        with ENGINE.begin() as conn:
            result = conn.execute(text("""
                INSERT INTO sync_logs (entity, operation, record_count, status, started_at)
                VALUES (:entity, :operation, :record_count, :status, :started_at)
            """), {
                'entity': entity_name,
                'operation': 'sync',
                'record_count': 0,
                'status': 'running',
                'started_at': sync_start_time
            })
            sync_log_id = result.lastrowid
        
        logger.info(f"Starting {display_name} operation...")
        
        # Trigger the sync in a background thread to avoid blocking
        def run_sync():
            try:
                # Make request to main E-conomic API
                response = requests.post(f'http://localhost:3000{api_endpoint}', 
                                       timeout=7200,  # 2 hour timeout for long syncs
                                       headers={'Content-Type': 'application/json'})
                
                sync_end_time = datetime.now()
                duration_ms = int((sync_end_time - sync_start_time).total_seconds() * 1000)
                
                if response.status_code == 200:
                    try:
                        result_data = response.json()
                        record_count = result_data.get('totalCount', 0)
                    except:
                        record_count = 0
                    
                    # Update log entry with success
                    with ENGINE.begin() as conn:
                        conn.execute(text("""
                            UPDATE sync_logs SET status = 'success', record_count = :record_count,
                            completed_at = :completed_at, duration_ms = :duration_ms
                            WHERE id = :id
                        """), {
                            'record_count': record_count,
                            'completed_at': sync_end_time,
                            'duration_ms': duration_ms,
                            'id': sync_log_id
                        })
                    
                    logger.info(f"{display_name} completed successfully in {duration_ms}ms")
                else:
                    # Update log entry with error
                    error_message = f"API returned status {response.status_code}"
                    with ENGINE.begin() as conn:
                        conn.execute(text("""
                            UPDATE sync_logs SET status = 'error', error_message = :error_message,
                            completed_at = :completed_at, duration_ms = :duration_ms
                            WHERE id = :id
                        """), {
                            'error_message': error_message,
                            'completed_at': sync_end_time,
                            'duration_ms': duration_ms,
                            'id': sync_log_id
                        })
                    
                    logger.error(f"{display_name} failed with status {response.status_code}")
                    
            except Exception as e:
                sync_end_time = datetime.now()
                duration_ms = int((sync_end_time - sync_start_time).total_seconds() * 1000)
                
                # Update log entry with error
                with ENGINE.begin() as conn:
                    conn.execute(text("""
                        UPDATE sync_logs SET status = 'error', error_message = :error_message,
                        completed_at = :completed_at, duration_ms = :duration_ms
                        WHERE id = :id
                    """), {
                        'error_message': str(e),
                        'completed_at': sync_end_time,
                        'duration_ms': duration_ms,
                        'id': sync_log_id
                    })
                
                logger.error(f"{display_name} failed with error: {str(e)}")
        
        # Start sync in background thread
        sync_thread = threading.Thread(target=run_sync)
        sync_thread.daemon = True
        sync_thread.start()
        
        return jsonify({
            'status': 'started',
            'timestamp': sync_start_time.isoformat(),
            'message': f'{display_name} has been started in the background. Check the sync history for progress.',
            'sync_log_id': sync_log_id
        })
        
    except Exception as e:
        logger.error(f"Exception starting {display_name}: {str(e)}")
        
        # Update running log entry with error if it was created
        if sync_log_id:
            try:
                with ENGINE.begin() as conn:
                    conn.execute(text("""
                        UPDATE sync_logs SET status = 'error', error_message = :error_message,
                        completed_at = :completed_at, duration_ms = :duration_ms
                        WHERE id = :id
                    """), {
                        'error_message': str(e),
                        'completed_at': datetime.now(),
                        'duration_ms': int((datetime.now() - sync_start_time).total_seconds() * 1000),
                        'id': sync_log_id
                    })
            except Exception as update_error:
                logger.error(f"Failed to update sync log with error: {str(update_error)}")
        
        return jsonify({
            'status': 'error',
            'timestamp': datetime.now().isoformat(),
            'message': f'Failed to start {display_name}: {str(e)}'
        }), 500

@app.route('/health')
def health_dashboard():
    """Enhanced health monitoring dashboard with GUI"""
    return render_template_string(HEALTH_DASHBOARD_HTML)

@app.route('/health-api')
def health_check_api():
    """Comprehensive health check API endpoint"""
    start_time = time.time()
    health_data = {
        'timestamp': datetime.now().isoformat(),
        'overall_status': 'healthy',
        'checks': {},
        'alerts': [],
        'database_metrics': {},
        'api_tests': {}
    }
    
    # 1. Database Health Check
    try:
        with ENGINE.begin() as conn:
            # Test basic connectivity
            result = conn.execute(text("SELECT 1 as test"))
            test_row = result.fetchone()
            if test_row and test_row[0] == 1:
                health_data['checks']['Database Connectivity'] = {
                    'status': 'pass',
                    'message': 'Database connection successful'
                }
            else:
                health_data['checks']['Database Connectivity'] = {
                    'status': 'fail',
                    'message': 'Database test query failed'
                }
                health_data['overall_status'] = 'error'
            
            # Get database metrics
            try:
                # Count agreements
                result = conn.execute(text("SELECT COUNT(*) as count FROM agreement_configs WHERE is_active = 1"))
                active_agreements = result.fetchone()[0]
                health_data['database_metrics']['Active Agreements'] = active_agreements
                
                # Count account mappings 
                result = conn.execute(text("SELECT COUNT(DISTINCT agreement_number) as count FROM account_mapping"))
                mapped_agreements = result.fetchone()[0]
                health_data['database_metrics']['Agreements with Account Mapping'] = mapped_agreements
                
                # Count budget records
                result = conn.execute(text("SELECT COUNT(DISTINCT agreement_number) as count FROM budget"))
                budget_agreements = result.fetchone()[0] 
                health_data['database_metrics']['Agreements with Budget Data'] = budget_agreements
                
                # Check for missing mappings/budget - CRITICAL ALERT
                if active_agreements > 0:
                    missing_mappings = active_agreements - mapped_agreements
                    missing_budgets = active_agreements - budget_agreements
                    
                    if missing_mappings > 0:
                        health_data['alerts'].append({
                            'severity': 'critical',
                            'title': 'Missing Account Mappings',
                            'message': f'{missing_mappings} active agreement(s) are missing account mapping data. This will prevent proper invoice categorization.'
                        })
                        health_data['overall_status'] = 'warning'
                    
                    if missing_budgets > 0:
                        health_data['alerts'].append({
                            'severity': 'warning', 
                            'title': 'Missing Budget Data',
                            'message': f'{missing_budgets} active agreement(s) are missing budget data. Budget tracking will be incomplete.'
                        })
                        if health_data['overall_status'] == 'healthy':
                            health_data['overall_status'] = 'warning'
                
                # Recent sync status
                result = conn.execute(text("""
                    SELECT COUNT(*) as count FROM sync_logs 
                    WHERE DATE(started_at) = CURDATE() AND status = 'error'
                """))
                todays_errors = result.fetchone()[0]
                health_data['database_metrics']['Todays Sync Errors'] = todays_errors
                
                if todays_errors > 50:
                    health_data['alerts'].append({
                        'severity': 'critical',
                        'title': 'High Sync Error Rate',
                        'message': f'{todays_errors} sync errors occurred today. Please review sync logs and check system health.'
                    })
                    health_data['overall_status'] = 'error'
                elif todays_errors > 20:
                    health_data['alerts'].append({
                        'severity': 'warning',
                        'title': 'Elevated Sync Error Rate',
                        'message': f'{todays_errors} sync errors occurred today. Monitor sync performance.'
                    })
                    if health_data['overall_status'] == 'healthy':
                        health_data['overall_status'] = 'warning'
                
            except Exception as e:
                logger.error(f"Error getting database metrics: {str(e)}")
                health_data['checks']['Database Metrics'] = {
                    'status': 'fail',
                    'message': f'Error retrieving database metrics: {str(e)}'
                }
                
    except Exception as e:
        logger.error(f"Database health check failed: {str(e)}")
        health_data['checks']['Database Connectivity'] = {
            'status': 'fail',
            'message': f'Database connection failed: {str(e)}'
        }
        health_data['overall_status'] = 'error'
    
    # 2. Main API Health Check (Port 3000)
    try:
        response = requests.get(f'{MAIN_API_URL}/health', timeout=5)
        api_response_time = round((time.time() - start_time) * 1000, 2)
        
        if response.status_code == 200:
            health_data['checks']['Main API Service'] = {
                'status': 'pass',
                'message': 'Main API service is responding'
            }
            health_data['api_tests']['Main API Health'] = {
                'status': 'pass',
                'message': 'API health endpoint responding',
                'response_time': api_response_time
            }
        else:
            health_data['checks']['Main API Service'] = {
                'status': 'warning',
                'message': f'Main API returned status {response.status_code} - may not be critical'
            }
            if health_data['overall_status'] == 'healthy':
                health_data['overall_status'] = 'warning'
            
    except requests.exceptions.ConnectionError:
        health_data['checks']['Main API Service'] = {
            'status': 'warning',
            'message': 'Cannot connect to main API service (port 3000) - this is normal if main API is not running'
        }
        # Don't set overall status to error for this - it's optional
        if health_data['overall_status'] == 'healthy':
            health_data['overall_status'] = 'warning'
    except Exception as e:
        health_data['checks']['Main API Service'] = {
            'status': 'warning',
            'message': f'Main API check failed: {str(e)} - may not be critical'
        }
        if health_data['overall_status'] == 'healthy':
            health_data['overall_status'] = 'warning'
    
    # 3. E-conomic API Authentication Test
    try:
        if APP_SECRET_TOKEN:
            # Get a real agreement token from database for testing
            agreement_token = None
            try:
                with ENGINE.begin() as conn:
                    result = conn.execute(text("SELECT agreement_grant_token FROM agreement_configs WHERE is_active = 1 LIMIT 1"))
                    row = result.fetchone()
                    if row:
                        agreement_token = row[0]
            except:
                pass
            
            if agreement_token:
                headers = {
                    'X-AppSecretToken': APP_SECRET_TOKEN,
                    'X-AgreementGrantToken': agreement_token,
                    'Content-Type': 'application/json'
                }
                
                test_start = time.time()
                # Test with invoices endpoint which requires both tokens
                response = requests.get(f'{API_BASE_URL}/invoices?pageSize=1', headers=headers, timeout=10)
                api_response_time = round((time.time() - test_start) * 1000, 2)
                
                if response.status_code == 200:
                    health_data['api_tests']['E-conomic Authentication'] = {
                        'status': 'pass',
                        'message': 'E-conomic API authentication successful',
                        'response_time': api_response_time
                    }
                    health_data['checks']['E-conomic API Access'] = {
                        'status': 'pass',
                        'message': 'API authentication working correctly'
                    }
                elif response.status_code == 403:
                    health_data['api_tests']['E-conomic Authentication'] = {
                        'status': 'pass',
                        'message': 'E-conomic API token works (403 expected for some endpoints)',
                        'response_time': api_response_time
                    }
                    health_data['checks']['E-conomic API Access'] = {
                        'status': 'pass',
                        'message': 'API token works correctly (limited permissions are normal)'
                    }
                elif response.status_code == 401:
                    health_data['api_tests']['E-conomic Authentication'] = {
                        'status': 'fail',
                        'message': f'E-conomic API authentication failed - check tokens',
                        'response_time': api_response_time
                    }
                    health_data['checks']['E-conomic API Access'] = {
                        'status': 'fail',
                        'message': 'API authentication failed - verify APP_SECRET_TOKEN and agreement tokens'
                    }
                else:
                    # For other status codes, try a simpler endpoint
                    try:
                        test_start2 = time.time()
                        response2 = requests.get(f'{API_BASE_URL}/self', headers=headers, timeout=10)
                        api_response_time2 = round((time.time() - test_start2) * 1000, 2)
                        
                        if response2.status_code == 200:
                            health_data['api_tests']['E-conomic Authentication'] = {
                                'status': 'pass',
                                'message': 'E-conomic API authentication successful (verified with /self endpoint)',
                                'response_time': api_response_time2
                            }
                            health_data['checks']['E-conomic API Access'] = {
                                'status': 'pass',
                                'message': 'API authentication working correctly'
                            }
                        else:
                            health_data['api_tests']['E-conomic Authentication'] = {
                                'status': 'warning',
                                'message': f'E-conomic API returned status {response.status_code} (invoices), {response2.status_code} (self)',
                                'response_time': api_response_time
                            }
                            health_data['checks']['E-conomic API Access'] = {
                                'status': 'warning',
                                'message': f'API responded but with unexpected status codes - may be normal'
                            }
                    except:
                        health_data['api_tests']['E-conomic Authentication'] = {
                            'status': 'warning',
                            'message': f'E-conomic API returned status {response.status_code}',
                            'response_time': api_response_time
                        }
                        health_data['checks']['E-conomic API Access'] = {
                            'status': 'warning',
                            'message': f'API returned status {response.status_code} - check if this is expected'
                        }
            else:
                health_data['api_tests']['E-conomic Authentication'] = {
                    'status': 'warning',
                    'message': 'No active agreement tokens found for testing'
                }
                health_data['checks']['E-conomic API Access'] = {
                    'status': 'warning',
                    'message': 'Cannot test API - no agreement tokens configured'
                }
        else:
            health_data['api_tests']['E-conomic Authentication'] = {
                'status': 'fail',
                'message': 'No APP_SECRET_TOKEN configured'
            }
            health_data['checks']['E-conomic API Access'] = {
                'status': 'fail',
                'message': 'APP_SECRET_TOKEN not configured'
            }
            if health_data['overall_status'] == 'healthy':
                health_data['overall_status'] = 'warning'
            
    except Exception as e:
        health_data['api_tests']['E-conomic Authentication'] = {
            'status': 'warning',
            'message': f'E-conomic API test failed: {str(e)}'
        }
        health_data['checks']['E-conomic API Access'] = {
            'status': 'warning',
            'message': f'API test error: {str(e)}'
        }
        if health_data['overall_status'] == 'healthy':
            health_data['overall_status'] = 'warning'
    
    # 4. File System Health Checks
    try:
        # Check logs directory
        if os.path.exists('logs'):
            log_files = [f for f in os.listdir('logs') if f.endswith('.log')]
            health_data['checks']['Log Files'] = {
                'status': 'pass',
                'message': f'Found {len(log_files)} log files',
                'details': f'Latest logs available in logs/ directory'
            }
        else:
            health_data['checks']['Log Files'] = {
                'status': 'warning',
                'message': 'Logs directory not found'
            }
            
        # Check downloads directory
        if os.path.exists('downloads'):
            health_data['checks']['Downloads Directory'] = {
                'status': 'pass',
                'message': 'Downloads directory accessible'
            }
        else:
            health_data['checks']['Downloads Directory'] = {
                'status': 'warning',
                'message': 'Downloads directory not found'
            }
            
    except Exception as e:
        health_data['checks']['File System'] = {
            'status': 'fail',
            'message': f'File system check failed: {str(e)}'
        }
    
    # Calculate overall health status with explanations
    critical_errors = []
    warnings = []
    
    # Collect errors and warnings
    for name, check in health_data['checks'].items():
        if check['status'] == 'fail':
            critical_errors.append(f"{name}: {check['message']}")
        elif check['status'] == 'warning':
            warnings.append(f"{name}: {check['message']}")
    
    # Set overall status explanation
    if critical_errors:
        health_data['overall_status'] = 'error'
        health_data['status_explanation'] = f"Critical issues found: {'; '.join(critical_errors)}"
    elif warnings:
        if health_data['overall_status'] != 'error':  # Don't override error status
            health_data['overall_status'] = 'warning' 
        health_data['status_explanation'] = f"Warnings found: {'; '.join(warnings)}"
    else:
        if health_data['overall_status'] not in ['error', 'warning']:  # Don't override existing status
            health_data['overall_status'] = 'healthy'
        health_data['status_explanation'] = "All systems operational"
    
    # Calculate total response time
    total_time = round((time.time() - start_time) * 1000, 2)
    health_data['response_time_ms'] = total_time
    
    return jsonify(health_data)

@app.route('/static/<path:filename>')
def serve_static(filename):
    """Serve static files like images"""
    return send_from_directory('static', filename)

@app.route('/add-token', methods=['POST'])
def add_agreement_token():
    """Add a new agreement token via the health dashboard"""
    try:
        data = request.get_json()
        token = data.get('token', '').strip()
        
        if not token:
            return jsonify({'error': 'Token is required'}), 400
        
        # Call the main API to register the token
        try:
            response = requests.post(
                f'{MAIN_API_URL}/api/agreements/register-token',
                json={'token': token},
                headers={'Content-Type': 'application/json'},
                timeout=10
            )
            
            if response.status_code == 201:
                result = response.json()
                return jsonify({
                    'success': True,
                    'message': f'Agreement token registered successfully',
                    'agreement': result
                })
            else:
                error_data = response.json() if response.headers.get('content-type') == 'application/json' else {}
                return jsonify({
                    'success': False,
                    'error': error_data.get('error', {}).get('message', f'HTTP {response.status_code}')
                }), response.status_code
                
        except requests.exceptions.ConnectionError:
            return jsonify({
                'success': False,
                'error': 'Cannot connect to main API service (port 3000)'
            }), 500
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'Error registering token: {str(e)}'
            }), 500
            
    except Exception as e:
        logger.error(f"Error in add_agreement_token: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    logger.info("Starting Economic Data Management Center...")
    logger.info("Enhanced dashboard available at: http://localhost:5000")
    logger.info("Features:")
    logger.info("  - CSV file sync operations")
    logger.info("  - E-conomic API sync monitoring")
    logger.info("  - Unified error tracking")
    logger.info("  - Real-time status updates")
    app.run(host='0.0.0.0', port=5000)