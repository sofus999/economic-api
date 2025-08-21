#!/usr/bin/env python3
"""
sharepoint_graph_client.py

Microsoft Graph API-based SharePoint client for downloading CSV files.
This client uses Graph API instead of SharePoint REST API to bypass organization restrictions.

Based on working PowerShell script that successfully authenticates and accesses SharePoint.
"""

import os
import logging
import requests
from datetime import datetime
from typing import List, Optional, Dict
import json

logger = logging.getLogger(__name__)

class SharePointGraphClient:
    """
    SharePoint client using Microsoft Graph API
    """
    
    def __init__(self, tenant_id: str, client_id: str, client_secret: str, 
                 site_host: str, site_path: str):
        """
        Initialize SharePoint Graph API client
        
        Args:
            tenant_id: Azure AD tenant ID
            client_id: Azure AD app registration client ID  
            client_secret: Azure AD app registration client secret
            site_host: SharePoint site host (e.g., squaremeterdk.sharepoint.com)
            site_path: SharePoint site path (e.g., sites/PowerBI)
        """
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.client_secret = client_secret
        self.site_host = site_host
        self.site_path = site_path
        self.access_token = None
        self.site_id = None
        self.drive_id = None
        
        logger.info(f"Initializing SharePoint Graph client for {site_host}/{site_path}")
    
    def get_access_token(self) -> bool:
        """
        Get access token using client credentials flow
        
        Returns:
            bool: True if token acquired successfully, False otherwise
        """
        try:
            token_url = f"https://login.microsoftonline.com/{self.tenant_id}/oauth2/v2.0/token"
            
            token_data = {
                'client_id': self.client_id,
                'scope': 'https://graph.microsoft.com/.default',
                'client_secret': self.client_secret,
                'grant_type': 'client_credentials'
            }
            
            response = requests.post(token_url, data=token_data)
            response.raise_for_status()
            
            token_info = response.json()
            self.access_token = token_info.get('access_token')
            
            logger.info("Successfully acquired Graph API access token")
            return True
            
        except Exception as e:
            logger.error(f"Failed to acquire access token: {str(e)}")
            return False
    
    def get_site_info(self) -> bool:
        """
        Get SharePoint site information and site ID
        
        Returns:
            bool: True if site info retrieved successfully, False otherwise
        """
        if not self.access_token:
            if not self.get_access_token():
                return False
        
        try:
            headers = {'Authorization': f'Bearer {self.access_token}'}
            
            # Get site ID using the same format as PowerShell script
            site_url = f"https://graph.microsoft.com/v1.0/sites/{self.site_host}:/{self.site_path}"
            
            response = requests.get(site_url, headers=headers)
            response.raise_for_status()
            
            site_info = response.json()
            self.site_id = site_info.get('id')
            
            logger.info(f"Successfully retrieved site info: {site_info.get('displayName', 'Unknown')}")
            logger.info(f"Site ID: {self.site_id}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to get site info: {str(e)}")
            return False
    
    def get_drive_info(self) -> bool:
        """
        Get Documents drive information
        
        Returns:
            bool: True if drive info retrieved successfully, False otherwise
        """
        if not self.site_id:
            if not self.get_site_info():
                return False
        
        try:
            headers = {'Authorization': f'Bearer {self.access_token}'}
            
            # Get drives for the site
            drives_url = f"https://graph.microsoft.com/v1.0/sites/{self.site_id}/drives"
            
            response = requests.get(drives_url, headers=headers)
            response.raise_for_status()
            
            drives_info = response.json()
            
            # Find the Documents drive
            for drive in drives_info.get('value', []):
                if drive.get('name') == 'Documents':
                    self.drive_id = drive.get('id')
                    logger.info(f"Found Documents drive: {self.drive_id}")
                    return True
            
            logger.error("Documents drive not found")
            return False
            
        except Exception as e:
            logger.error(f"Failed to get drive info: {str(e)}")
            return False
    
    def list_folder_contents(self, folder_path: str) -> List[Dict]:
        """
        List contents of a folder using Graph API
        
        Args:
            folder_path: Folder path relative to Documents (e.g., "Economics/Account Mappings")
            
        Returns:
            List[Dict]: List of file/folder information
        """
        if not self.drive_id:
            if not self.get_drive_info():
                return []
        
        try:
            headers = {'Authorization': f'Bearer {self.access_token}'}
            
            # Use Graph API to list folder contents
            folder_url = f"https://graph.microsoft.com/v1.0/drives/{self.drive_id}/root:/{folder_path}:/children"
            
            response = requests.get(folder_url, headers=headers)
            response.raise_for_status()
            
            folder_contents = response.json()
            files = folder_contents.get('value', [])
            
            logger.info(f"Found {len(files)} items in folder: {folder_path}")
            
            return files
            
        except Exception as e:
            logger.error(f"Failed to list folder contents for {folder_path}: {str(e)}")
            return []
    
    def download_file(self, file_item: Dict, local_dir: str) -> bool:
        """
        Download a file from SharePoint
        
        Args:
            file_item: File information from Graph API
            local_dir: Local directory to save the file
            
        Returns:
            bool: True if download successful, False otherwise
        """
        try:
            # Ensure local directory exists
            os.makedirs(local_dir, exist_ok=True)
            
            file_name = file_item.get('name')
            download_url = file_item.get('@microsoft.graph.downloadUrl')
            
            if not download_url:
                logger.error(f"No download URL for file: {file_name}")
                return False
            
            # Download the file
            response = requests.get(download_url)
            response.raise_for_status()
            
            local_path = os.path.join(local_dir, file_name)
            
            with open(local_path, 'wb') as local_file:
                local_file.write(response.content)
            
            logger.info(f"Downloaded: {file_name} to {local_path}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to download file {file_item.get('name', 'Unknown')}: {str(e)}")
            return False
    
    def download_csv_files(self, folder_path: str, local_dir: str) -> List[str]:
        """
        Download all CSV files from a SharePoint folder
        
        Args:
            folder_path: Folder path relative to Documents (e.g., "Economics/Account Mappings")
            local_dir: Local directory to save files
            
        Returns:
            List[str]: List of downloaded file names
        """
        try:
            files = self.list_folder_contents(folder_path)
            
            # Filter for CSV files
            csv_files = [f for f in files if f.get('name', '').lower().endswith('.csv')]
            logger.info(f"Found {len(csv_files)} CSV files in {folder_path}")
            
            downloaded_files = []
            
            for file_item in csv_files:
                if self.download_file(file_item, local_dir):
                    downloaded_files.append(file_item.get('name'))
            
            logger.info(f"Downloaded {len(downloaded_files)} CSV files to {local_dir}")
            return downloaded_files
            
        except Exception as e:
            logger.error(f"Error downloading CSV files from {folder_path}: {str(e)}")
            return []

