#!/usr/bin/env bash

PORT="${1:-3399}"

echo "Checking port $PORT..."
lsof -i :"$PORT" || echo "Port $PORT appears free"

echo
echo "To kill process on port $PORT:"
echo "fuser -k ${PORT}/tcp"