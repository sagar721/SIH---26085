import logging
import sys
from typing import Any, Dict
from app.core.config import settings


class AppLogFormatter(logging.Formatter):
    """Clean structured log formatter with timestamp, level, component name and message."""

    def format(self, record: logging.LogRecord) -> str:
        timestamp = self.formatTime(record, datefmt="%Y-%m-%d %H:%M:%S")
        level = record.levelname.ljust(8)
        name = record.name
        message = record.getMessage()
        if record.exc_info:
            exc_text = self.formatException(record.exc_info)
            return f"[{timestamp}] [{level}] [{name}] {message}\n{exc_text}"
        return f"[{timestamp}] [{level}] [{name}] {message}"


def setup_logging() -> logging.Logger:
    """Configures root application logger according to environment settings."""
    log_level = logging.DEBUG if settings.DEBUG else logging.INFO
    root_logger = logging.getLogger("mflood")
    root_logger.setLevel(log_level)

    # Avoid duplicate handlers if setup_logging is called multiple times
    if not root_logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setLevel(log_level)
        handler.setFormatter(AppLogFormatter())
        root_logger.addHandler(handler)

    return root_logger


logger = setup_logging()


def get_logger(name: str) -> logging.Logger:
    """Return a child logger for a specific module or component."""
    return logging.getLogger(f"mflood.{name}")
