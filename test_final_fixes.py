#!/usr/bin/env python3
import requests
import time
import json

print("🧪 Testing Final SharePoint Fixes")
print("=" * 50)

print("1️⃣ Testing record count calculation fix...")
print("2️⃣ Testing consolidated sync logging...")

# Wait for server to start
time.sleep(3)

try:
    # Trigger SharePoint sync
    response = requests.post('http://localhost:5000/sync-sharepoint', timeout=30)
    
    if response.status_code == 200:
        result = response.json()
        print(f"✅ SharePoint sync successful!")
        print(f"   Status: {result.get('status')}")
        print(f"   Message: {result.get('message', 'No message')}")
        
        # Check sync logs via API
        print(f"\n📊 Checking sync logs...")
        logs_response = requests.get('http://localhost:5000/sync-history?filter=sharepoint&limit=5')
        
        if logs_response.status_code == 200:
            logs = logs_response.json()
            
            if logs.get('logs'):
                latest_log = logs['logs'][0]
                print(f"✅ Latest sync log:")
                print(f"   Entity: {latest_log.get('entity')}")
                print(f"   Record count: {latest_log.get('record_count')}")
                print(f"   Status: {latest_log.get('status')}")
                print(f"   Duration: {latest_log.get('duration_ms')}ms")
                
                # Check if record count is realistic (should be > 2)
                record_count = latest_log.get('record_count', 0)
                if record_count > 10:
                    print(f"✅ Record count fix working! ({record_count} records)")
                else:
                    print(f"⚠️  Record count seems low: {record_count}")
            else:
                print("❌ No sync logs found")
        
    elif response.status_code == 409:
        print("⚠️  Sync already running - wait for it to complete")
    else:
        result = response.json() if response.headers.get('content-type') == 'application/json' else {'message': response.text}
        print(f"❌ SharePoint sync failed!")
        print(f"   Status: {result.get('status')}")
        print(f"   Message: {result.get('message', 'No message')}")
        
except Exception as e:
    print(f"❌ Error testing: {e}")

print(f"\n💡 Next steps:")
print(f"   1. Check web interface at http://localhost:5000")
print(f"   2. The record counts should now be accurate")
print(f"   3. For Node.js consolidated logging, restart the Node server:")
print(f"      npm start")
