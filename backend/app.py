import os
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
import logging
from datetime import datetime, timezone

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Create Flask app
app = Flask(__name__)

# Configure CORS. No cookies are involved (the API key travels in a header),
# so credentials support isn't needed.
frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:5173')
CORS(app, origins=[frontend_url])

# Import blueprints
from api.auth import auth_bp
from api.calls import calls_bp
from api.swml import swml_bp
from api.sip_credentials import sip_credentials_bp
from api.subscribers import subscribers_bp
from api.caller_ids import caller_ids_bp

# Register blueprints
app.register_blueprint(auth_bp, url_prefix='/api/auth')
app.register_blueprint(calls_bp, url_prefix='/api/calls')
app.register_blueprint(swml_bp, url_prefix='/api/swml')
app.register_blueprint(sip_credentials_bp, url_prefix='/api/sip')
app.register_blueprint(subscribers_bp, url_prefix='/api/subscribers')
app.register_blueprint(caller_ids_bp, url_prefix='/api/caller-ids')

# Request headers whose values must never reach the log.
_SENSITIVE_HEADERS = {'x-api-key', 'authorization', 'cookie'}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.route('/')
def index():
    """Health check endpoint"""
    return jsonify({
        "status": "online",
        "service": "SignalWire Dialer Backend",
        "timestamp": _now_iso(),
        "version": "1.0.0"
    })


@app.route('/health')
def health_check():
    """Detailed health check"""
    try:
        # Check if environment variables are set. DIALER_API_KEY is reported
        # separately: without it the token endpoints fail closed (503), which
        # is the most common misconfiguration.
        config_status = all([
            os.getenv('SPACE_NAME'),
            os.getenv('PROJECT_ID'),
            os.getenv('AUTH_TOKEN')
        ])
        api_key_configured = bool(os.getenv('DIALER_API_KEY'))

        return jsonify({
            "status": "healthy" if config_status and api_key_configured else "degraded",
            "checks": {
                "server": True,
                "config": config_status,
                "dialer_api_key": api_key_configured,
                "timestamp": _now_iso()
            }
        }), 200 if config_status else 503

    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return jsonify({
            "status": "unhealthy",
            "error": "Health check failed"
        }), 503


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({
        "error": "Endpoint not found",
        "status": 404
    }), 404


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    logger.error(f"Internal server error: {str(error)}")
    return jsonify({
        "error": "Internal server error",
        "status": 500
    }), 500


@app.before_request
def log_request_info():
    """Log incoming requests at DEBUG, with secrets redacted. Bodies aren't
    logged: the auth endpoints post tokens."""
    if logger.isEnabledFor(logging.DEBUG):
        headers = {
            name: ('<redacted>' if name.lower() in _SENSITIVE_HEADERS else value)
            for name, value in request.headers.items()
        }
        logger.debug(f"{request.method} {request.path} headers={headers} body_bytes={request.content_length or 0}")


if __name__ == '__main__':
    # Check for required environment variables
    required_vars = ['SPACE_NAME', 'PROJECT_ID', 'AUTH_TOKEN']
    missing_vars = [var for var in required_vars if not os.getenv(var)]

    if missing_vars:
        logger.warning(f"Missing environment variables: {missing_vars}")
        logger.warning("Please copy .env.example to .env and configure your SignalWire credentials")

    # Run the Flask app
    port = int(os.getenv('PORT', 5001))  # Changed to 5001 to avoid conflict
    debug = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'

    logger.info(f"Starting SignalWire Dialer Backend on port {port}")
    app.run(host='0.0.0.0', port=port, debug=debug)
