"""Tests for the government fleet manager API (issue #65).

Covers the pure logic — roster composition and zone resolution — without a
database, matching the existing suite's approach.
"""

from collections import Counter

import pytest

from app.models import VehicleClass
from app.routers.govt import FLOOD_ZONE_DISTRICTS, LAST_MILE_CLASSES, _zone_matches
from app.services.govt_fleet_seed import (
    FLOOD_CORRIDORS,
    LAST_MILE_FLEET_SIZE,
    TRUNK_CORRIDORS,
    TRUNK_FLEET_SIZE,
    _plan,
)


class TestScenarioRoster:
    """§3.2 asks for 50 vehicles split 30 trunk / 20 last-mile."""

    def test_roster_is_fifty_vehicles(self):
        assert len(_plan()) == 50

    def test_split_is_thirty_trunk_twenty_last_mile(self):
        roster = _plan()
        heavy = [r for r in roster if r[1] is VehicleClass.HEAVY_TRUCK]
        last_mile = [r for r in roster if r[1] in LAST_MILE_CLASSES]

        assert len(heavy) == TRUNK_FLEET_SIZE == 30
        assert len(last_mile) == LAST_MILE_FLEET_SIZE == 20

    def test_licence_plates_are_unique(self):
        """Seeding is idempotent on plate, so duplicates would silently
        collapse two vehicles into one."""
        plates = [r[0] for r in _plan()]
        assert len(set(plates)) == len(plates)

    def test_last_mile_fleet_mixes_road_and_water_capability(self):
        classes = {r[1] for r in _plan() if r[1] is not VehicleClass.HEAVY_TRUCK}
        assert VehicleClass.PICKUP_4X4 in classes
        assert VehicleClass.NDRF_BOAT in classes

    def test_every_last_mile_vehicle_targets_a_flood_district(self):
        """The point of the last-mile fleet is flood-zone reach — one landing
        outside the zone would be invisible to ?zone=assam_flood."""
        for plate, vclass, _chassis, _tons, corridor in _plan():
            if vclass is not VehicleClass.HEAVY_TRUCK:
                assert corridor.district in FLOOD_ZONE_DISTRICTS, (
                    f"{plate} targets {corridor.district}, not a flood district"
                )

    def test_trunk_fleet_spreads_across_every_corridor(self):
        counts = Counter(
            r[4].key for r in _plan() if r[1] is VehicleClass.HEAVY_TRUCK
        )
        assert set(counts) == {c.key for c in TRUNK_CORRIDORS}
        # Round-robin, so no corridor may be starved relative to another.
        assert max(counts.values()) - min(counts.values()) <= 1

    def test_at_least_one_trunk_corridor_reaches_the_flood_zone(self):
        """Without this the trunk-to-last-mile handover can never pair up."""
        trunk_districts = {c.district for c in TRUNK_CORRIDORS}
        assert trunk_districts & FLOOD_ZONE_DISTRICTS

    def test_trunk_and_last_mile_agree_on_district_naming(self):
        """Regression: the trunk lane said 'Cachar' while the local lane said
        'Silchar' — the same place under two names, so local_pickup_linked was
        null for every truck."""
        overlap = {c.district for c in TRUNK_CORRIDORS} & {
            c.district for c in FLOOD_CORRIDORS
        }
        assert overlap, "no district is served by both a trunk and a local lane"

    def test_capacities_are_plausible(self):
        for plate, vclass, _chassis, tons, _corridor in _plan():
            assert tons > 0, plate
            if vclass is VehicleClass.HEAVY_TRUCK:
                assert tons >= 10, f"{plate} is a heavy truck carrying {tons}t"
            else:
                assert tons < 10, f"{plate} is last-mile carrying {tons}t"


class TestZoneResolution:
    @pytest.mark.parametrize("zone", [None, "all"])
    def test_absent_or_all_matches_everything(self, zone):
        assert _zone_matches(zone, "Cachar")
        assert _zone_matches(zone, None)

    def test_assam_flood_matches_only_flood_districts(self):
        assert _zone_matches("assam_flood", "Cachar")
        assert not _zone_matches("assam_flood", "Imphal West")

    def test_assam_flood_excludes_unprovisioned_vehicles(self):
        """A vehicle with no target district must not be counted as
        flood-affected."""
        assert not _zone_matches("assam_flood", None)

    def test_unknown_zone_falls_back_to_district_match(self):
        assert _zone_matches("Aizawl", "Aizawl")
        assert _zone_matches("aizawl", "Aizawl")
        assert not _zone_matches("Aizawl", "Cachar")
