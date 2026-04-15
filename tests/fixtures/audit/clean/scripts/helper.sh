#!/bin/bash
echo "hello from a safe helper"
ls -la "$1" 2>/dev/null || true
