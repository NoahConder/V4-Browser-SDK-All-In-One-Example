from flask import Blueprint, jsonify, request
from utils.signalwire import SignalWireClient
from concurrent.futures import ThreadPoolExecutor
import logging
import time

logger = logging.getLogger(__name__)
sip_credentials_bp = Blueprint('sip_credentials', __name__)

# Initialize SignalWire client
sw_client = None

# Listing all credentials' metadata (no addresses) is one cheap paginated call;
# fetching each credential's addresses is a separate, slower request. Cache the
# metadata list briefly so repeated "load more" pages don't re-list on every
# click -- only the newly-requested page's addresses get fetched fresh.
_credentials_meta_cache = {"data": None, "expires_at": 0}
CACHE_TTL_SECONDS = 60
ADDRESS_FETCH_WORKERS = 10


def init_signalwire_client():
    global sw_client
    try:
        sw_client = SignalWireClient()
        logger.info("SignalWire client initialized for sip_credentials")
    except Exception as e:
        logger.error(f"Failed to initialize SignalWire client: {e}")
        sw_client = None


def _get_credentials_meta():
    if _credentials_meta_cache["data"] is not None and time.time() < _credentials_meta_cache["expires_at"]:
        return _credentials_meta_cache["data"]

    credentials = sw_client.list_sip_credentials()
    _credentials_meta_cache["data"] = credentials
    _credentials_meta_cache["expires_at"] = time.time() + CACHE_TTL_SECONDS
    return credentials


def _fetch_with_addresses(credential):
    try:
        addresses = sw_client.list_sip_credential_addresses(credential['id'])
    except Exception as e:
        logger.warning(f"Failed to load addresses for credential {credential.get('id')}: {e}")
        addresses = []
    return {**credential, "addresses": addresses}


@sip_credentials_bp.route('/credentials', methods=['GET'])
def get_sip_credentials():
    """
    List SIP credentials along with their dialable addresses, paginated so the
    frontend can render a "load more" list without fetching every credential's
    addresses up front (fetching addresses is one REST call per credential).
    """
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

        credentials = _get_credentials_meta()
        page = credentials[offset:offset + limit]

        with ThreadPoolExecutor(max_workers=ADDRESS_FETCH_WORKERS) as executor:
            enriched = list(executor.map(_fetch_with_addresses, page))

        return jsonify({
            "success": True,
            "data": enriched,
            "total": len(credentials),
            "offset": offset,
            "limit": limit,
            "has_more": offset + limit < len(credentials)
        }), 200

    except Exception as e:
        logger.error(f"Error listing SIP credentials: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500
