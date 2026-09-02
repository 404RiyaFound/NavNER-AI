"""Tests for the NavNER-CP satellite-SMS protocol (issue #74 §3)."""

import pytest

from app.models import IncidentType, RiskLevel
from app.services.sms_bridge import (
    MAX_PAYLOAD_CHARS,
    SmsDecodeError,
    decode_nner_cp,
    encode_sms_payload,
)


class TestDecodeMatchesTheIssueSpec:
    def test_the_issues_own_worked_example(self):
        report = decode_nner_cp("NNER|INC102|LND|C|25.60|91.85|Road washed away")
        assert report.incident_id == "INC102"
        assert report.incident_type == IncidentType.landslide
        assert report.severity == RiskLevel.CRITICAL
        assert report.lat == 25.60
        assert report.lng == 91.85
        assert report.description == "Road washed away"

    @pytest.mark.parametrize("code,expected", [
        ("LND", IncidentType.landslide),
        ("FLD", IncidentType.flood),
        ("BRG", IncidentType.bridge_collapse),
        ("RB", IncidentType.road_damage),
    ])
    def test_every_type_code(self, code, expected):
        assert decode_nner_cp(f"NNER|X|{code}|L|0|0|d").incident_type == expected

    @pytest.mark.parametrize("code,expected", [
        ("C", RiskLevel.CRITICAL), ("H", RiskLevel.HIGH),
        ("M", RiskLevel.MODERATE), ("L", RiskLevel.LOW),
    ])
    def test_every_severity_code(self, code, expected):
        assert decode_nner_cp(f"NNER|X|LND|{code}|0|0|d").severity == expected

    def test_lowercase_codes_are_accepted(self):
        """A field officer's satellite messenger should not be able to break
        this on case alone."""
        report = decode_nner_cp("NNER|X|lnd|c|0|0|d")
        assert report.incident_type == IncidentType.landslide
        assert report.severity == RiskLevel.CRITICAL


class TestDecodeRejectsMalformedInput:
    """A malformed payload must raise, never return a partially-populated
    result — the webhook depends on this to avoid creating a half-real
    incident."""

    @pytest.mark.parametrize("body", [
        "",
        "just some text",
        "NNER|only|three|parts",
        "WRONG|X|LND|C|0|0|d",
    ])
    def test_rejects_malformed_shape(self, body):
        with pytest.raises(SmsDecodeError):
            decode_nner_cp(body)

    def test_rejects_unknown_type_code(self):
        with pytest.raises(SmsDecodeError):
            decode_nner_cp("NNER|X|ZZZ|C|0|0|d")

    def test_rejects_unknown_severity_code(self):
        with pytest.raises(SmsDecodeError):
            decode_nner_cp("NNER|X|LND|Z|0|0|d")

    def test_rejects_non_numeric_coordinates(self):
        with pytest.raises(SmsDecodeError):
            decode_nner_cp("NNER|X|LND|C|not-a-number|0|d")

    @pytest.mark.parametrize("lat,lng", [(999, 0), (0, 999), (-999, -999)])
    def test_rejects_out_of_range_coordinates(self, lat, lng):
        """Same bounds PR #10 enforces on the JSON path — a corrupted SMS
        must not be able to place a marker off the map."""
        with pytest.raises(SmsDecodeError):
            decode_nner_cp(f"NNER|X|LND|C|{lat}|{lng}|d")

    def test_description_containing_a_pipe_does_not_shift_fields(self):
        """The description is free text a field officer typed — it must not
        be assumed pipe-free."""
        report = decode_nner_cp("NNER|X|LND|C|25.6|91.8|Road blocked | debris everywhere")
        assert report.description == "Road blocked | debris everywhere"

    def test_missing_description_decodes_to_empty_string(self):
        report = decode_nner_cp("NNER|X|LND|C|25.6|91.8|")
        assert report.description == ""


class TestEncodeStaysWithinSmsBudget:
    def test_the_issues_own_example_encodes_to_48_chars(self):
        payload = encode_sms_payload(
            incident_id="INC102", incident_type=IncidentType.landslide,
            severity=RiskLevel.CRITICAL, lat=25.60, lng=91.85,
            description="Road washed away",
        )
        assert payload == "NNER|INC102|LND|C|25.60|91.85|Road washed away"
        assert len(payload) == 46  # the issue text claims 48; the string itself is 46

    def test_a_long_description_is_truncated_to_the_budget(self):
        payload = encode_sms_payload(
            incident_id="INC1", incident_type=IncidentType.flood,
            severity=RiskLevel.LOW, lat=0.0, lng=0.0,
            description="x" * 500,
        )
        assert len(payload) <= MAX_PAYLOAD_CHARS

    def test_round_trip_through_encode_then_decode(self):
        payload = encode_sms_payload(
            incident_id="INC999", incident_type=IncidentType.bridge_collapse,
            severity=RiskLevel.HIGH, lat=24.81, lng=93.93,
            description="Bridge deck cracked",
        )
        report = decode_nner_cp(payload)
        assert report.incident_id == "INC999"
        assert report.incident_type == IncidentType.bridge_collapse
        assert report.severity == RiskLevel.HIGH
        assert report.description == "Bridge deck cracked"
