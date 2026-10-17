import os
import time
import requests
from typing import Dict, Optional
import logging
from datetime import datetime, timezone
import base64

logger = logging.getLogger(__name__)


class SignalWireClient:
    def __init__(self):
        self.space_name = os.getenv('SPACE_NAME')
        self.project_id = os.getenv('PROJECT_ID')
        self.auth_token = os.getenv('AUTH_TOKEN')

        if not all([self.space_name, self.project_id, self.auth_token]):
            raise ValueError("Missing required SignalWire configuration in environment variables")

        # SPACE_NAME in .env already contains the FQDN (e.g., spacename.signalwire.com or puc.swire.io)
        # Use it directly without modification
        self.api_base = f"https://{self.space_name}/api/fabric"
        self.auth = (self.project_id, self.auth_token)

    def create_subscriber_token(self, subscriber_id: str = None, reference: str = "swdialer", expires_in: int = 3600) -> Dict:
        """
        Create a subscriber token for Fabric access

        Args:
            subscriber_id: Optional subscriber identifier
            reference: Reference identifier for the token (required by SignalWire)
            expires_in: Token expiry time in seconds (default 1 hour)

        Returns:
            Dict containing token and expiry information
        """
        try:
            # SignalWire Fabric subscriber token endpoint
            url = f"{self.api_base}/subscribers/tokens"

            # expire_at is a Unix timestamp (seconds) per the documented Create
            # Subscriber Token schema -- not expires_at/ISO, and there's no
            # audio/video field on this endpoint.
            expire_at = int(time.time()) + expires_in

            payload = {
                "reference": reference,  # Required field for Fabric tokens
                "expire_at": expire_at,
            }

            if subscriber_id:
                payload["subscriber_id"] = subscriber_id

            logger.info(f"Creating subscriber token with expiry: {expire_at}")

            # Make the API request
            response = requests.post(
                url,
                json=payload,
                auth=self.auth,
                headers={"Content-Type": "application/json"}
            )

            response.raise_for_status()
            data = response.json()

            # The token response doesn't echo back an expiry, so compute the
            # ISO timestamp ourselves from what we requested.
            expires_at_iso = datetime.fromtimestamp(expire_at, tz=timezone.utc).isoformat()

            # Format the response
            return {
                "token": data.get("token"),
                "expires_at": expires_at_iso,
                "expires_in": expires_in,
                "subscriber_id": data.get("subscriber_id"),
                "project_id": self.project_id,
                "space_name": self.space_name  # Already contains FQDN from .env
            }

        except requests.exceptions.RequestException as e:
            logger.error(f"Error creating subscriber token: {str(e)}")
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            raise Exception(f"Failed to create subscriber token: {str(e)}")

    def refresh_token(self, old_token: str = None, reference: str = "swdialer") -> Dict:
        """
        Refresh an existing subscriber token

        Args:
            old_token: The existing token (optional, for validation)
            reference: Reference identifier for the token

        Returns:
            Dict containing new token and expiry information
        """
        # For now, we'll just create a new token
        # In production, you might want to validate the old token first
        return self.create_subscriber_token(reference=reference, expires_in=3600)

    def _get_all_pages(self, url: str) -> list:
        """
        GET a URL and follow pagination via a `links.next` field until
        exhausted. Tolerates both a bare JSON array response and a
        `{"data": [...], "links": {...}}` wrapper.
        """
        results = []
        next_url = url
        try:
            while next_url:
                response = requests.get(
                    next_url,
                    auth=self.auth,
                    headers={"Content-Type": "application/json"}
                )
                response.raise_for_status()
                payload = response.json()

                if isinstance(payload, list):
                    results.extend(payload)
                    break

                results.extend(payload.get('data', []))
                next_url = (payload.get('links') or {}).get('next')

            return results

        except requests.exceptions.RequestException as e:
            logger.error(f"Error fetching {url}: {str(e)}")
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"Response: {e.response.text}")
            raise Exception(f"Failed to fetch {url}: {str(e)}")

    def list_swml_scripts(self) -> list:
        """
        List SWML scripts in this space.
        https://signalwire.com/docs/apis/rest/swml-scripts/list-swml-scripts
        """
        return self._get_all_pages(f"{self.api_base}/resources/swml_scripts")

    def list_swml_script_addresses(self, script_id: str) -> list:
        """
        List the dialable addresses for a given SWML script.
        https://signalwire.com/docs/apis/rest/swml-scripts/list-swml-script-addresses
        """
        return self._get_all_pages(f"{self.api_base}/resources/swml_scripts/{script_id}/addresses")

    def list_sip_credentials(self) -> list:
        """
        List SIP credentials (sip_endpoints resources) in this space.
        https://signalwire.com/docs/apis/rest/sip-credentials/list-sip-credentials
        """
        return self._get_all_pages(f"{self.api_base}/resources/sip_endpoints")

    def list_sip_credential_addresses(self, credential_id: str) -> list:
        """
        List the dialable addresses for a given SIP credential.
        https://signalwire.com/docs/apis/rest/sip-credentials/list-sip-credential-addresses
        """
        return self._get_all_pages(f"{self.api_base}/resources/sip_endpoints/{credential_id}/addresses")

    def list_subscribers(self) -> list:
        """
        List subscribers in this space.
        https://signalwire.com/docs/apis/rest/subscribers/list-subscribers
        """
        return self._get_all_pages(f"{self.api_base}/resources/subscribers")

    @staticmethod
    def is_dial_address(destination: str) -> bool:
        """
        Check whether a dial destination is a SIP URI (sip:user@domain) or a
        Fabric address (/public/room-name) rather than a bare phone number.
        Both are passed through untouched -- only phone numbers get E.164
        normalization. Keep in sync with isDialAddress() in
        frontend/src/utils/address.ts (used by normalizeDestination() in
        frontend/src/services/signalwire.ts).
        """
        destination = destination.strip()
        return (
            destination.lower().startswith('sip:')
            or destination.startswith('/')
            or '@' in destination
        )

    def validate_phone_number(self, phone_number: str) -> bool:
        """
        Basic phone number validation. SIP URIs and Fabric addresses are
        always considered valid since they aren't digit-based.

        Args:
            phone_number: Phone number (or SIP/Fabric address) to validate

        Returns:
            Boolean indicating if the destination appears valid
        """
        if self.is_dial_address(phone_number):
            return len(phone_number.strip()) > 0

        # Remove common formatting characters
        cleaned = ''.join(filter(str.isdigit, phone_number))

        # Check for minimum length (7 digits for local, 10 for US, 11+ for international)
        if len(cleaned) < 7:
            return False

        # Check for maximum reasonable length
        if len(cleaned) > 15:
            return False

        return True

    def format_phone_number(self, phone_number: str) -> str:
        """
        Format phone number for SignalWire. SIP URIs and Fabric addresses
        are returned unchanged.

        Args:
            phone_number: Input phone number (or SIP/Fabric address)

        Returns:
            Formatted phone number with country code, or the original
            SIP/Fabric address
        """
        if self.is_dial_address(phone_number):
            return phone_number.strip()

        # Remove all non-digit characters
        cleaned = ''.join(filter(str.isdigit, phone_number))

        # Add US country code if not present and number is 10 digits
        if len(cleaned) == 10:
            cleaned = '1' + cleaned

        # Add + prefix if not present
        if not cleaned.startswith('+'):
            cleaned = '+' + cleaned

        return cleaned