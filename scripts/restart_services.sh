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