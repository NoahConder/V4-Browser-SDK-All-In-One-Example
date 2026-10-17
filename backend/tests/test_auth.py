"""The token endpoints are the security boundary of this backend: they mint
call-capable SignalWire tokens, so the API-key gate must fail closed, the
client-chosen subscriber id must be validated against the real subscriber
list, and minting must not depend on that list being reachable.

Nothing here talks to SignalWire: the REST client and the subscriber listing
are replaced by fakes bound into api.auth's namespace.
"""
from collections import defaultdict, deque

import pytest

import api.auth as auth
import utils.security as security
from app import app

SUBSCRIBERS = [
    {'id': 'sub-alice', 'subscriber': {'email': 'alice@example.com', 'display_name': 'Alice'}},
    {'id': 'sub-noemail', 'subscriber': {}},
    {'id': 'sub-default', 'subscriber': {'email': 'swdialer', 'first_name': 'Dialer', 'last_name': 'Default'}},
]

KEY = {'X-API-Key': 'test-key'}


class FakeSignalWire:
    def __init__(self):
        self.minted = []
        self.fail_with = None

    def create_subscriber_token(self, reference, expires_in=3600):
        if self.fail_with:
            raise self.fail_with
        self.minted.append(reference)
        return {
            'token': 'sat-token',
            'expires_at': '2026-01-01T01:00:00+00:00',
            'expires_in': expires_in,
            # SignalWire's own id for the token, in a different namespace than
            # GET /resources/subscribers (see auth._resolve_reference).
            'subscriber_id': 'token-namespace-id',
        }

    def refresh_token(self, reference='swdialer', old_token=None):
        return self.create_subscriber_token(reference=reference)


@pytest.fixture
def sw(monkeypatch):
    fake = FakeSignalWire()
    monkeypatch.setattr(auth, 'get_client', lambda: fake)
    monkeypatch.setattr(auth, 'get_subscribers_cached', lambda: list(SUBSCRIBERS))
    return fake


@pytest.fixture
def client(monkeypatch, sw):
    monkeypatch.setenv('DIALER_API_KEY', 'test-key')
    # Fresh rate-limit buckets per test.
    monkeypatch.setattr(security, '_buckets', defaultdict(deque))
    app.config['TESTING'] = True
    return app.test_client()


@pytest.mark.parametrize('path', ['/api/auth/token', '/api/auth/refresh'])
def test_fails_closed_when_api_key_is_not_configured(monkeypatch, client, sw, path):
    monkeypatch.delenv('DIALER_API_KEY')
    assert client.post(path, json={}).status_code == 503
    assert client.post(path, json={}, headers=KEY).status_code == 503
    assert sw.minted == []


def test_rejects_a_missing_or_wrong_key(client, sw):
    assert client.post('/api/auth/token', json={}).status_code == 401
    assert client.post('/api/auth/token', json={}, headers={'X-API-Key': 'wrong'}).status_code == 401
    assert sw.minted == []


def test_mints_the_default_reference_and_resolves_its_resource_id(client, sw):
    response = client.post('/api/auth/token', json={}, headers=KEY)
    assert response.status_code == 200
    data = response.get_json()['data']
    assert sw.minted == ['swdialer']
    assert data['token'] == 'sat-token'
    # The resource id from the subscriber list, not the token response's id.
    assert data['subscriber_id'] == 'sub-default'
    assert data['subscriber_display_name'] == 'Dialer Default'


def test_known_subscriber_id_resolves_to_its_email_reference(client, sw):
    response = client.post('/api/auth/token', json={'subscriber_id': 'sub-alice'}, headers=KEY)
    assert response.status_code == 200
    data = response.get_json()['data']
    assert sw.minted == ['alice@example.com']
    assert data['subscriber_id'] == 'sub-alice'
    assert data['subscriber_display_name'] == 'Alice'


def test_subscriber_without_an_email_uses_its_id_as_the_reference(client, sw):
    response = client.post('/api/auth/token', json={'subscriber_id': 'sub-noemail'}, headers=KEY)
    assert response.status_code == 200
    assert sw.minted == ['sub-noemail']


def test_unknown_subscriber_id_is_rejected_before_minting(client, sw):
    response = client.post('/api/auth/token', json={'subscriber_id': 'not-a-subscriber'}, headers=KEY)
    assert response.status_code == 400
    assert response.get_json()['error'] == 'Unknown subscriber'
    assert sw.minted == []


def test_default_minting_survives_a_subscriber_lookup_failure(monkeypatch, client, sw):
    def boom():
        raise RuntimeError('upstream 502')
    monkeypatch.setattr(auth, 'get_subscribers_cached', boom)

    response = client.post('/api/auth/token', json={}, headers=KEY)
    assert response.status_code == 200
    assert sw.minted == ['swdialer']
    assert response.get_json()['data']['subscriber_display_name'] == 'swdialer'


def test_requested_subscriber_with_a_lookup_failure_is_503_not_500(monkeypatch, client, sw):
    def boom():
        raise RuntimeError('upstream 502')
    monkeypatch.setattr(auth, 'get_subscribers_cached', boom)

    response = client.post('/api/auth/token', json={'subscriber_id': 'sub-alice'}, headers=KEY)
    # 503 (transient) rather than the 400 the frontend treats as "saved
    # subscriber no longer exists" -- that would wipe the saved choice.
    assert response.status_code == 503
    assert response.get_json()['error'] == 'Subscriber lookup unavailable'
    assert sw.minted == []


def test_refresh_mints_for_the_same_subscriber(client, sw):
    response = client.post('/api/auth/refresh', json={'subscriber_id': 'sub-alice'}, headers=KEY)
    assert response.status_code == 200
    assert sw.minted == ['alice@example.com']
    assert response.get_json()['data']['subscriber_id'] == 'sub-alice'


def test_rate_limit_is_per_client_ip(client, sw):
    for _ in range(10):
        assert client.post('/api/auth/token', json={}, headers=KEY).status_code == 200
    assert client.post('/api/auth/token', json={}, headers=KEY).status_code == 429
    # Another address (via the forwarding header a tunnel sets) has its own bucket.
    forwarded = {**KEY, 'X-Forwarded-For': '203.0.113.9'}
    assert client.post('/api/auth/token', json={}, headers=forwarded).status_code == 200


def test_upstream_errors_are_not_leaked_to_the_client(client, sw):
    sw.fail_with = Exception('Failed to create subscriber token: 401 for https://space/api/fabric with AUTH_TOKEN=pt_secret')
    response = client.post('/api/auth/token', json={}, headers=KEY)
    assert response.status_code == 500
    body = response.get_data(as_text=True)
    assert response.get_json()['error'] == 'Failed to generate token'
    assert 'pt_secret' not in body and 'https://' not in body
