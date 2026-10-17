from flask import Blueprint, jsonify, request
from utils.signalwire import get_client
from utils.security import gate, bounded_page
from concurrent.futures import ThreadPoolExecutor
import logging
import time

logger = logging.getLogger(__name__)
subscribers_bp = Blueprint('subscribers', __name__)

# Subscriber records carry real PII (email, name), so this list is gated like
# the token endpoints (utils/security.gate) -- as every /api route now is.
_subscribers_cache = {"data": None, "expires_at": 0}
CACHE_TTL_SECONDS = 60
ADDRESS_FETCH_WORKERS = 10


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


def _public_address(address: dict) -> dict:
    return {
        "id": address.get('id'),
        "name": address.get('name'),
        "display_name": address.get('display_name'),
        "channels": address.get('channels') or {},
    }


def _fetch_addresses(subscriber: dict) -> list:
    """The subscriber's dialable Fabric addresses (one REST call per
    subscriber, so only done for the requested page). Lets the picker offer
    to *call* a subscriber, not just to become one."""
    try:
        return [_public_address(a) for a in get_client().list_subscriber_addresses(subscriber['id'])]
    except Exception as e:
        logger.warning(f"Failed to load addresses for subscriber {subscriber.get('id')}: {e}")
        return []


def _to_public_shape(subscriber: dict, addresses: list) -> dict:
    """Trim the raw SignalWire subscriber record down to what a picker UI
    needs -- drop job_title/company_name/timezone/country/etc. to avoid
    forwarding more PII to the browser than necessary.
    """
    nested = subscriber.get('subscriber') or {}
    return {
        "id": subscriber.get('id'),
        "display_name": display_name_for(subscriber),
        "email": nested.get('email'),
        "addresses": addresses,
    }


@subscribers_bp.route('', methods=['GET'])
def get_subscribers():
    """
    List subscribers in this space, paginated for a picker UI, each with its
    dialable addresses.
    """
    blocked = gate(request, 'subscribers')
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
        page_records = subscribers[offset:offset + limit]
        with ThreadPoolExecutor(max_workers=ADDRESS_FETCH_WORKERS) as executor:
            page_addresses = list(executor.map(_fetch_addresses, page_records))
        page = [_to_public_shape(s, a) for s, a in zip(page_records, page_addresses)]

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
