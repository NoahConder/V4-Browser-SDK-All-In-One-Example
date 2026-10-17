from flask import Blueprint, jsonify, request
from utils.signalwire import get_client
from utils.security import gate
import logging
from datetime import datetime, timezone
import uuid

logger = logging.getLogger(__name__)
calls_bp = Blueprint('calls', __name__)

# Cosmetic server-side log of outbound dials, not a source of truth: calls are
# signaled and carried between the browser and SignalWire directly, and the
# frontend posts here fire-and-forget. The browser keeps the real call log
# (Recents; see CLAUDE.md). The in-memory store and the /status, /end,
# /history and /active readers that used to sit on top of it were removed:
# nothing read them, and ungated they listed every number a tester had dialed.


@calls_bp.route('/dial', methods=['POST'])
def initiate_call():
    """Validate and log an outbound dial. The call itself is placed by the browser."""
    blocked = gate(request, 'calls', limit=30)
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        to_number = data.get('to')
        from_number = data.get('from')
        if not isinstance(from_number, str) or not from_number:
            from_number = 'WebDialer'

        if not isinstance(to_number, str) or not to_number.strip():
            return jsonify({
                "success": False,
                "error": "Phone number is required"
            }), 400

        sw_client = get_client()
        if sw_client and not sw_client.validate_phone_number(to_number):
            return jsonify({
                "success": False,
                "error": "Invalid phone number format"
            }), 400

        formatted_number = sw_client.format_phone_number(to_number) if sw_client else to_number
        call_data = {
            "id": str(uuid.uuid4()),
            "to": formatted_number,
            "from": from_number,
            "direction": "outbound",
            "status": "initiated",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "duration": 0
        }

        logger.info(f"Outbound call initiated: {call_data['id']} to {formatted_number}")

        return jsonify({
            "success": True,
            "data": call_data
        }), 200

    except Exception as e:
        logger.error(f"Error logging call: {str(e)}")
        return jsonify({
            "success": False,
            "error": "Failed to log call"
        }), 500
