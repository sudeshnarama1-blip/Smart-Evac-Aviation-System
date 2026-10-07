import type {
  DisasterType,
  GraphEdge,
  Door,
  Hazard,
} from "../types/simulation";

import { buildingNodes } from "../building";


// ==========================================
// SCENARIO RESULT
// ==========================================

export interface ScenarioResult {
  disaster: DisasterType;

  hazards: Hazard[];

  edges: GraphEdge[];

  doors: Door[];

  alarmActive: boolean;
}


type HazardField =
  | "smoke"
  | "heat"
  | "water"
  | "chemical"
  | "structuralRisk"
  | "threatRisk";


const nodeById =
  new Map(buildingNodes.map((n) => [n.id, n]));


// ==========================================
// CREATE SCENARIO
// ==========================================

export function createScenario(
  disaster: DisasterType,
  originalEdges: GraphEdge[],
  originalDoors: Door[],
): ScenarioResult {

  // ----------------------------------------
  // RESET EVERYTHING
  // ----------------------------------------

  const edges: GraphEdge[] =
    originalEdges.map((edge) => ({
      ...edge,
      smoke: 0,
      heat: 0,
      water: 0,
      chemical: 0,
      structuralRisk: 0,
      threatRisk: 0,
      available: true,
    }));

  const doors: Door[] =
    originalDoors.map((door) => ({
      ...door,
      state: "open",
    }));

  const hazards: Hazard[] = [];


  // ----------------------------------------
  // HELPERS
  // ----------------------------------------

  // Set a hazard on every edge touching a node
  const around = (
    nodeId: string,
    field: HazardField,
    value: number,
  ) => {
    for (const edge of edges) {
      if (edge.from === nodeId || edge.to === nodeId) {
        edge[field] = Math.max(edge[field], value);
      }
    }
  };

  // Set a hazard on one specific connection
  const between = (
    a: string,
    b: string,
    field: HazardField,
    value: number,
  ) => {
    const edge =
      edges.find(
        (e) =>
          (e.from === a && e.to === b) ||
          (e.from === b && e.to === a)
      );

    if (edge) {
      edge[field] = Math.max(edge[field], value);
    }
  };

  const isolateDoor = (doorId: string) => {
    const door = doors.find((d) => d.id === doorId);
    if (door) {
      door.state = "isolating";
    }
  };

  const result = (alarmActive: boolean): ScenarioResult => ({
    disaster,
    hazards,
    edges,
    doors,
    alarmActive,
  });


  // ========================================
  // NORMAL
  // ========================================

  if (disaster === "normal") {
    return result(false);
  }


  // ========================================
  // FIRE — Room D
  // ========================================
  //
  // Smoke pours out of Room D into the central corridor and
  // reaches Exit B. Room D's corridor door isolates, so its
  // occupants leave through the SOUTH door to Exit E.

  if (disaster === "fire") {

    hazards.push({
      id: "fire-1",
      type: "fire",
      nodeId: "room-d",
      intensity: 1,
      active: true,
    });

    around("room-d", "smoke", 0.9);
    around("room-d", "heat", 0.85);

    // The south door is further from the fire
    between("room-d", "hall-east", "smoke", 0.35);
    between("room-d", "hall-east", "heat", 0.2);

    // Smoke spreads along the central corridor to Exit B
    between("central", "exit-b", "smoke", 0.75);
    between("central", "exit-b", "heat", 0.6);
    between("room-c", "central", "smoke", 0.4);
    between("central", "stair-a", "smoke", 0.3);

    isolateDoor("door-room-d");

    return result(true);
  }


  // ========================================
  // FLOOD — water enters from the west
  // ========================================
  //
  // EVERY ground-floor exit is under water, so nobody goes
  // outside. People climb Stair A / Stair B to the refuges on
  // the upper floors. Water is deepest in the west.

  if (disaster === "flood") {

    hazards.push({
      id: "flood-1",
      type: "flood",
      nodeId: "corridor-west",
      // Starts low and rises over time (see updateSimulation)
      intensity: 0.25,
      active: true,
    });

    for (const edge of edges) {

      const a = nodeById.get(edge.from);
      const b = nodeById.get(edge.to);

      if (!a || !b) {
        continue;
      }

      // Only ground-floor connections get wet
      // (stair flights lead up and out of the water).
      if (a.floor !== 1 || b.floor !== 1) {
        continue;
      }

      const averageX = (a.x + b.x) / 2;

      // 0.9 at the west wall, ≈ 0.4 at the east wall
      edge.water = 0.9 - ((averageX - 50) / 800) * 0.5;

      // All exits flooded — doors held shut by water
      if (a.type === "exit" || b.type === "exit") {
        edge.water = Math.max(edge.water, 0.7);
      }
    }

    return result(true);
  }


  // ========================================
  // CHEMICAL — leak in Room B
  // ========================================
  //
  // The leak drifts west and south, so Exits A and D become
  // unusable. People head east and north instead.

  if (disaster === "chemical") {

    hazards.push({
      id: "chemical-1",
      type: "chemical",
      nodeId: "room-b",
      intensity: 1,
      active: true,
    });

    around("room-b", "chemical", 0.9);

    between("corridor-west", "exit-a", "chemical", 0.65);
    between("hall-south", "exit-d", "chemical", 0.6);
    between("hall-south", "refuge-a", "chemical", 0.4);
    between("corridor-west", "central", "chemical", 0.4);
    between("room-a", "corridor-west", "chemical", 0.3);

    return result(true);
  }


  // ========================================
  // EARTHQUAKE — damage around the central corridor
  // ========================================
  //
  // The central corridor is cracked and Exit B's doorway has
  // collapsed (blocked). Stair flights are unsafe.

  if (disaster === "earthquake") {

    hazards.push({
      id: "earthquake-1",
      type: "earthquake",
      nodeId: "central",
      intensity: 0.9,
      active: true,
    });

    around("central", "structuralRisk", 0.7);

    // Exit B's doorway has collapsed
    between("central", "exit-b", "structuralRisk", 1);

    // Stair flights are not safe after a quake
    for (const edge of edges) {
      const a = nodeById.get(edge.from);
      const b = nodeById.get(edge.to);
      if (a && b && a.floor !== b.floor) {
        edge.structuralRisk = Math.max(edge.structuralRisk, 0.6);
      }
    }

    return result(true);
  }


  // ========================================
  // SECURITY — moving intruder
  // ========================================
  //
  // There is NO fixed threat room. The threat is a moving
  // agent created by the simulation engine; its danger to
  // nearby corridors is recalculated every frame from its
  // live position (see simulationEngine.ts).

  if (disaster === "security") {
    return result(true);
  }


  // ========================================
  // FALLBACK
  // ========================================

  return {
    disaster: "normal",
    hazards: [],
    edges,
    doors,
    alarmActive: false,
  };
}
