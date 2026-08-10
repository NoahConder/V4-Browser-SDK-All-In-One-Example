import os
from flask import Blueprint, jsonify, request
from utils.signalwire import SignalWireClient
from utils.security import api_key_ok, rate_limited, client_ip
import logging
import time

logger = logging.getLogger(__name__)
subscribers_bp = Blueprint('subscribers', __name__)

# Initialize SignalWire client
sw_client = None

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


def init_signalwire_client():
    global sw_client
    try:
        sw_client = SignalWireClient()
        logger.info("SignalWire client initialized for subscribers")
    except Exception as e:
        logger.error(f"Failed to initialize SignalWire client: {e}")
        sw_client = None


def _get_subscribers_cached() -> list:
    if _subscribers_cache["data"] is not None and time.time() < _subscribers_cache["expires_at"]:
        return _subscribers_cache["data"]

    subscribers = sw_client.list_subscribers()
    _subscribers_cache["data"] = subscribers
    _subscribers_cache["expires_at"] = time.time() + CACHE_TTL_SECONDS
    return subscribers


def _to_public_shape(subscriber: dict) -> dict:
    """Trim the raw SignalWire subscriber record down to what a picker UI
    needs -- drop job_title/company_name/timezone/country/etc. to avoid
    forwarding more PII to the browser than necessary.
    """
    nested = subscriber.get('subscriber') or {}
    display_name = (
        subscriber.get('display_name')
        or nested.get('display_name')
        or f"{nested.get('first_name', '')} {nested.get('last_name', '')}".strip()
        or nested.get('email')
        or subscriber.get('id')
    )
    return {
        "id": subscriber.get('id'),
        "display_name": display_name,
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
        if not sw_client:
            init_signalwire_client()

        if not sw_client:
            return jsonify({
                "success": False,
                "error": "SignalWire client not configured"
            }), 500

        offset = request.args.get('offset', 0, type=int)
        limit = request.args.get('limit', 10, type=int)

        subscribers = _get_subscribers_cached()
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
            "error": str(e)
        }), 500
