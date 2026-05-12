#!/bin/bash
# Fix read permissions for files served by nginx in ~/tournament/frontend

chmod -R o+r ~/tournament/frontend
chmod o+x ~/tournament/frontend

echo "Permissions updated."
