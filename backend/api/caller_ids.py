from flask import Blueprint, jsonify, request
from utils.signalwire import get_client
from utils.security import gate
import logging
import time

logger = logging.getLogger(__name__)
caller_ids_bp = Blueprint('caller_ids', __name__)

# What SignalWire accepts as the caller ID of a call to a phone number: a
# number the project owns, or an external number it has verified. Two Relay
# REST listings (not Fabric -- see SignalWireClient.relay_api_base), merged
# and cached briefly. Not paged like the SWML/SIP listings: the picker wants
# the whole list every time it opens, and neither listing has a per-item
# cost. Only a complete result is cached, so a source that failed (a token
# without the Numbers scope, a transient error) is retried on the next
# request instead of staying absent for a minute.
_caller_ids_cache = {"data": None, "expires_at": 0}
CACHE_TTL_SECONDS = 60

SOURCE_NUMBERS = 'numbers'
SOURCE_VERIFIED = 'verified'


def _public_caller_id(record: dict, kind: str) -> dict:
    """Trim a listing record to what the picker shows. A purchased number's
    raw record carries its inbound call/message handler configuration (URLs,
    relay contexts, resource ids), none of which belongs in the browser."""
    return {
        "id": record.get('id'),
        "number": record.get('number'),
        "name": record.get('name') or None,
        "kind": kind,
    }


def _load_caller_ids() -> dict:
    """Fetch both listings. A failing source is dropped and named in
    `failed` (the details go to the log), so a token that lacks the Numbers
    scope still yields the verified caller IDs, and vice versa. Both failing
    is an error."""
    client = get_client()
    items = []
    failed = []
    try:
        items.extend(
            _public_caller_id(number, 'number')
            for number in client.list_phone_numbers()
            if number.get('number')
        )
    except Exception as e:
        logger.warning(f"Failed to list phone numbers: {e}")
        failed.append(SOURCE_NUMBERS)
    try:
        # Only numbers whose verification completed are usable as caller ID.
        items.extend(
            _public_caller_id(caller_id, 'verified')
            for caller_id in client.list_verified_caller_ids()
            if caller_id.get('number') and caller_id.get('verified') is True
        )
    except Exception as e:
        logger.warning(f"Failed to list verified caller IDs: {e}")
        failed.append(SOURCE_VERIFIED)
    if len(failed) == 2:
        raise Exception("neither caller ID listing could be fetched")
    # The listings come back newest first; a picker wants a stable order.
    items.sort(key=lambda item: item["number"])
    return {"items": items, "failed": failed}


def _get_caller_ids_cached() -> dict:
    if _caller_ids_cache["data"] is not None and time.time() < _caller_ids_cache["expires_at"]:
        return _caller_ids_cache["data"]

    result = _load_caller_ids()
    if not result["failed"]:
        _caller_ids_cache["data"] = result
        _caller_ids_cache["expires_at"] = time.time() + CACHE_TTL_SECONDS
    return result


@caller_ids_bp.route('', methods=['GET'])
def get_caller_ids():
    """
    List the caller IDs the browser may present on a call to a phone number:
    the project's phone numbers plus its verified caller IDs, each as
    {id, number, name, kind}. `failed` names any source that couldn't be
    listed (the response is still 200 with the other).

    Gated (utils/security.gate): each request can cost two authenticated REST
    calls to SignalWire.
    """
    blocked = gate(request, 'caller_ids', limit=30)
    if blocked:
        return blocked
    try:
        if not get_client():
            return jsonify({
                "success": False,
                "error": "SignalWire client not configured"
            }), 500

        result = _get_caller_ids_cached()

        return jsonify({
            "success": True,
            "data": result["items"],
            "total": len(result["items"]),
            "failed": result["failed"],
        }), 200

    except Exception as e:
        logger.error(f"Error listing caller IDs: {str(e)}")
        return jsonify({
            "success": False,
            "error": "Failed to list caller IDs"
        }), 500
