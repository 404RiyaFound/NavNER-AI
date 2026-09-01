"""Dynamic Graph-Based Rerouting Engine — Stage 3 core routing logic.

Uses NetworkX to build and query a directed weighted graph representing the
NER road network.  Implements the PRD cost function:
    C(e) = ∞                                           if BLOCKED
    C(e) = T_base(e) * (1 + α·R_hazard + β·G_gradient) otherwise

Hyperparameters: α = 3.0 (hazard penalty), β = 1.0 (gradient penalty).
"""

from __future__ import annotations

import logging
import math
from typing import Any

import networkx as nx

logger = logging.getLogger(__name__)

# ── Hyperparameters (from PRD §2) ─────────────────────────────────────────────
ALPHA_HAZARD = 3.0   # Penalty weight for hazard risk
BETA_GRADIENT = 1.0  # Penalty weight for terrain gradient


class DynamicGraphRouter:
    """Builds and queries a directed weighted road network graph.

    The graph is constructed from ``road_network_edges`` rows and supports
    dynamic edge exclusion (blocked roads) and penalty scaling (hazard zones,
    gradient).
    """

    def __init__(self) -> None:
        self.graph: nx.DiGraph = nx.DiGraph()
        self._node_coords: dict[int, tuple[float, float]] = {}  # node_id → (lng, lat)
        self._node_names: dict[int, str] = {}                    # node_id → display name
        self._edge_data: dict[tuple[int, int], dict] = {}        # (src, tgt) → metadata

    # ── Graph Construction ────────────────────────────────────────────────────

    def build_graph(
        self,
        edges: list[dict[str, Any]],
        nodes: dict[int, dict[str, Any]] | None = None,
    ) -> None:
        """Build the directed graph from edge dicts.

        Parameters
        ----------
        edges : list of dict
            Each dict must have keys: edge_id, source_node, target_node,
            road_name, road_class, length_km, base_speed_kmh,
            base_duration_min, is_active, current_status,
            current_hazard_penalty, coordinates (list of [lng, lat]).
        nodes : dict (optional)
            Mapping node_id → {name, lng, lat}.
        """
        self.graph.clear()
        self._edge_data.clear()

        if nodes:
            for nid, info in nodes.items():
                self._node_coords[nid] = (info["lng"], info["lat"])
                self._node_names[nid] = info.get("name", f"Node-{nid}")

        for edge in edges:
            src = edge["source_node"]
            tgt = edge["target_node"]

            # Store coordinates for both endpoints if not already known
            coords = edge.get("coordinates", [])
            if coords and src not in self._node_coords:
                self._node_coords[src] = tuple(coords[0])
            if coords and tgt not in self._node_coords:
                self._node_coords[tgt] = tuple(coords[-1])

            self._edge_data[(src, tgt)] = edge

            # Add edge with base weight
            self.graph.add_edge(
                src, tgt,
                edge_id=edge["edge_id"],
                road_name=edge.get("road_name", ""),
                road_class=edge.get("road_class", ""),
                length_km=edge["length_km"],
                base_duration_min=edge["base_duration_min"],
                base_speed_kmh=edge["base_speed_kmh"],
                is_active=edge.get("is_active", True),
                current_status=edge.get("current_status", "CLEAR"),
                hazard_penalty=edge.get("current_hazard_penalty", 0.0),
                coordinates=coords,
                # Dynamic weight — starts as base, updated by apply_dynamic_costs
                weight=edge["base_duration_min"],
            )

        logger.info(
            "[Router] Graph built — %d nodes, %d edges",
            self.graph.number_of_nodes(),
            self.graph.number_of_edges(),
        )

    # ── Dynamic Cost Application ──────────────────────────────────────────────

    def apply_dynamic_costs(
        self,
        blocked_edge_ids: list[int] | None = None,
        hazard_penalties: dict[int, float] | None = None,
        gradient_factors: dict[int, float] | None = None,
    ) -> dict[str, int]:
        """Apply dynamic cost adjustments to the graph edges.

        Parameters
        ----------
        blocked_edge_ids : list of int
            Edge IDs to completely exclude (set weight → ∞).
        hazard_penalties : dict
            Mapping edge_id → R_hazard ∈ [0, 1] from intersecting H3 cells.
        gradient_factors : dict
            Mapping edge_id → G_gradient ∈ [0, 1] from terrain slope.

        Returns
        -------
        dict with counts: blocked_count, penalised_count
        """
        blocked_ids = set(blocked_edge_ids or [])
        hazard_map = hazard_penalties or {}
        gradient_map = gradient_factors or {}

        blocked_count = 0
        penalised_count = 0

        for u, v, data in self.graph.edges(data=True):
            eid = data["edge_id"]
            base = data["base_duration_min"]

            if eid in blocked_ids or data.get("current_status") == "BLOCKED":
                # Edge fully blocked → infinite cost
                data["weight"] = float("inf")
                blocked_count += 1
                continue

            r_hazard = hazard_map.get(eid, data.get("hazard_penalty", 0.0))
            g_gradient = gradient_map.get(eid, 0.0)

            # PRD cost function: C(e) = T_base * (1 + α·R + β·G)
            cost = base * (1.0 + ALPHA_HAZARD * r_hazard + BETA_GRADIENT * g_gradient)
            data["weight"] = cost

            if r_hazard > 0 or g_gradient > 0:
                penalised_count += 1

        logger.info(
            "[Router] Dynamic costs applied — %d blocked, %d penalised",
            blocked_count, penalised_count,
        )
        return {"blocked_count": blocked_count, "penalised_count": penalised_count}

    # ── Route Computation ─────────────────────────────────────────────────────

    def compute_optimal_route(
        self,
        origin_node: int,
        destination_node: int,
    ) -> dict[str, Any] | None:
        """Compute the shortest (lowest-cost) path between two nodes.

        Returns
        -------
        dict with keys: path_nodes, route_geojson, total_distance_km,
            estimated_duration_min, edge_ids, bypassed_blocked_count
        or None if no path exists.
        """
        if origin_node not in self.graph or destination_node not in self.graph:
            logger.warning("[Router] Origin or destination node not in graph")
            return None

        try:
            path = nx.dijkstra_path(
                self.graph, origin_node, destination_node, weight="weight"
            )
        except nx.NetworkXNoPath:
            logger.warning(
                "[Router] No path from %d to %d", origin_node, destination_node
            )
            return None

        # Collect route metrics
        total_distance = 0.0
        total_duration = 0.0
        edge_ids = []
        all_coords = []
        bypassed = 0

        for i in range(len(path) - 1):
            u, v = path[i], path[i + 1]
            data = self.graph[u][v]
            total_distance += data["length_km"]
            total_duration += data["weight"]
            edge_ids.append(data["edge_id"])

            # Collect coordinates for GeoJSON
            coords = data.get("coordinates", [])
            if coords:
                # Avoid duplicating junction points
                if all_coords and coords[0] == all_coords[-1]:
                    all_coords.extend(coords[1:])
                else:
                    all_coords.extend(coords)

        # If no coordinates available, use node coords
        if not all_coords:
            for nid in path:
                coord = self._node_coords.get(nid)
                if coord:
                    all_coords.append(list(coord))

        # Count how many blocked edges were bypassed
        for u, v, data in self.graph.edges(data=True):
            if data["weight"] == float("inf"):
                bypassed += 1

        route_geojson = {
            "type": "LineString",
            "coordinates": all_coords,
        }

        return {
            "path_nodes": path,
            "route_geojson": route_geojson,
            "total_distance_km": round(total_distance, 2),
            "estimated_duration_min": round(total_duration, 1),
            "edge_ids": edge_ids,
            "bypassed_blocked_count": bypassed,
        }

    # ── Turn-by-Turn Instructions ─────────────────────────────────────────────

    def generate_turn_by_turn(
        self,
        path_nodes: list[int],
    ) -> list[dict[str, Any]]:
        """Generate step-by-step navigation instructions for a path.

        Returns a list of dicts with keys: step, instruction, distance_km.
        """
        instructions = []
        step = 1

        if not path_nodes or len(path_nodes) < 2:
            return instructions

        # First step: depart
        first_edge = self.graph[path_nodes[0]][path_nodes[1]]
        origin_name = self._node_names.get(path_nodes[0], f"Node-{path_nodes[0]}")
        road_name = first_edge.get("road_name", "road")
        instructions.append({
            "step": step,
            "instruction": f"Depart {origin_name} onto {road_name}",
            "distance_km": round(first_edge["length_km"], 1),
        })
        step += 1

        # Intermediate steps
        for i in range(1, len(path_nodes) - 1):
            u, v = path_nodes[i], path_nodes[i + 1]
            edge = self.graph[u][v]
            prev_edge = self.graph[path_nodes[i - 1]][path_nodes[i]]

            node_name = self._node_names.get(u, f"Node-{u}")
            curr_road = edge.get("road_name", "road")
            prev_road = prev_edge.get("road_name", "road")

            # If road changes, note the turn
            if curr_road != prev_road:
                if edge["weight"] == float("inf"):
                    instr = f"⚠️ BLOCKED: {curr_road} near {node_name} — taking alternate"
                elif edge.get("hazard_penalty", 0) > 0.5:
                    instr = f"Reroute bypass: Continue via {curr_road} through {node_name} (hazard zone nearby)"
                else:
                    instr = f"Continue onto {curr_road} through {node_name}"
            else:
                instr = f"Continue on {curr_road} through {node_name}"

            instructions.append({
                "step": step,
                "instruction": instr,
                "distance_km": round(edge["length_km"], 1),
            })
            step += 1

        # Final step: arrive
        dest_name = self._node_names.get(path_nodes[-1], f"Node-{path_nodes[-1]}")
        instructions.append({
            "step": step,
            "instruction": f"Arrive at {dest_name}",
            "distance_km": 0.0,
        })

        return instructions

    # ── Nearest Node Lookup ───────────────────────────────────────────────────

    def find_nearest_node(self, lng: float, lat: float) -> int | None:
        """Find the graph node nearest to the given coordinates.

        Uses simple Euclidean distance (sufficient for regional routing).
        """
        best_node = None
        best_dist = float("inf")

        for nid, (nlng, nlat) in self._node_coords.items():
            d = math.hypot(lng - nlng, lat - nlat)
            if d < best_dist:
                best_dist = d
                best_node = nid

        return best_node

    # ── Utility ───────────────────────────────────────────────────────────────

    @property
    def node_count(self) -> int:
        return self.graph.number_of_nodes()

    @property
    def edge_count(self) -> int:
        return self.graph.number_of_edges()

    def get_node_name(self, node_id: int) -> str:
        return self._node_names.get(node_id, f"Node-{node_id}")

    def get_node_coords(self, node_id: int) -> tuple[float, float] | None:
        return self._node_coords.get(node_id)
