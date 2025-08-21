#!/usr/bin/env python3
"""
sharepoint_client.py

SharePoint integration module for downloading CSV files.
This module provides functionality to:
- Connect to SharePoint using user credentials or app registration
- Download CSV files from specified folders
- Handle authentication and error cases

Requirements:
    pip install Office365-REST-Python-Client

Usage:
    from sharepoint_client import SharePointClient
    
    # Using username/password
    client = SharePointClient(
        site_url="https://squaremeterdk.sharepoint.com/sites/PowerBI",
        username="user@company.com",
        password="password"
    )
    
    # Using app registration
    client = SharePointClient(
        site_url="https://squaremeterdk.sharepoint.com/sites/PowerBI",
        client_id="your-app-id",
        client_secret="your-secret"
    )
    
    files = client.download_csv_files(
        folder_path="/sites/PowerBI/Documents/Economics",
        local_dir="./downloads"
    )
"""

import os
import logging
from datetime import datetime
from typing import List, Optional

try:
    from office365.sharepoint.client_context import ClientContext
    from office365.runtime.auth.client_credential import ClientCredential
    from office365.runtime.auth.user_credential import UserCredential
    SHAREPOINT_AVAILABLE = True
except ImportError:
    SHAREPOINT_AVAILABLE = False

logger = logging.getLogger(__name__)

