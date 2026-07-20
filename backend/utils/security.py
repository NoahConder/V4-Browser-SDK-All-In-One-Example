"""Security helpers: API-key gating and simple rate limiting for the
token-minting endpoints.

Added to harden the demo before it is exposed publicly: the token endpoints
mint SignalWire subscriber tokens (which can place billable calls), so they
must not be open to the internet.
"""
import os
import time
import hmac
import logging
from collections import defaultdict, deque

logger = logging.getLogger(__name__)

# Per-IP in-memory rate limiter (sliding window). In-memory => per-worker, not
# global. Good enough as an abuse brake for a demo; pair with edge auth for
# real protection.
_buckets = defaultdict(deque)


def rate_limited(key: str, limit: int = 10, window_sec: int = 60) -> bool:
    """Return True if `key` has exceeded `limit` requests in `window_sec`."""
    now = time.time()
    dq = _buckets[key]
    while dq and dq[0] <= now - window_sec:
        dq.popleft()
    if len(dq) >= limit:
        return True
    dq.append(now)
    return False


def client_ip(request) -> str:
    """Best-effort client IP, honoring the proxy/tunnel forwarding header."""
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.remote_addr or "unknown"


def api_key_ok(request) -> bool:
    """Validate the X-API-Key header against DIALER_API_KEY.

    Fail-closed: if DIALER_API_KEY is not configured, NO request is allowed
    (returns False) so the token endpoint is never accidentally open.
    """
    expected = os.getenv("DIALER_API_KEY", "")
    if not expected:
        logger.error("DIALER_API_KEY is not set — refusing to mint tokens (fail-closed)")
        return False
    provided = request.headers.get("X-API-Key", "")
    return bool(provided) and hmac.compare_digest(provided, expected)
