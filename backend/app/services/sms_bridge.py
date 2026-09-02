"""NavNER-CP: the pipe-delimited SMS compression protocol (issue #74 §3).

A satellite/SMS link caps a message at 160 characters and carries no image, so
a field report has to fit its critical metadata into that budget. Format:

    NNER|{incident_id}|{type_code}|{severity_code}|{lat}|{lng}|{description}

Example: ``NNER|INC102|LND|C|25.60|91.85|Road washed away`` — 48 characters.

Encoding and decoding both live here so the two ends of the bridge (mobile app,
backend webhook) can be tested against the same reference implementation
rather than two independent re-readings of the issue.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models import IncidentType, RiskLevel

PROTOCOL_PREFIX = "NNER"
FIELD_SEP = "|"

# Full SMS budget is 160 chars; description is truncated to leave headroom for
# a longer incident_id or coordinates with more decimal places than the
# example, without ever risking a payload the carrier splits into two parts.
MAX_PAYLOAD_CHARS = 150

TYPE_CODES: dict[IncidentType, str] = {
    IncidentType.landslide: "LND",
    IncidentType.flood: "FLD",
    IncidentType.bridge_collapse: "BRG",
    IncidentType.road_damage: "RB",
}
CODES_TO_TYPE = {v: k for k, v in TYPE_CODES.items()}

SEVERITY_CODES: dict[RiskLevel, str] = {
    RiskLevel.CRITICAL: "C",
    RiskLevel.HIGH: "H",
    RiskLevel.MODERATE: "M",
    RiskLevel.LOW: "L",
}
CODES_TO_SEVERITY = {v: k for k, v in SEVERITY_CODES.items()}


class SmsDecodeError(ValueError):
    """The payload was not a well-formed NavNER-CP message."""


@dataclass(frozen=True)
class DecodedReport:
    incident_id: str
    incident_type: IncidentType
    severity: RiskLevel
    lat: float
    lng: float
    description: str


def encode_sms_payload(
    *,
    incident_id: str,
    incident_type: IncidentType,
    severity: RiskLevel,
    lat: float,
    lng: float,
    description: str,
) -> str:
    """Build the compressed SMS body a field officer's app would send."""
    type_code = TYPE_CODES[incident_type]
    severity_code = SEVERITY_CODES[severity]

    fixed = f"{PROTOCOL_PREFIX}{FIELD_SEP}{incident_id}{FIELD_SEP}{type_code}{FIELD_SEP}{severity_code}{FIELD_SEP}{lat:.2f}{FIELD_SEP}{lng:.2f}{FIELD_SEP}"
    budget = MAX_PAYLOAD_CHARS - len(fixed)
    # Never truncate mid-multibyte-character or produce a negative slice; a
    # pathologically long incident_id should degrade to an empty description,
    # not raise.
    truncated_desc = description[: max(budget, 0)]
    return fixed + truncated_desc


def decode_nner_cp(body: str) -> DecodedReport:
    """Parse an inbound SMS body. Raises SmsDecodeError on anything malformed.

    A malformed message must never become a half-populated Incident row —
    the caller is expected to reject the whole webhook request on this error,
    which is why every failure raises rather than returning a partial result.
    """
    if not body:
        raise SmsDecodeError("empty message body")

    body = body.strip()
    parts = body.split(FIELD_SEP, 6)  # cap splits so a stray '|' in the
    # description does not shift every field after it

    if len(parts) < 6 or parts[0] != PROTOCOL_PREFIX:
        raise SmsDecodeError(f"not a NavNER-CP payload: {body!r}")

    _, incident_id, type_code, severity_code, lat_raw, lng_raw, *desc_parts = parts
    description = desc_parts[0] if desc_parts else ""

    if not incident_id:
        raise SmsDecodeError("missing incident_id")

    incident_type = CODES_TO_TYPE.get(type_code.upper())
    if incident_type is None:
        raise SmsDecodeError(f"unknown incident type code: {type_code!r}")

    severity = CODES_TO_SEVERITY.get(severity_code.upper())
    if severity is None:
        raise SmsDecodeError(f"unknown severity code: {severity_code!r}")

    try:
        lat = float(lat_raw)
        lng = float(lng_raw)
    except ValueError as exc:
        raise SmsDecodeError(f"invalid coordinates: {lat_raw!r}, {lng_raw!r}") from exc

    # Same bounds PR #10 enforces on the JSON incident endpoint — a malformed
    # or corrupted SMS should not be able to place a marker off the map.
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise SmsDecodeError(f"coordinates out of range: {lat}, {lng}")

    return DecodedReport(
        incident_id=incident_id,
        incident_type=incident_type,
        severity=severity,
        lat=lat,
        lng=lng,
        description=description,
    )
