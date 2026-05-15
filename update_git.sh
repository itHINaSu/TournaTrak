#!/bin/bash

# Prompt for commit message
read -p "Enter commit message: " commit_message

# Prompt for branch name, default to main
read -p "Enter branch name (default: dev): " branch_name
branch_name=${branch_name:-dev}

# Run git commands
git add .

git commit -m "$commit_message"

git push origin "$branch_name"