# Helper functions for integration with existing code

def create_graph_client_from_env() -> SharePointGraphClient:
    """
    Create SharePoint Graph client from environment variables
    
    Returns:
        SharePointGraphClient: Configured client instance
    """
    tenant_id = os.getenv('SHAREPOINT_TENANT_ID')
    client_id = os.getenv('SHAREPOINT_CLIENT_ID')
    client_secret = os.getenv('SHAREPOINT_CLIENT_SECRET')
    site_host = os.getenv('SHAREPOINT_SITE_HOST')
    site_path = os.getenv('SHAREPOINT_SITE_PATH')
    
    if not all([tenant_id, client_id, client_secret, site_host, site_path]):
        raise ValueError("Missing required environment variables for Graph client")
    
    return SharePointGraphClient(tenant_id, client_id, client_secret, site_host, site_path)

def download_squaremeter_files_graph() -> dict:
    """
    Download CSV files from Squaremeter SharePoint using Graph API
    
    Returns:
        dict: Results with file lists and status
    """
    try:
        client = create_graph_client_from_env()
        
        results = {
            'success': True,
            'error': None,
            'account_files': [],
            'budget_files': []
        }
        
        # Download account mapping files
        try:
            logger.info("Downloading account mapping files...")
            economics_path = os.getenv('SHAREPOINT_ECONOMICS_GRAPH_PATH', 'Economics/Account Mappings')
            local_economics_dir = os.path.join(
                os.getenv('SHAREPOINT_DOWNLOAD_DIR', './downloads/sharepoint'), 
                'economics'
            )
            
            account_files = client.download_csv_files(economics_path, local_economics_dir)
            
            # Filter for account mapping files specifically  
            mapping_files = [f for f in account_files if 
                           'mapping' in f.lower() or 'account' in f.lower()]
            
            results['account_files'] = mapping_files
            logger.info(f"Downloaded {len(mapping_files)} account mapping files")
            
        except Exception as e:
            logger.error(f"Failed to download account files: {str(e)}")
            results['account_error'] = str(e)
        
        # Download budget files
        try:
            logger.info("Downloading budget files...")
            budget_path = os.getenv('SHAREPOINT_BUDGET_GRAPH_PATH', 'Economics/Budget')
            local_budget_dir = os.path.join(
                os.getenv('SHAREPOINT_DOWNLOAD_DIR', './downloads/sharepoint'),
                'budget'
            )
            
            budget_files = client.download_csv_files(budget_path, local_budget_dir)
            results['budget_files'] = budget_files
            
        except Exception as e:
            logger.error(f"Failed to download budget files: {str(e)}")
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

if __name__ == "__main__":
    # Test the Graph client
    logging.basicConfig(level=logging.INFO)
    
    print("SharePoint Graph API Client Test")
    print("=" * 50)
    
    try:
        # Load environment variables
        from dotenv import load_dotenv
        load_dotenv('sharepoint.env')
        
        # Test the download function
        result = download_squaremeter_files_graph()
        
        print(f"Success: {result.get('success', False)}")
        if result.get('error'):
            print(f"Error: {result['error']}")
        
        print(f"Account files: {result.get('account_files', [])}")
        print(f"Budget files: {result.get('budget_files', [])}")
        
    except Exception as e:
        print(f"Test failed: {e}")
        import traceback
        traceback.print_exc() 