"""Every /api route is gated (utils/security.gate), the listing endpoints
page within bounds, filter by `q` before paging and only fetch addresses for
the requested page, the subscriber listing is trimmed to its public shape, and
the call-log blueprint is down to the one POST the frontend uses.
"""
from collections import defaultdict, deque

import pytest

import api.auth as auth
import api.calls as calls
import api.sip_credentials as sip
import api.subscribers as subscribers
import api.swml as swml
import utils.security as security
from app import app
from utils.signalwire import SignalWireClient

KEY = {'X-API-Key': 'test-key'}

# Seven scripts, three of them matching "ivr" (s0, s1, s5).
SCRIPT_NAMES = ['Main IVR', 'Sales IVR', 'Support Queue', 'After Hours', 'Voicemail', 'ivr-test', 'Echo']

# (method, path, body that passes the route's own validation)
GATED_ROUTES = [
    ('GET', '/api/swml/scripts', None),
    ('GET', '/api/sip/credentials', None),
    ('GET', '/api/subscribers', None),
    ('POST', '/api/calls/dial', {'to': '5551234567'}),
    ('POST', '/api/auth/token', {}),
    ('POST', '/api/auth/refresh', {}),
]


class FakeSignalWire:
    """Resource listings only; the token path has its own fake in test_auth."""

    def __init__(self):
        self.address_calls = []

    def list_swml_scripts(self):
        return [{'id': f's{i}', 'display_name': name, 'script_type': 'swml'} for i, name in enumerate(SCRIPT_NAMES)]

    def list_swml_script_addresses(self, script_id):
        self.address_calls.append(script_id)
        return [{'id': f'{script_id}-addr', 'name': script_id, 'display_name': script_id.upper(),
                 'channels': {'audio': f'/public/{script_id}?channel=audio'}}]

    def list_sip_credentials(self):
        return [{'id': 'cred-1', 'display_name': 'Alice Desk', 'sip_endpoint': {'username': 'alice-sip'}},
                {'id': 'cred-2', 'display_name': 'Bob Desk', 'sip_endpoint': {'username': 'bob-sip'}}]

    def list_sip_credential_addresses(self, credential_id):
        self.address_calls.append(credential_id)
        return []

    def list_subscribers(self):
        return [{'id': 'sub-alice', 'display_name': None,
                 'subscriber': {'email': 'alice@example.com', 'display_name': 'Alice',
                                'job_title': 'should not be forwarded', 'timezone': 'UTC'}}]

    def list_subscriber_addresses(self, subscriber_id):
        return [{'id': 'addr-1', 'name': 'alice', 'display_name': 'Alice', 'resource_id': subscriber_id,
                 'channels': {'audio': '/private/alice?channel=audio', 'video': '/private/alice?channel=video'}}]

    def create_subscriber_token(self, reference, expires_in=3600):
        return {'token': 't', 'expires_at': '2026-01-01T00:00:00+00:00', 'subscriber_id': 'x'}

    def refresh_token(self, reference='swdialer', old_token=None):
        return self.create_subscriber_token(reference)


@pytest.fixture
def api(monkeypatch):
    fake = FakeSignalWire()
    for module in (swml, sip, subscribers, auth):
        monkeypatch.setattr(module, 'get_client', lambda: fake)
    # /api/calls/dial normalizes with the real client's rules.
    monkeypatch.setenv('SPACE_NAME', 'example.signalwire.com')
    monkeypatch.setenv('PROJECT_ID', 'project')
    monkeypatch.setenv('AUTH_TOKEN', 'token')
    monkeypatch.setattr(calls, 'get_client', lambda: SignalWireClient())
    monkeypatch.setattr(auth, 'get_subscribers_cached', lambda: [])
    # Fresh caches and rate-limit buckets per test.
    monkeypatch.setattr(swml, '_scripts_meta_cache', {'data': None, 'expires_at': 0})
    monkeypatch.setattr(sip, '_credentials_meta_cache', {'data': None, 'expires_at': 0})
    monkeypatch.setattr(subscribers, '_subscribers_cache', {'data': None, 'expires_at': 0})
    monkeypatch.setattr(security, '_buckets', defaultdict(deque))
    monkeypatch.setenv('DIALER_API_KEY', 'test-key')
    app.config['TESTING'] = True
    return app.test_client(), fake


@pytest.mark.parametrize('method, path, body', GATED_ROUTES)
def test_every_api_route_requires_the_key(api, method, path, body):
    client, _ = api
    assert client.open(path, method=method, json=body).status_code == 401
    assert client.open(path, method=method, json=body, headers={'X-API-Key': 'wrong'}).status_code == 401
    assert client.open(path, method=method, json=body, headers=KEY).status_code == 200


@pytest.mark.parametrize('method, path, body', GATED_ROUTES)
def test_every_api_route_fails_closed_without_a_configured_key(monkeypatch, api, method, path, body):
    client, _ = api
    monkeypatch.delenv('DIALER_API_KEY')
    assert client.open(path, method=method, json=body, headers=KEY).status_code == 503


