from flask import Blueprint, jsonify, request
from utils.signalwire import SignalWireClient
import logging
from datetime import datetime

logger = logging.getLogger(__name__)
auth_bp = Blueprint('auth', __name__)

# Initialize SignalWire client
sw_client = None


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
    try:
        if not sw_client:
            init_signalwire_client()
            if not sw_client:
                return jsonify({"error": "SignalWire client not configured"}), 500

        # Get optional subscriber ID and reference from request
        data = request.get_json() or {}
        subscriber_id = data.get('subscriber_id')
        reference = data.get('reference', 'swdialer')  # Default to 'swdialer'

        # Generate token with 1-hour expiry by default
        token_data = sw_client.create_subscriber_token(
            subscriber_id=subscriber_id,
            reference=reference,
            expires_in=3600  # 1 hour
        )

        logger.info(f"Token generated successfully for subscriber: {subscriber_id or 'anonymous'}")

        return jsonify({
            "success": True,
            "data": token_data
        }), 200

    except Exception as e:
        logger.error(f"Error generating token: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@auth_bp.route('/refresh', methods=['POST'])
def refresh_token():
    """
    Refresh an existing subscriber token
    """
    try:
        if not sw_client:
            init_signalwire_client()
            if not sw_client:
                return jsonify({"error": "SignalWire client not configured"}), 500

        # Get the old token from request (optional for validation)
        data = request.get_json() or {}
        old_token = data.get('token')

        # Generate a new token
        token_data = sw_client.refresh_token(old_token=old_token)

        logger.info("Token refreshed successfully")

        return jsonify({
            "success": True,
            "data": token_data
        }), 200

    except Exception as e:
        logger.error(f"Error refreshing token: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
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