"""Explicit module registry. New tools do not modify the HTTP server."""
from modules.webenum import WebEnum

MODULE_TYPES = (WebEnum,)
