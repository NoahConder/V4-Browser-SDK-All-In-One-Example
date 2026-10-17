import os
from flask import Blueprint, jsonify, request
from utils.signalwire import get_client
from utils.security import api_key_ok, rate_limited, client_ip, bounded_page
import logging
import time

logger = logging.getLogger(__name__)
subscribers_bp = Blueprint('subscribers', __name__)

# Unlike the SWML/SIP resource browsers, subscriber records carry real PII
# (email, name) rather than just resource labels, so this list is gated the
# same way as the token endpoints instead of being left open.
_subscribers_cache = {"data": None, "expires_at": 0}
CACHE_TTL_SECONDS = 60


def _gate():
    """Same gate as auth.py's token endpoints: API key (fail-closed) + rate
    limit. This list exposes subscriber emails/names, so it must not be an
    open, scrapeable endpoint on the public internet.
    """
    if not api_key_ok(request):
        if not os.getenv("DIALER_API_KEY"):
            return jsonify({"success": False, "error": "Subscriber service not configured"}), 503
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    if rate_limited(f"subscribers:{client_ip(request)}", limit=10, window_sec=60):
        return jsonify({"success": False, "error": "Rate limit exceeded"}), 429
    return None


def get_subscribers_cached() -> list:
    """The space's raw subscriber records, cached briefly. Shared with
    api/auth.py, which validates a client-chosen subscriber id against it.
    Raises if the SignalWire client isn't configured.
    """
    if _subscribers_cache["data"] is not None and time.time() < _subscribers_cache["expires_at"]:
        return _subscribers_cache["data"]

    sw_client = get_client()
    if not sw_client:
        raise RuntimeError("SignalWire client not configured")
    subscribers = sw_client.list_subscribers()
    _subscribers_cache["data"] = subscribers
    _subscribers_cache["expires_at"] = time.time() + CACHE_TTL_SECONDS
    return subscribers


def display_name_for(subscriber: dict) -> str:
    """Best available display name for a raw subscriber record."""
    nested = subscriber.get('subscriber') or {}
    return (
        subscriber.get('display_name')
        or nested.get('display_name')
        or f"{nested.get('first_name', '')} {nested.get('last_name', '')}".strip()
        or nested.get('email')
        or subscriber.get('id')
    )


def _to_public_shape(subscriber: dict) -> dict:
    """Trim the raw SignalWire subscriber record down to what a picker UI
    needs -- drop job_title/company_name/timezone/country/etc. to avoid
    forwarding more PII to the browser than necessary.
    """
    nested = subscriber.get('subscriber') or {}
    return {
        "id": subscriber.get('id'),
        "display_name": display_name_for(subscriber),
        "email": nested.get('email'),
    }


@subscribers_bp.route('', methods=['GET'])
def get_subscribers():
    """
    List subscribers in this space, paginated for a picker UI.
    """
    blocked = _gate()
    if blocked:
        return blocked
    try:
        if not get_client():
            return jsonify({
                "success": False,
                "error": "SignalWire client not configured"
            }), 500

        offset, limit = bounded_page(request)

        subscribers = get_subscribers_cached()
        page = [_to_public_shape(s) for s in subscribers[offset:offset + limit]]

        return jsonify({
            "success": True,
            "data": page,
            "total": len(subscribers),
            "offset": offset,
            "limit": limit,
            "has_more": offset + limit < len(subscribers)
        }), 200

    except Exception as e:
        logger.error(f"Error listing subscribers: {str(e)}")
        return jsonify({
            "success": False,
            "error": "Failed to list subscribers"
        }), 500