class SharePointClient:
    """
    SharePoint client for downloading CSV files
    """
    
    def __init__(self, site_url: str, username: str = None, password: str = None, 
                 client_id: str = None, client_secret: str = None):
        """
        Initialize SharePoint client
        
        Args:
            site_url: SharePoint site URL (e.g., https://squaremeterdk.sharepoint.com/sites/PowerBI)
            username: SharePoint username (alternative to app registration)
            password: SharePoint password (alternative to app registration)
            client_id: Azure AD app registration client ID (alternative to username/password)
            client_secret: Azure AD app registration client secret (alternative to username/password)
        """
        if not SHAREPOINT_AVAILABLE:
            raise ImportError(
                "Office365-REST-Python-Client is not installed. "
                "Install it with: pip install Office365-REST-Python-Client"
            )
        
        self.site_url = site_url
        self.username = username
        self.password = password
        self.client_id = client_id
        self.client_secret = client_secret
        self.ctx = None
        
        # Validate authentication method
        if not ((username and password) or (client_id and client_secret)):
            raise ValueError("Must provide either username/password OR client_id/client_secret")
        
        logger.info(f"Initializing SharePoint client for {site_url}")
    
    def connect(self) -> bool:
        """
        Establish connection to SharePoint
        
        Returns:
            bool: True if connection successful, False otherwise
        """
        try:
            if self.username and self.password:
                # User credential authentication
                credentials = UserCredential(self.username, self.password)
                logger.info(f"Connecting with username: {self.username}")
            else:
                # App registration authentication
                credentials = ClientCredential(self.client_id, self.client_secret)
                logger.info("Connecting with app registration")
            
            self.ctx = ClientContext(self.site_url).with_credentials(credentials)
            
            # Test the connection by getting web info
            web = self.ctx.web
            self.ctx.load(web)
            self.ctx.execute_query()
            
            logger.info(f"Successfully connected to SharePoint site: {web.title}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to SharePoint: {str(e)}")
            self.ctx = None
            return False
    
    def download_csv_files(self, folder_path: str, local_dir: str = "./downloads") -> List[str]:
        """
        Download all CSV files from a SharePoint folder
        
        Args:
            folder_path: SharePoint folder path (e.g., "/sites/PowerBI/Documents/Economics")
            local_dir: Local directory to save files
            
        Returns:
            List[str]: List of downloaded file names
        """
        if not self.ctx:
            if not self.connect():
                raise Exception("Could not establish SharePoint connection")
        
        try:
            # Ensure local directory exists
            os.makedirs(local_dir, exist_ok=True)
            
            # Get the folder
            logger.info(f"Accessing SharePoint folder: {folder_path}")
            folder = self.ctx.web.get_folder_by_server_relative_url(folder_path)
            files = folder.files
            self.ctx.load(files)
            self.ctx.execute_query()
            
            # Log all files found
            all_files = [file.name for file in files]
            logger.info(f"Found {len(all_files)} total files in {folder_path}: {all_files}")
            
            # Filter CSV files
            csv_files = [file.name for file in files if file.name.lower().endswith('.csv')]
            logger.info(f"Found {len(csv_files)} CSV files: {csv_files}")
            
            downloaded_files = []
            
            for file in files:
                if file.name.lower().endswith('.csv'):
                    try:
                        local_path = os.path.join(local_dir, file.name)
                        
                        # Download the file
                        with open(local_path, 'wb') as local_file:
                            file.download(local_file)
                            self.ctx.execute_query()
                        
                        downloaded_files.append(file.name)
                        logger.info(f"Downloaded: {file.name}")
                        
                    except Exception as e:
                        logger.error(f"Failed to download {file.name}: {str(e)}")
            
            logger.info(f"Downloaded {len(downloaded_files)} CSV files to {local_dir}")
            return downloaded_files
            
        except Exception as e:
            logger.error(f"Error downloading files from {folder_path}: {str(e)}")
            raise
    
    def list_files(self, folder_path: str) -> List[dict]:
        """
        List all files in a SharePoint folder
        
        Args:
            folder_path: SharePoint folder path
            
        Returns:
            List[dict]: List of file information
        """
        if not self.ctx:
            if not self.connect():
                raise Exception("Could not establish SharePoint connection")
        
        try:
            folder = self.ctx.web.get_folder_by_server_relative_url(folder_path)
            files = folder.files
            self.ctx.load(files)
            self.ctx.execute_query()
            
            file_list = []
            for file in files:
                self.ctx.load(file, ["Name", "Length", "TimeLastModified"])
                self.ctx.execute_query()
                
                file_info = {
                    'name': file.name,
                    'size': file.length,
                    'modified': file.time_last_modified.isoformat() if file.time_last_modified else None,
                    'is_csv': file.name.lower().endswith('.csv')
                }
                file_list.append(file_info)
            
            return file_list
            
        except Exception as e:
            logger.error(f"Error listing files in {folder_path}: {str(e)}")
            raise
    
    def download_specific_file(self, file_path: str, local_path: str) -> bool:
        """
        Download a specific file from SharePoint
        
        Args:
            file_path: Full SharePoint file path
            local_path: Local file path to save to
            
        Returns:
            bool: True if successful, False otherwise
        """
        if not self.ctx:
            if not self.connect():
                return False
        
        try:
            # Ensure local directory exists
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            
            # Get the file
            file = self.ctx.web.get_file_by_server_relative_url(file_path)
            
            # Download the file
            with open(local_path, 'wb') as local_file:
                file.download(local_file)
                self.ctx.execute_query()
            
            logger.info(f"Downloaded file: {file_path} -> {local_path}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to download {file_path}: {str(e)}")
            return False

# Specific configuration for Squaremeter SharePoint
SQUAREMETER_CONFIG = {
    'site_url': 'https://squaremeterdk.sharepoint.com/sites/PowerBI',
    'economics_folder': '/sites/PowerBI/Documents/Economics/Account Mappings',
    'budget_folder': '/sites/PowerBI/Documents/Economics/Budget',
    'download_dir': './downloads/sharepoint'
}

def create_squaremeter_client(username: str, password: str) -> SharePointClient:
    """
    Create a SharePoint client configured for Squaremeter
    
    Args:
        username: SharePoint username (e.g., SL@squaremeter.dk)
        password: SharePoint password
        
    Returns:
        SharePointClient: Configured client instance
    """
    return SharePointClient(
        site_url=SQUAREMETER_CONFIG['site_url'],
        username=username,
        password=password
    )

