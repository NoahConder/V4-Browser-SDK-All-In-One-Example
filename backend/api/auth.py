import os
import time
from flask import Blueprint, jsonify, request
from utils.signalwire import SignalWireClient
from utils.security import api_key_ok, rate_limited, client_ip
import logging
from datetime import datetime

logger = logging.getLogger(__name__)
auth_bp = Blueprint('auth', __name__)

# Default reference used when the client doesn't request a specific
# subscriber. The client can now opt into a specific subscriber (see
# _resolve_reference below), but ONLY by id, validated against the account's
# real subscriber list fetched with our own credentials -- never by an
# arbitrary client-supplied reference/subscriber_id string. That distinction
# is what keeps this from reopening the IDOR the fixed reference was
# originally added to close (a caller minting a token for an arbitrary
# subscriber_id they don't otherwise have any claim to).
_TOKEN_REFERENCE = "swdialer"

# Initialize SignalWire client
sw_client = None

# Separate short-lived cache from api/subscribers.py's -- self-contained per
# the existing blueprint convention (see swml.py/sip_credentials.py). Used
# only to validate a client-chosen subscriber id against real accounts.
_subscribers_cache = {"data": None, "expires_at": 0}
SUBSCRIBERS_CACHE_TTL_SECONDS = 60


def _get_subscribers_cached() -> list:
    if _subscribers_cache["data"] is not None and time.time() < _subscribers_cache["expires_at"]:
        return _subscribers_cache["data"]

    subscribers = sw_client.list_subscribers()
    _subscribers_cache["data"] = subscribers
    _subscribers_cache["expires_at"] = time.time() + SUBSCRIBERS_CACHE_TTL_SECONDS
    return subscribers


def _resolve_reference(subscriber_id):
    """Turn a client-supplied subscriber id into a `reference` string safe to
    pass to create_subscriber_token/refresh_token.

    The client can only pick a subscriber that already exists in THIS
    account's subscriber list, fetched here with our own project/auth-token
    credentials -- the client never supplies a raw reference/subscriber_id
    that goes straight to SignalWire unvalidated. Returns (reference, None)
    on success or (None, error_message) if the id isn't a real subscriber.

    Create Subscriber Token only accepts `reference` (not `subscriber_id`),
    and treats it as "often an email, but can be any string" -- reusing the
    same reference resolves to the SAME existing subscriber instead of
    minting a new one, so we resolve the chosen subscriber's email back out
    of the list and use that as the reference.
    """
    if not subscriber_id:
        return _TOKEN_REFERENCE, None

    subscribers = _get_subscribers_cached()
    match = next((s for s in subscribers if s.get('id') == subscriber_id), None)
    if not match:
        return None, "Unknown subscriber"

    nested = match.get('subscriber') or {}
    # Fall back to the id itself if this subscriber has no email on file --
    # still deterministic/reusable, just not tied to their real identity.
    return nested.get('email') or subscriber_id, None


def _gate():
    """Guard for the token endpoints: API key (fail-closed) + rate limit.

    Returns a Flask (response, status) tuple to abort with, or None to proceed.
    Prevents this token-minting endpoint (which yields call-capable SignalWire
    tokens) from being an open, abusable endpoint on the public internet.
    """
    if not api_key_ok(request):
        if not os.getenv("DIALER_API_KEY"):
            # Fail-closed: never mint tokens when the gate isn't configured.
            return jsonify({"success": False, "error": "Token service not configured"}), 503
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    if rate_limited(f"token:{client_ip(request)}", limit=10, window_sec=60):
        return jsonify({"success": False, "error": "Rate limit exceeded"}), 429
    return None


def init_signalwire_client():
    global sw_client
    try:
        sw_client = SignalWireClient()
        logger.info("SignalWire client initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize SignalWire client: {e}")
        sw_client = None


@auth_bp.route('/token', methods=['POST'])
def generate_token():
    """
    Generate a new subscriber token for WebRTC access. Optionally scoped to a
    specific subscriber, chosen by id from GET /api/subscribers -- the id is
    revalidated here against the account's real subscriber list before use,
    never trusted as-is (see _resolve_reference).
    """
    blocked = _gate()
    if blocked:
        return blocked
    try:
        if not sw_client:
            init_signalwire_client()
            if not sw_client:
                return jsonify({"error": "SignalWire client not configured"}), 500

        body = request.get_json(silent=True) or {}
        reference, error = _resolve_reference(body.get('subscriber_id'))
        if error:
            return jsonify({"success": False, "error": error}), 400

        token_data = sw_client.create_subscriber_token(
            reference=reference,
            expires_in=3600  # 1 hour
        )

        logger.info("Token generated successfully")

        return jsonify({
            "success": True,
            "data": token_data
        }), 200

    except Exception as e:
        # Log details server-side; do not leak internals to the client.
        logger.error(f"Error generating token: {str(e)}")
        return jsonify({
            "success": False,
            "error": "Failed to generate token"
        }), 500


@auth_bp.route('/refresh', methods=['POST'])
def refresh_token():
    """
    Refresh an existing subscriber token. The frontend passes the same
    subscriber_id it authenticated with originally, so refresh keeps re-upping
    as the SAME subscriber instead of silently falling back to the default
    reference mid-session -- still revalidated against the real subscriber
    list on every call, same as /token.
    """
    blocked = _gate()
    if blocked:
        return blocked
    try:
        if not sw_client:
            init_signalwire_client()
            if not sw_client:
                return jsonify({"error": "SignalWire client not configured"}), 500

        body = request.get_json(silent=True) or {}
        reference, error = _resolve_reference(body.get('subscriber_id'))
        if error:
            return jsonify({"success": False, "error": error}), 400

        token_data = sw_client.refresh_token(reference=reference)

        logger.info("Token refreshed successfully")

        return jsonify({
            "success": True,
            "data": token_data
        }), 200

    except Exception as e:
        logger.error(f"Error refreshing token: {str(e)}")
        return jsonify({
            "success": False,
            "error": "Failed to refresh token"
        }), 500


@auth_bp.route('/validate', methods=['POST'])
def validate_token():
    """
    Validate if a token is still valid (endpoint for testing)
    """
    try:
        data = request.get_json() or {}
        token = data.get('token')

        if not token:
            return jsonify({
                "success": False,
                "error": "No token provided"
            }), 400

        # In a real implementation, you would validate the token with SignalWire
        # For now, we'll just return success
        return jsonify({
            "success": True,
            "valid": True,
            "message": "Token validation endpoint (placeholder)"
        }), 200

    except Exception as e:
        logger.error(f"Error validating token: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500