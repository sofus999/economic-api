#!/bin/bash
echo "=== Economic Data Management System Status ==="
echo

echo "System Services:"
echo "- MySQL: $(systemctl is-active mysql) ($(systemctl is-enabled mysql))"
echo "- Nginx: $(systemctl is-active nginx) ($(systemctl is-enabled nginx))"
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