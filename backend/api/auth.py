from flask import Blueprint, jsonify, request
from utils.signalwire import get_client
from utils.security import gate
from api.subscribers import get_subscribers_cached, display_name_for
import logging

logger = logging.getLogger(__name__)
auth_bp = Blueprint('auth', __name__)

# Default reference used when the client doesn't request a specific
# subscriber. The client can opt into a specific subscriber (see
# _resolve_reference below), but ONLY by id, validated against the account's
# real subscriber list fetched with our own credentials -- never by an
# arbitrary client-supplied reference/subscriber_id string. That distinction
# is what keeps this from reopening the IDOR the fixed reference was
# originally added to close (a caller minting a token for an arbitrary
# subscriber_id they don't otherwise have any claim to).
_TOKEN_REFERENCE = "swdialer"


class SubscriberLookupUnavailable(Exception):
    """The subscriber list couldn't be fetched, so a client-chosen subscriber
    id can't be validated right now. Transient: _mint answers 503, which the
    frontend does not treat as a stale saved subscriber (that's the 400)."""


def _resolve_reference(subscriber_id):
    """Turn a client-supplied subscriber id into a `reference` string safe to
    pass to create_subscriber_token/refresh_token, plus the real resource id
    and display name to echo back to the UI.

    The client can only pick a subscriber that already exists in THIS
    account's subscriber list, fetched here with our own project/auth-token
    credentials -- the client never supplies a raw reference/subscriber_id
    that goes straight to SignalWire unvalidated. Returns
    (reference, resource_id, display_name, None) on success or
    (None, None, None, error_message) if the id isn't a real subscriber.

    Create Subscriber Token only accepts `reference` (not `subscriber_id`),
    and treats it as "often an email, but can be any string" -- reusing the
    same reference resolves to the SAME existing subscriber instead of
    minting a new one, so we resolve the chosen subscriber's email back out
    of the list and use that as the reference.

    IMPORTANT: the `subscriber_id` SignalWire's own Create Subscriber Token
    response echoes back is in a completely different id namespace than
    GET /resources/subscribers' `id` -- confirmed by minting a token for a
    known subscriber and getting back neither that id nor any id in the
    account's subscriber list. So callers here should prefer the resource id
    resolved below over create_subscriber_token()'s own returned
    subscriber_id, which is useless for cross-referencing the subscriber list.
    """
    if not subscriber_id:
        # No explicit pick -- still try to resolve the default reference
        # against the real subscriber list (SignalWire auto-creates/reuses a
        # resource per unique reference on first use, so one often exists),
        # falling back to the literal reference string as the display name.
        # The lookup is cosmetic here (it only supplies the display name and
        # resource id), so a listing failure must not stop the token from
        # being minted -- it used to take the whole app down with a 500.
        try:
            subscribers = get_subscribers_cached()
        except Exception as e:
            logger.warning(f"Subscriber lookup failed; minting for the default reference anyway: {e}")
            return _TOKEN_REFERENCE, None, _TOKEN_REFERENCE, None
        default_match = next(
            (s for s in subscribers if (s.get('subscriber') or {}).get('email') == _TOKEN_REFERENCE),
            None,
        )
        if default_match:
            return _TOKEN_REFERENCE, default_match.get('id'), display_name_for(default_match), None
        return _TOKEN_REFERENCE, None, _TOKEN_REFERENCE, None

    try:
        subscribers = get_subscribers_cached()
    except Exception as e:
        logger.error(f"Subscriber lookup failed; cannot validate subscriber id: {e}")
        raise SubscriberLookupUnavailable() from e
    match = next((s for s in subscribers if s.get('id') == subscriber_id), None)
    if not match:
        return None, None, None, "Unknown subscriber"

    nested = match.get('subscriber') or {}
    # Fall back to the id itself if this subscriber has no email on file --
    # still deterministic/reusable, just not tied to their real identity.
    reference = nested.get('email') or subscriber_id
    return reference, match.get('id'), display_name_for(match), None


def _mint(refresh: bool):
    """Shared body of /token and /refresh: gate, resolve the subscriber, mint.

    The gate (utils/security.gate) fail-closes without DIALER_API_KEY: these
    endpoints mint call-capable SignalWire tokens and must never be open.
    """
    blocked = gate(request, 'token')
    if blocked:
        return blocked
    try:
        sw_client = get_client()
        if not sw_client:
            return jsonify({"success": False, "error": "SignalWire client not configured"}), 500

        body = request.get_json(silent=True) or {}
        reference, resource_id, display_name, error = _resolve_reference(body.get('subscriber_id'))
        if error:
            return jsonify({"success": False, "error": error}), 400

        if refresh:
            token_data = sw_client.refresh_token(reference=reference)
        else:
            token_data = sw_client.create_subscriber_token(
                reference=reference,
                expires_in=3600  # 1 hour
            )
        # Override SignalWire's own returned subscriber_id -- it's in a
        # different id namespace than GET /resources/subscribers and can't be
        # cross-referenced against the subscriber list (see _resolve_reference).
        if resource_id:
            token_data['subscriber_id'] = resource_id
        token_data['subscriber_display_name'] = display_name

        logger.info("Token refreshed successfully" if refresh else "Token generated successfully")

        return jsonify({
            "success": True,
            "data": token_data
        }), 200

    except SubscriberLookupUnavailable:
        return jsonify({"success": False, "error": "Subscriber lookup unavailable"}), 503
    except Exception as e:
        # Log details server-side; do not leak internals to the client.
        logger.error(f"Error {'refreshing' if refresh else 'generating'} token: {str(e)}")
        return jsonify({
            "success": False,
            "error": "Failed to refresh token" if refresh else "Failed to generate token"
        }), 500


@auth_bp.route('/token', methods=['POST'])
def generate_token():
    """
    Generate a new subscriber token for WebRTC access. Optionally scoped to a
    specific subscriber, chosen by id from GET /api/subscribers -- the id is
    revalidated here against the account's real subscriber list before use,
    never trusted as-is (see _resolve_reference).
    """
    return _mint(refresh=False)


@auth_bp.route('/refresh', methods=['POST'])
def refresh_token():
    """
    Refresh an existing subscriber token. The frontend passes the same
    subscriber_id it authenticated with originally, so refresh keeps re-upping
    as the SAME subscriber instead of silently falling back to the default
    reference mid-session -- still revalidated against the real subscriber
    list on every call, same as /token.
    """
    return _mint(refresh=True)
