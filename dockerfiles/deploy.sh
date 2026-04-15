#!/bin/bash

# Ensure the script is executable
chmod +x "$0"

echo "Stopping and removing all Docker containers..."
docker-compose down --volumes --remove-orphans

echo "Building fresh Docker images..."
docker-compose build --no-cache

echo "Starting up containers..."
docker-compose up -d

echo "Deployment complete! Following logs..."
docker-compose logs -f backend worker