def test_listing_pages_within_bounds_and_fetches_addresses_only_for_the_page(api):
    client, fake = api
    response = client.get('/api/swml/scripts?offset=2&limit=3', headers=KEY)
    assert response.status_code == 200
    body = response.get_json()
    assert [script['id'] for script in body['data']] == ['s2', 's3', 's4']
    assert body['total'] == 7 and body['has_more'] is True
    assert body['data'][0]['addresses'][0]['channels']['audio'] == '/public/s2?channel=audio'
    # One address call per item on the page, none for the rest of the space.
    assert sorted(fake.address_calls) == ['s2', 's3', 's4']


def test_page_parameters_are_clamped(api):
    client, _ = api
    body = client.get('/api/swml/scripts?offset=-5&limit=500', headers=KEY).get_json()
    assert (body['offset'], body['limit']) == (0, security.MAX_PAGE_LIMIT)
    # 0 (and anything unparseable) falls back to the default page size;
    # a negative limit clamps up to 1.
    body = client.get('/api/swml/scripts?limit=0', headers=KEY).get_json()
    assert body['limit'] == 10
    body = client.get('/api/swml/scripts?limit=-3', headers=KEY).get_json()
    assert body['limit'] == 1
    body = client.get('/api/swml/scripts?offset=100', headers=KEY).get_json()
    assert body['data'] == [] and body['has_more'] is False


def test_sip_credentials_keep_the_dial_username(api):
    client, _ = api
    body = client.get('/api/sip/credentials', headers=KEY).get_json()
    assert len(body['data']) == 2
    assert body['data'][0] == {'id': 'cred-1', 'display_name': 'Alice Desk',
                               'sip_endpoint': {'username': 'alice-sip'}, 'addresses': []}


def test_search_filters_before_paging_and_fetches_addresses_only_for_the_matches(api):
    client, fake = api
    body = client.get('/api/swml/scripts?q=ivr&limit=2', headers=KEY).get_json()
    assert [script['id'] for script in body['data']] == ['s0', 's1']
    assert body['total'] == 3 and body['has_more'] is True
    assert sorted(fake.address_calls) == ['s0', 's1']
    # The next page is relative to the filtered list, not the whole space.
    body = client.get('/api/swml/scripts?q=ivr&offset=2&limit=2', headers=KEY).get_json()
    assert [script['id'] for script in body['data']] == ['s5']
    assert body['has_more'] is False


@pytest.mark.parametrize('q', ['IVR', ' ivr ', 'Ivr'])
def test_search_is_case_insensitive_and_trimmed(api, q):
    client, _ = api
    assert client.get('/api/swml/scripts', query_string={'q': q}, headers=KEY).get_json()['total'] == 3


def test_blank_oversized_and_unmatched_searches(api):
    client, fake = api
    assert client.get('/api/swml/scripts?q=%20%20', headers=KEY).get_json()['total'] == 7
    fake.address_calls.clear()
    body = client.get('/api/swml/scripts?q=zzz', headers=KEY).get_json()
    assert body['data'] == [] and body['total'] == 0 and body['has_more'] is False
    assert fake.address_calls == []
    # An oversized value is truncated, not rejected.
    assert client.get('/api/swml/scripts?q=' + 'a' * 500, headers=KEY).status_code == 200


def test_sip_search_matches_display_name_and_username(api):
    client, fake = api
    body = client.get('/api/sip/credentials?q=bob', headers=KEY).get_json()
    assert [credential['id'] for credential in body['data']] == ['cred-2']
    assert fake.address_calls == ['cred-2']
    assert client.get('/api/sip/credentials?q=desk', headers=KEY).get_json()['total'] == 2


def test_subscribers_are_trimmed_to_the_public_shape(api):
    client, _ = api
    body = client.get('/api/subscribers', headers=KEY).get_json()
    [entry] = body['data']
    assert set(entry) == {'id', 'display_name', 'email', 'addresses'}
    assert entry['display_name'] == 'Alice' and entry['email'] == 'alice@example.com'
    [address] = entry['addresses']
    assert set(address) == {'id', 'name', 'display_name', 'channels'}
    assert address['channels']['video'] == '/private/alice?channel=video'


def test_listing_rate_limit_is_separate_from_other_scopes(api):
    client, _ = api
    for _ in range(30):
        assert client.get('/api/sip/credentials', headers=KEY).status_code == 200
    assert client.get('/api/sip/credentials', headers=KEY).status_code == 429
    assert client.get('/api/subscribers', headers=KEY).status_code == 200


def test_dial_log_validates_and_normalizes_the_destination(api):
    client, _ = api
    response = client.post('/api/calls/dial', json={'to': '(555) 123-4567'}, headers=KEY)
    assert response.status_code == 200
    data = response.get_json()['data']
    assert data['to'] == '+15551234567' and data['direction'] == 'outbound' and data['from'] == 'WebDialer'

    assert client.post('/api/calls/dial', json={'to': '/public/room'}, headers=KEY).get_json()['data']['to'] == '/public/room'
    assert client.post('/api/calls/dial', json={}, headers=KEY).status_code == 400
    assert client.post('/api/calls/dial', json={'to': 12345}, headers=KEY).status_code == 400
    assert client.post('/api/calls/dial', json={'to': '12'}, headers=KEY).status_code == 400


@pytest.mark.parametrize('path', ['/api/calls/history', '/api/calls/active', '/api/calls/status/abc'])
def test_the_call_log_readers_are_gone(api, path):
    client, _ = api
    assert client.get(path, headers=KEY).status_code == 404
    assert client.post('/api/calls/end/abc', headers=KEY).status_code == 404
