#!/bin/bash

# Daily sync trigger script
# This script calls the Python API wrapper for economic sync

echo "$(date): Starting daily economic sync via Python API wrapper..."

# Call the Python API with appropriate timeout (2 hours)
curl -X POST \
     --max-time 7200 \
     --connect-timeout 30 \
     --retry 3 \
     --retry-delay 60 \
     -H "Content-Type: application/json" \
     http://localhost:5000/sync-economic-daily

exit_code=$?

if [ $exit_code -eq 0 ]; then
    echo "$(date): Daily sync API call completed successfully"
else
    echo "$(date): Daily sync API call failed with exit code $exit_code"
fi

exit $exit_code 