def download_squaremeter_files_graph() -> dict:
    """
    Download CSV files from Squaremeter SharePoint using Graph API
    This is a fallback method when the traditional SharePoint REST API is blocked
    
    Returns:
        dict: Results with file lists and status
    """
    try:
        import requests
        
        # Get configuration from environment
        tenant_id = os.getenv('SHAREPOINT_TENANT_ID')
        client_id = os.getenv('SHAREPOINT_CLIENT_ID')
        client_secret = os.getenv('SHAREPOINT_CLIENT_SECRET')
        site_host = os.getenv('SHAREPOINT_SITE_HOST', 'squaremeterdk.sharepoint.com')
        site_path = os.getenv('SHAREPOINT_SITE_PATH', 'sites/PowerBI')
        
        if not all([tenant_id, client_id, client_secret]):
            raise ValueError("Missing Graph API configuration. Need SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET")
        
        logger.info("Using Graph API method for SharePoint access")
        
        # Step 1: Get access token
        token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        token_data = {
            'client_id': client_id,
            'scope': 'https://graph.microsoft.com/.default',
            'client_secret': client_secret,
            'grant_type': 'client_credentials'
        }
        
        token_response = requests.post(token_url, data=token_data)
        token_response.raise_for_status()
        access_token = token_response.json().get('access_token')
        
        headers = {'Authorization': f'Bearer {access_token}'}
        
        # Step 2: Get site ID
        site_url = f"https://graph.microsoft.com/v1.0/sites/{site_host}:/{site_path}"
        site_response = requests.get(site_url, headers=headers)
        site_response.raise_for_status()
        site_id = site_response.json().get('id')
        
        # Step 3: Get drive ID (Documents library)
        drives_url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives"
        drives_response = requests.get(drives_url, headers=headers)
        drives_response.raise_for_status()
        
        drive_id = None
        for drive in drives_response.json().get('value', []):
            if drive.get('name') == 'Documents':
                drive_id = drive.get('id')
                break
        
        if not drive_id:
            raise Exception("Documents drive not found")
        
        results = {
            'success': True,
            'error': None,
            'account_files': [],
            'budget_files': []
        }
        
        # Step 4: Download account mapping files
        try:
            economics_path = os.getenv('SHAREPOINT_ECONOMICS_GRAPH_PATH', 'Economics/Account Mappings')
            local_economics_dir = os.path.join(
                os.getenv('SHAREPOINT_DOWNLOAD_DIR', './downloads/sharepoint'), 
                'economics'
            )
            
            # List files in Economics/Account Mappings
            folder_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{economics_path}:/children"
            folder_response = requests.get(folder_url, headers=headers)
            folder_response.raise_for_status()
            
            files = folder_response.json().get('value', [])
            csv_files = [f for f in files if f.get('name', '').lower().endswith('.csv')]
            
            # Ensure local directory exists
            os.makedirs(local_economics_dir, exist_ok=True)
            
            downloaded_account_files = []
            for file_item in csv_files:
                file_name = file_item.get('name')
                download_url = file_item.get('@microsoft.graph.downloadUrl')
                
                if download_url:
                    file_response = requests.get(download_url)
                    file_response.raise_for_status()
                    
                    local_path = os.path.join(local_economics_dir, file_name)
                    with open(local_path, 'wb') as local_file:
                        local_file.write(file_response.content)
                    
                    downloaded_account_files.append(file_name)
                    logger.info(f"Downloaded: {file_name}")
            
            # Filter for account mapping files specifically
            mapping_files = [f for f in downloaded_account_files if 
                           'mapping' in f.lower() or 'account' in f.lower()]
            
            results['account_files'] = mapping_files
            logger.info(f"Downloaded {len(mapping_files)} account mapping files")
            
        except Exception as e:
            logger.error(f"Failed to download account files via Graph API: {str(e)}")
            results['account_error'] = str(e)
        
        # Step 5: Download budget files
        try:
            budget_path = os.getenv('SHAREPOINT_BUDGET_GRAPH_PATH', 'Economics/Budget')
            local_budget_dir = os.path.join(
                os.getenv('SHAREPOINT_DOWNLOAD_DIR', './downloads/sharepoint'),
                'budget'
            )
            
            # List files in Economics/Budget
            folder_url = f"https://graph.microsoft.com/v1.0/drives/{drive_id}/root:/{budget_path}:/children"
            folder_response = requests.get(folder_url, headers=headers)
            folder_response.raise_for_status()
            
            files = folder_response.json().get('value', [])
            csv_files = [f for f in files if f.get('name', '').lower().endswith('.csv')]
            
            # Ensure local directory exists
            os.makedirs(local_budget_dir, exist_ok=True)
            
            downloaded_budget_files = []
            for file_item in csv_files:
                file_name = file_item.get('name')
                download_url = file_item.get('@microsoft.graph.downloadUrl')
                
                if download_url:
                    file_response = requests.get(download_url)
                    file_response.raise_for_status()
                    
                    local_path = os.path.join(local_budget_dir, file_name)
                    with open(local_path, 'wb') as local_file:
                        local_file.write(file_response.content)
                    
                    downloaded_budget_files.append(file_name)
                    logger.info(f"Downloaded: {file_name}")
            
            results['budget_files'] = downloaded_budget_files
            
        except Exception as e:
            logger.error(f"Failed to download budget files via Graph API: {str(e)}")
            results['budget_error'] = str(e)
        
        return results
        
    except Exception as e:
        logger.error(f"Error in download_squaremeter_files_graph: {str(e)}")
        return {
            'success': False,
            'error': str(e),
            'account_files': [],
            'budget_files': []
        }

