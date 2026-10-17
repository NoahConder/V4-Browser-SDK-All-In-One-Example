"""Dial-destination normalization must match the frontend's
(frontend/src/services/signalwire.ts normalizeDestination + utils/address.ts
isDialAddress) -- see CLAUDE.md's "keep in sync" convention. Both sides run
the same fixture: frontend/e2e/fixtures/dial-normalization.json.
"""
import json
import os

import pytest

from utils.signalwire import SignalWireClient

FIXTURE = os.path.join(
    os.path.dirname(__file__), '..', '..', 'frontend', 'e2e', 'fixtures', 'dial-normalization.json'
)

with open(FIXTURE, encoding='utf-8') as f:
    CASES = json.load(f)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('SPACE_NAME', 'example.signalwire.com')
    monkeypatch.setenv('PROJECT_ID', 'project')
    monkeypatch.setenv('AUTH_TOKEN', 'token')
    return SignalWireClient()


@pytest.mark.parametrize('case', CASES, ids=[c['input'] for c in CASES])
def test_format_phone_number_matches_frontend(client, case):
    assert client.format_phone_number(case['input']) == case['expected']


@pytest.mark.parametrize(
    'destination, expected',
    [
        ('sip:bob@example.com', True),
        ('SIP:bob@example.com', True),
        ('/public/room', True),
        ('bob@example.com', True),
        ('5551234567', False),
        ('+1 (555) 123-4567', False),
    ],
)
def test_is_dial_address(destination, expected):
    assert SignalWireClient.is_dial_address(destination) is expected


def test_validate_phone_number_counts_digits(client):
    assert client.validate_phone_number('(555) 123-4567')
    assert client.validate_phone_number('555-1234')
    assert not client.validate_phone_number('555-123')
    assert client.validate_phone_number('/public/room')
