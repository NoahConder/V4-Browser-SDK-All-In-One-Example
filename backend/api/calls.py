from flask import Blueprint, jsonify, request
from utils.signalwire import SignalWireClient
import logging
from datetime import datetime
import uuid

logger = logging.getLogger(__name__)
calls_bp = Blueprint('calls', __name__)

# In-memory call storage (in production, use a database)
active_calls = {}
call_history = []

# Initialize SignalWire client
sw_client = None


def init_signalwire_client():
    global sw_client
    try:
        sw_client = SignalWireClient()
        logger.info("SignalWire client initialized for calls")
    except Exception as e:
        logger.error(f"Failed to initialize SignalWire client: {e}")
        sw_client = None


@calls_bp.route('/dial', methods=['POST'])
def initiate_call():
    """
    Log outbound call initiation
    """
    try:
        data = request.get_json() or {}
        to_number = data.get('to')
        from_number = data.get('from', 'WebDialer')

        if not to_number:
            return jsonify({
                "success": False,
                "error": "Phone number is required"
            }), 400

        # Validate phone number
        if not sw_client:
            init_signalwire_client()

        if sw_client and not sw_client.validate_phone_number(to_number):
            return jsonify({
                "success": False,
                "error": "Invalid phone number format"
            }), 400

        # Format phone number
        formatted_number = sw_client.format_phone_number(to_number) if sw_client else to_number

        # Generate call ID
        call_id = str(uuid.uuid4())

        # Store call information
        call_data = {
            "id": call_id,
            "to": formatted_number,
            "from": from_number,
            "direction": "outbound",
            "status": "initiated",
            "started_at": datetime.utcnow().isoformat(),
            "duration": 0
        }

        active_calls[call_id] = call_data

        logger.info(f"Outbound call initiated: {call_id} to {formatted_number}")

        return jsonify({
            "success": True,
            "data": call_data
        }), 200

    except Exception as e:
        logger.error(f"Error initiating call: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@calls_bp.route('/incoming', methods=['POST'])
def handle_incoming_call():
    """
    Handle incoming call webhook from SignalWire
    """
    try:
        # Parse webhook data
        data = request.get_json() or request.form.to_dict()

        # Extract call information
        from_number = data.get('From', 'Unknown')
        to_number = data.get('To', 'WebDialer')
        call_sid = data.get('CallSid', str(uuid.uuid4()))

        # Store incoming call
        call_data = {
            "id": call_sid,
            "from": from_number,
            "to": to_number,
            "direction": "inbound",
            "status": "ringing",
            "started_at": datetime.utcnow().isoformat(),
            "duration": 0
        }

        active_calls[call_sid] = call_data

        logger.info(f"Incoming call received: {call_sid} from {from_number}")

        # Return TwiML response to handle the call
        # For now, we'll just acknowledge receipt
        return jsonify({
            "success": True,
            "message": "Incoming call registered",
            "call_id": call_sid
        }), 200

    except Exception as e:
        logger.error(f"Error handling incoming call: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@calls_bp.route('/status/<call_id>', methods=['GET'])
def get_call_status(call_id):
    """
    Get the status of a specific call
    """
    try:
        if call_id in active_calls:
            return jsonify({
                "success": True,
                "data": active_calls[call_id]
            }), 200

        # Check history
        for call in call_history:
            if call.get('id') == call_id:
                return jsonify({
                    "success": True,
                    "data": call
                }), 200

        return jsonify({
            "success": False,
            "error": "Call not found"
        }), 404

    except Exception as e:
        logger.error(f"Error getting call status: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@calls_bp.route('/end/<call_id>', methods=['POST'])
def end_call(call_id):
    """
    Mark a call as ended
    """
    try:
        if call_id not in active_calls:
            return jsonify({
                "success": False,
                "error": "Call not found"
            }), 404

        call_data = active_calls[call_id]
        call_data['status'] = 'ended'
        call_data['ended_at'] = datetime.utcnow().isoformat()

        # Calculate duration if started_at exists
        if 'started_at' in call_data:
            started = datetime.fromisoformat(call_data['started_at'])
            ended = datetime.utcnow()
            call_data['duration'] = int((ended - started).total_seconds())

        # Move to history
        call_history.append(call_data)
        del active_calls[call_id]

        # Keep only last 100 calls in history
        if len(call_history) > 100:
            call_history.pop(0)

        logger.info(f"Call ended: {call_id}")

        return jsonify({
            "success": True,
            "data": call_data
        }), 200

    except Exception as e:
        logger.error(f"Error ending call: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@calls_bp.route('/history', methods=['GET'])
def get_call_history():
    """
    Get call history
    """
    try:
        # Get query parameters
        limit = request.args.get('limit', 50, type=int)
        direction = request.args.get('direction')  # 'inbound', 'outbound', or None for all

        # Filter history
        filtered_history = call_history
        if direction:
            filtered_history = [
                call for call in call_history
                if call.get('direction') == direction
            ]

        # Sort by most recent first
        sorted_history = sorted(
            filtered_history,
            key=lambda x: x.get('started_at', ''),
            reverse=True
        )

        # Apply limit
        limited_history = sorted_history[:limit]

        return jsonify({
            "success": True,
            "data": limited_history,
            "total": len(filtered_history)
        }), 200

    except Exception as e:
        logger.error(f"Error getting call history: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@calls_bp.route('/active', methods=['GET'])
def get_active_calls():
    """
    Get all active calls
    """
    try:
        return jsonify({
            "success": True,
            "data": list(active_calls.values()),
            "count": len(active_calls)
        }), 200

    except Exception as e:
        logger.error(f"Error getting active calls: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500