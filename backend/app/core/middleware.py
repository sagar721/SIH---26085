"""Security and rate-limiting middleware for M-FLOOD API."""

import time
from typing import Dict, Tuple
from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app.core.logging import get_logger
from app.core.metrics import HTTP_LATENCY, HTTP_REQUESTS

logger = get_logger("middleware.rate_limit")


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Token-bucket rate limiter per client IP address.
    Default capacity: 120 requests per minute.
    Refill rate: 2 tokens per second.
    """

    def __init__(self, app, requests_per_minute: int = 120):
        super().__init__(app)
        self.capacity = requests_per_minute
        self.refill_rate = requests_per_minute / 60.0  # tokens per second
        self.clients: Dict[str, Tuple[float, float]] = {}  # ip -> (tokens, last_update_time)

    def _get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client and request.client.host:
            return request.client.host
        return "127.0.0.1"

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Exempt health probes and docs from rate limiting
        path = request.url.path
        if path in ("/api/v1/health", "/api/v1/health/live", "/api/v1/health/ready", "/docs", "/redoc", "/openapi.json", "/"):
            return await call_next(request)

        client_ip = self._get_client_ip(request)
        now = time.time()

        tokens, last_time = self.clients.get(client_ip, (self.capacity, now))
        # Refill tokens based on elapsed time
        elapsed = now - last_time
        tokens = min(self.capacity, tokens + elapsed * self.refill_rate)

        if tokens < 1.0:
            logger.warning(f"Rate limit exceeded for client {client_ip} on {path}")
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "status": "ERROR",
                    "error": "Rate limit exceeded. Maximum 120 requests per minute allowed.",
                    "client_ip": client_ip,
                },
                headers={
                    "Retry-After": "1",
                    "X-RateLimit-Limit": str(self.capacity),
                    "X-RateLimit-Remaining": "0",
                },
            )

        tokens -= 1.0
        self.clients[client_ip] = (tokens, now)

        started = time.perf_counter()
        response = await call_next(request)
        HTTP_REQUESTS.labels(request.method, path, str(response.status_code)).inc()
        HTTP_LATENCY.labels(request.method, path).observe(time.perf_counter() - started)
        response.headers["X-RateLimit-Limit"] = str(self.capacity)
        response.headers["X-RateLimit-Remaining"] = str(int(tokens))
        return response