def download_squaremeter_files(username: str = None, password: str = None) -> dict:
    """
    Download CSV files from Squaremeter SharePoint
    
    Tries multiple methods:
    1. Graph API (if tenant_id is available)
    2. Traditional username/password method
    
    Args:
        username: SharePoint username (optional if using Graph API)
        password: SharePoint password (optional if using Graph API)
        
    Returns:
        dict: Results with file lists and status
    """
    # Try Graph API first if tenant_id is available
    tenant_id = os.getenv('SHAREPOINT_TENANT_ID')
    if tenant_id:
        logger.info("Attempting SharePoint access via Graph API...")
        try:
            result = download_squaremeter_files_graph()
            if result.get('success'):
                logger.info("Graph API method successful")
                return result
            else:
                logger.warning(f"Graph API method failed: {result.get('error')}")
        except Exception as e:
            logger.warning(f"Graph API method failed: {str(e)}")
    
    # Fallback to traditional method if Graph API fails or not configured
    if username and password:
        logger.info("Falling back to traditional SharePoint REST API...")
        return download_squaremeter_files_original(username, password)
    else:
        logger.error("No valid authentication method available")
        return {
            'success': False,
            'error': 'No valid authentication method. Need either SHAREPOINT_TENANT_ID for Graph API or username/password.',
            'account_files': [],
            'budget_files': []
        }

