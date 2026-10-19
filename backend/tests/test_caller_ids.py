"""GET /api/caller-ids merges the project's purchased numbers with its
verified caller IDs (the two things SignalWire accepts as the caller ID of a
call to a phone number), trimmed to what the picker shows, and keeps serving
one source when the other fails."""
from collections import defaultdict, deque

import pytest

import api.caller_ids as caller_ids
import utils.security as security
from app import app
from utils.signalwire import SignalWireClient

KEY = {'X-API-Key': 'test-key'}

NUMBERS = [
    {'id': 'n2', 'number': '+15550000002', 'name': 'Support', 'capabilities': ['voice'],
     'call_handler': 'relay_context', 'call_relay_context': 'should not be forwarded'},
    {'id': 'n1', 'number': '+15550000001', 'name': 'Main line', 'capabilities': ['voice', 'sms']},
    {'id': 'n3', 'number': '+15550000003', 'name': None, 'capabilities': ['sms']},
]
VERIFIED = [
    {'id': 'v1', 'number': '+15558675309', 'name': "Noah's mobile", 'verified': True, 'status': 'Verified'},
    {'id': 'v2', 'number': '+15550001111', 'name': 'Pending', 'verified': False, 'status': 'Awaiting Verification'},
]


class FakeSignalWire:
    def __init__(self):
        self.calls = {'numbers': 0, 'verified': 0}
        self.fail = set()

    def list_phone_numbers(self):
        self.calls['numbers'] += 1
        if 'numbers' in self.fail:
            raise Exception('401 Unauthorized')
        return list(NUMBERS)

    def list_verified_caller_ids(self):
        self.calls['verified'] += 1
        if 'verified' in self.fail:
            raise Exception('boom')
        return list(VERIFIED)


@pytest.fixture
def api(monkeypatch):
    fake = FakeSignalWire()
    monkeypatch.setattr(caller_ids, 'get_client', lambda: fake)
    monkeypatch.setattr(caller_ids, '_caller_ids_cache', {'data': None, 'expires_at': 0})
    monkeypatch.setattr(security, '_buckets', defaultdict(deque))
    monkeypatch.setenv('DIALER_API_KEY', 'test-key')
    app.config['TESTING'] = True
    return app.test_client(), fake


def test_merges_both_sources_trimmed_and_sorted(api):
    client, _ = api
    response = client.get('/api/caller-ids', headers=KEY)
    assert response.status_code == 200
    body = response.get_json()
    assert body['failed'] == [] and body['total'] == 4
    assert [item['number'] for item in body['data']] == ['+15550000001', '+15550000002', '+15550000003', '+15558675309']
    assert body['data'][0] == {'id': 'n1', 'number': '+15550000001', 'name': 'Main line', 'kind': 'number'}
    assert body['data'][2]['name'] is None
    assert body['data'][3] == {'id': 'v1', 'number': '+15558675309', 'name': "Noah's mobile", 'kind': 'verified'}
    # Only verified entries, and no handler configuration leaks through.
    assert all(set(item) == {'id', 'number', 'name', 'kind'} for item in body['data'])


def test_one_failing_source_still_lists_the_other(api):
    client, fake = api
    fake.fail.add('numbers')
    body = client.get('/api/caller-ids', headers=KEY).get_json()
    assert body['failed'] == ['numbers']
    assert [item['kind'] for item in body['data']] == ['verified']
    # A partial result isn't cached: the next request tries the failed source again.
    fake.fail.clear()
    body = client.get('/api/caller-ids', headers=KEY).get_json()
    assert body['failed'] == [] and body['total'] == 4
    assert fake.calls['numbers'] == 2


def test_both_sources_failing_is_a_generic_500(api):
    client, fake = api
    fake.fail.update({'numbers', 'verified'})
    response = client.get('/api/caller-ids', headers=KEY)
    assert response.status_code == 500
    assert response.get_json() == {'success': False, 'error': 'Failed to list caller IDs'}


def test_complete_results_are_cached(api):
    client, fake = api
    for _ in range(3):
        assert client.get('/api/caller-ids', headers=KEY).status_code == 200
    assert fake.calls == {'numbers': 1, 'verified': 1}


def test_unconfigured_client_is_a_500(api, monkeypatch):
    client, _ = api
    monkeypatch.setattr(caller_ids, 'get_client', lambda: None)
    assert client.get('/api/caller-ids', headers=KEY).status_code == 500


def test_the_client_lists_from_the_relay_rest_base(monkeypatch):
    monkeypatch.setenv('SPACE_NAME', 'example.signalwire.com')
    monkeypatch.setenv('PROJECT_ID', 'project')
    monkeypatch.setenv('AUTH_TOKEN', 'token')
    sw = SignalWireClient()
    assert sw.relay_api_base == 'https://example.signalwire.com/api/relay/rest'
    urls = []
    monkeypatch.setattr(sw, '_get_all_pages', lambda url: urls.append(url) or [])
    sw.list_phone_numbers()
    sw.list_verified_caller_ids()
    assert urls == [
        'https://example.signalwire.com/api/relay/rest/phone_numbers?page_size=1000',
        'https://example.signalwire.com/api/relay/rest/verified_caller_ids',
    ]
