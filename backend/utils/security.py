"""Security helpers: API-key gating, simple rate limiting, and
request-parameter bounds, shared by every /api blueprint.

Added to harden the demo before it is exposed publicly: the token endpoints
mint SignalWire subscriber tokens (which can place billable calls), and the
listing endpoints fan out authenticated REST calls to SignalWire per item, so
none of them should be open to the internet.
"""
import os
import time
import hmac
import logging
from collections import defaultdict, deque

from flask import jsonify

logger = logging.getLogger(__name__)

# Per-IP in-memory rate limiter (sliding window). In-memory => per-worker, not
# global. Good enough as an abuse brake for a demo; pair with edge auth for
# real protection.
_buckets = defaultdict(deque)
# Idle buckets are swept once the table grows past this many keys, so a scan
# from many addresses can't grow it without bound.
_SWEEP_THRESHOLD = 1000


def rate_limited(key: str, limit: int = 10, window_sec: int = 60) -> bool:
    """Return True if `key` has exceeded `limit` requests in `window_sec`."""
    now = time.time()
    dq = _buckets[key]
    while dq and dq[0] <= now - window_sec:
        dq.popleft()
    if len(dq) >= limit:
        return True
    dq.append(now)

    if len(_buckets) > _SWEEP_THRESHOLD:
        for stale in [k for k, d in _buckets.items() if not d or d[-1] <= now - window_sec]:
            del _buckets[stale]
    return False


def client_ip(request) -> str:
    """Best-effort client IP, honoring the proxy/tunnel forwarding header.

    Note X-Forwarded-For is client-controlled unless a trusted proxy strips
    it, so a forged header can dodge the per-IP limit -- acceptable for a
    demo brake, not a security boundary (see module docstring).
    """
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


def gate(request, scope: str, limit: int = 10, window_sec: int = 60):
    """Guard for every /api route: API key (fail-closed) + per-IP rate limit,
    with the limiter keyed by `scope` so one endpoint's traffic doesn't starve
    another's. Returns a Flask (response, status) tuple to abort with, or None
    to proceed. Costs the frontend nothing: its axios instance sends X-API-Key
    on every request.
    """
    if not api_key_ok(request):
        if not os.getenv("DIALER_API_KEY"):
            # Fail-closed: never serve when the gate isn't configured.
            return jsonify({"success": False, "error": "Service not configured"}), 503
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    if rate_limited(f"{scope}:{client_ip(request)}", limit=limit, window_sec=window_sec):
        return jsonify({"success": False, "error": "Rate limit exceeded"}), 429
    return None


MAX_PAGE_LIMIT = 50


def bounded_page(request, default_limit: int = 10) -> tuple:
    """(offset, limit) from the query string, clamped: offset >= 0,
    1 <= limit <= MAX_PAGE_LIMIT. The listing endpoints fetch one extra REST
    call per item on the page, so an unbounded limit would fan out a request
    per resource in the space.
    """
    offset = max(0, request.args.get('offset', 0, type=int) or 0)
    limit = request.args.get('limit', default_limit, type=int) or default_limit
    limit = max(1, min(limit, MAX_PAGE_LIMIT))
    return offset, limit


MAX_QUERY_LENGTH = 100


def query_param(request, name: str = 'q') -> str:
    """Free-text filter from the query string, trimmed and capped in length so
    a hostile value can't make the per-item substring scan expensive. '' when
    absent. The listing endpoints apply it to their cached metadata *before*
    paging, so `offset` is relative to the filtered list.
    """
    return (request.args.get(name, '') or '').strip()[:MAX_QUERY_LENGTH]