def download_squaremeter_files_original(username: str, password: str) -> dict:
    """
    Original download function using SharePoint REST API
    
    Args:
        username: SharePoint username (e.g., SL@squaremeter.dk)
        password: SharePoint password
        
    Returns:
        dict: Results with file lists and status
    """
    try:
        client = create_squaremeter_client(username, password)
        
        # Test connection
        if not client.connect():
            return {
                'success': False,
                'error': 'Failed to connect to SharePoint',
                'account_files': [],
                'budget_files': []
            }
        
        results = {
            'success': True,
            'error': None,
            'account_files': [],
            'budget_files': []
        }
        
        try:
            # Download account mapping files from Economics folder
            logger.info("Downloading account mapping files from Economics folder...")
            account_files = client.download_csv_files(
                folder_path=SQUAREMETER_CONFIG['economics_folder'],
                local_dir=os.path.join(SQUAREMETER_CONFIG['download_dir'], 'economics')
            )
            
            # Filter for account mapping files specifically
            mapping_files = [f for f in account_files if 
                           'mapping' in f.lower() or 'account' in f.lower()]
            
            results['account_files'] = mapping_files
            logger.info(f"Found {len(mapping_files)} account mapping files out of {len(account_files)} total CSV files")
            
        except Exception as e:
            logger.error(f"Failed to download account files: {str(e)}")
            results['account_error'] = str(e)
        
        try:
            # Download budget files from Budget subfolder
            logger.info("Downloading budget files from Budget folder...")
            budget_files = client.download_csv_files(
                folder_path=SQUAREMETER_CONFIG['budget_folder'],
                local_dir=os.path.join(SQUAREMETER_CONFIG['download_dir'], 'budget')
            )
            results['budget_files'] = budget_files
            
        except Exception as e:
            logger.error(f"Failed to download budget files: {str(e)}")
            results['budget_error'] = str(e)
        
        return results
        
    except Exception as e:
        logger.error(f"Error in download_squaremeter_files_original: {str(e)}")
        return {
            'success': False,
            'error': str(e),
            'account_files': [],
            'budget_files': []
        }

def download_from_sharepoint_config():
    """
    Download files using environment configuration
    
    Environment variables needed:
    - SHAREPOINT_SITE_URL
    - SHAREPOINT_CLIENT_ID  
    - SHAREPOINT_CLIENT_SECRET
    - SHAREPOINT_FOLDER_PATH (optional, defaults to "/Shared Documents/EconomicData")
    - DOWNLOAD_DIR (optional, defaults to current directory)
    """
    
    # Check if SharePoint is available
    if not SHAREPOINT_AVAILABLE:
        logger.warning("SharePoint client not available. Install Office365-REST-Python-Client to enable.")
        return []
    
    # Get configuration from environment
    site_url = os.getenv('SHAREPOINT_SITE_URL')
    client_id = os.getenv('SHAREPOINT_CLIENT_ID')
    client_secret = os.getenv('SHAREPOINT_CLIENT_SECRET')
    folder_path = os.getenv('SHAREPOINT_FOLDER_PATH', '/Shared Documents/EconomicData')
    download_dir = os.getenv('DOWNLOAD_DIR', '.')
    
    # Validate configuration
    if not all([site_url, client_id, client_secret]):
        logger.error("SharePoint configuration missing. Please set environment variables:")
        logger.error("- SHAREPOINT_SITE_URL")
        logger.error("- SHAREPOINT_CLIENT_ID")
        logger.error("- SHAREPOINT_CLIENT_SECRET")
        return []
    
    try:
        # Create client and download files
        client = SharePointClient(site_url, client_id, client_secret)
        downloaded_files = client.download_csv_files(folder_path, download_dir)
        
        logger.info(f"SharePoint sync completed. Downloaded {len(downloaded_files)} files.")
        return downloaded_files
        
    except Exception as e:
        logger.error(f"SharePoint download failed: {str(e)}")
        return []

if __name__ == "__main__":
    # Test the SharePoint client
    logging.basicConfig(level=logging.INFO)
    
    print("SharePoint Client Test")
    print("=" * 50)
    
    if not SHAREPOINT_AVAILABLE:
        print("❌ Office365-REST-Python-Client not installed")
        print("Install with: pip install Office365-REST-Python-Client")
        exit(1)
    
    # Try to download from environment config
    files = download_from_sharepoint_config()
    
    if files:
        print(f"✅ Downloaded {len(files)} files:")
        for file in files:
            print(f"   - {file}")
    else:
        print("❌ No files downloaded or SharePoint not configured")
        print("\nTo configure SharePoint, set these environment variables:")
        print("- SHAREPOINT_SITE_URL=https://yourcompany.sharepoint.com/sites/data")
        print("- SHAREPOINT_CLIENT_ID=your-app-id")
        print("- SHAREPOINT_CLIENT_SECRET=your-secret") 