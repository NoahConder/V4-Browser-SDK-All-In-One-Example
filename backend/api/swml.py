from flask import Blueprint, jsonify, request
from utils.signalwire import get_client
from utils.security import bounded_page
from concurrent.futures import ThreadPoolExecutor
import logging
import time

logger = logging.getLogger(__name__)
swml_bp = Blueprint('swml', __name__)

# Listing all scripts' metadata (no addresses) is one cheap paginated call;
# fetching each script's addresses is a separate, slower request. Cache the
# metadata list briefly so repeated "load more" pages don't re-list on every
# click -- only the newly-requested page's addresses get fetched fresh.
_scripts_meta_cache = {"data": None, "expires_at": 0}
CACHE_TTL_SECONDS = 60
ADDRESS_FETCH_WORKERS = 10


def _get_scripts_meta():
    if _scripts_meta_cache["data"] is not None and time.time() < _scripts_meta_cache["expires_at"]:
        return _scripts_meta_cache["data"]

    scripts = get_client().list_swml_scripts()
    _scripts_meta_cache["data"] = scripts
    _scripts_meta_cache["expires_at"] = time.time() + CACHE_TTL_SECONDS
    return scripts


def _fetch_with_addresses(script):
    try:
        addresses = get_client().list_swml_script_addresses(script['id'])
    except Exception as e:
        logger.warning(f"Failed to load addresses for script {script.get('id')}: {e}")
        addresses = []
    return {**script, "addresses": addresses}


@swml_bp.route('/scripts', methods=['GET'])
def get_swml_scripts():
    """
    List SWML scripts along with their dialable addresses, paginated so the
    frontend can render a "load more" list without fetching every script's
    addresses up front (fetching addresses is one REST call per script).
    """
    try:
        if not get_client():
            return jsonify({
                "success": False,
                "error": "SignalWire client not configured"
            }), 500

        offset, limit = bounded_page(request)

        scripts = _get_scripts_meta()
        page = scripts[offset:offset + limit]

        with ThreadPoolExecutor(max_workers=ADDRESS_FETCH_WORKERS) as executor:
            enriched = list(executor.map(_fetch_with_addresses, page))

        return jsonify({
            "success": True,
            "data": enriched,
            "total": len(scripts),
            "offset": offset,
            "limit": limit,
            "has_more": offset + limit < len(scripts)
        }), 200

    except Exception as e:
        logger.error(f"Error listing SWML scripts: {str(e)}")
        return jsonify({
            "success": False,
            "error": "Failed to list SWML scripts"
        }), 500
