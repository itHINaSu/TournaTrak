#!/bin/bash
# Fix read permissions for files served by nginx in ~/tournament/frontend

chmod -R o+r ~/TournaTrak_dev/frontend
chmod o+x ~/TournaTrak_dev/frontend

echo "Permissions updated."
