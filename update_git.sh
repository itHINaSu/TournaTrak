#!/bin/bash

# Prompt for commit message
read -p "Enter commit message: " commit_message

# Prompt for branch name, default to main
read -p "Enter branch name (default: main): " branch_name
branch_name=${branch_name:-main}

# Run git commands
git add .

git commit -m "$commit_message"

git push origin "$branch_name"
