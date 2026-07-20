import os
from flask import Blueprint, jsonify, request
from utils.signalwire import SignalWireClient
from utils.security import api_key_ok, rate_limited, client_ip
import logging
from datetime import datetime

logger = logging.getLogger(__name__)
auth_bp = Blueprint('auth', __name__)

# Fixed, server-controlled subscriber reference. The client must NOT be able to
# choose the reference/subscriber a token is minted for (was an IDOR vector
# where a caller could request a token for an arbitrary subscriber_id).
_TOKEN_REFERENCE = "swdialer"

# Initialize SignalWire client
sw_client = None


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
    Generate a new subscriber token for WebRTC access
    """
    blocked = _gate()
    if blocked:
        return blocked
    try:
        if not sw_client:
            init_signalwire_client()
            if not sw_client:
                return jsonify({"error": "SignalWire client not configured"}), 500

        # Reference is fixed server-side — never taken from the request body.
        token_data = sw_client.create_subscriber_token(
            reference=_TOKEN_REFERENCE,
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
    Refresh an existing subscriber token
    """
    blocked = _gate()
    if blocked:
        return blocked
    try:
        if not sw_client:
            init_signalwire_client()
            if not sw_client:
                return jsonify({"error": "SignalWire client not configured"}), 500

        # Mint a fresh token (reference fixed server-side).
        token_data = sw_client.refresh_token()

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