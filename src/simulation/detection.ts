import type {
  DisasterType,
  GraphNode,
  Sensor,
  SimEvent,
  SimulationState,
} from "./types/simulation";

import { hazardLevel } from "./routing/pathfinding";


// ============================================================
// SENSOR NETWORK
// ============================================================
//
// Every room, corridor, stair and refuge has a sensor node.
// The response (alarm, LED guidance, routing) only starts
// once a sensor has CONFIRMED the hazard and located it.
// ============================================================


// How long a sensor takes to confirm a fixed hazard
// (smoke building up, water rising past the probe, …).
export const DETECTION_DELAY = 1.5;

// How close (plan units) an intruder must come to a sensor
// on the same floor for it to be detected.
export const THREAT_DETECTION_RADIUS = 110;

// An edge this dangerous puts its sensors into "alert".
const ALERT_LEVEL = 0.45;


// ------------------------------------------------------------
// CREATE
// ------------------------------------------------------------

export function createSensors(nodes: GraphNode[]): Sensor[] {

  return nodes
    .filter((node) => node.type !== "exit")
    .map((node, index) => ({
      id: `S-${String(index + 1).padStart(2, "0")}`,
      nodeId: node.id,
      // Mounted slightly off the node so the icon
      // doesn't sit under the occupants.
      x: node.x + 20,
      y: node.y - 22,
      floor: node.floor,
      status: "idle",
    }));
}


// ------------------------------------------------------------
// WHAT EACH SENSOR CAN SEE RIGHT NOW
// ------------------------------------------------------------

export function updateSensorStatus(
  state: SimulationState,
): Sensor[] {

  if (state.disaster === "normal") {
    return state.sensors.map((s) => ({ ...s, status: "idle" }));
  }

  // Nodes that touch a dangerous edge
  const dangerousNodes = new Set<string>();

  for (const edge of state.edges) {
    if (hazardLevel(edge, state.disaster) >= ALERT_LEVEL) {
      dangerousNodes.add(edge.from);
      dangerousNodes.add(edge.to);
    }
  }

  const sourceNodes =
    new Set(
      state.hazards
        .filter((h) => h.active && h.nodeId)
        .map((h) => h.nodeId as string)
    );

  const threat = state.threat;

  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));

  return state.sensors.map((sensor) => {

    // Moving intruder: proximity detection
    // (measured from the area the sensor covers)
    if (threat) {

      const node = nodeById.get(sensor.nodeId);

      const distance =
        Math.hypot(
          (node?.x ?? sensor.x) - threat.x,
          (node?.y ?? sensor.y) - threat.y
        );

      const near =
        sensor.floor === threat.floor &&
        distance <= THREAT_DETECTION_RADIUS;

      return {
        ...sensor,
        status: near ? (distance < 60 ? "source" : "alert") : "idle",
      };
    }

    // Fixed hazards: only after confirmation
    if (!state.detected) {
      return { ...sensor, status: "idle" };
    }

    if (sourceNodes.has(sensor.nodeId)) {
      return { ...sensor, status: "source" };
    }

    return {
      ...sensor,
      status: dangerousNodes.has(sensor.nodeId) ? "alert" : "idle",
    };
  });
}


// ------------------------------------------------------------
// HAS THE HAZARD BEEN CONFIRMED?
// ------------------------------------------------------------
// Returns the sensor that confirmed it, or null.

export function checkDetection(
  state: SimulationState,
): Sensor | null {

  if (state.detected || state.disaster === "normal") {
    return null;
  }

  // Intruder: the first sensor it walks near
  if (state.threat) {

    const sensors = updateSensorStatus(state);

    return sensors.find((s) => s.status !== "idle") ?? null;
  }

  // Fixed hazard: the sensor at its source, after the delay
  if (state.time - state.scenarioStartedAt < DETECTION_DELAY) {
    return null;
  }

  const source =
    state.hazards.find((h) => h.active && h.nodeId);

  return (
    state.sensors.find((s) => s.nodeId === source?.nodeId) ??
    state.sensors[0] ??
    null
  );
}


// ------------------------------------------------------------
// ALARM TEXT
// ------------------------------------------------------------

const HAZARD_NAMES: Record<DisasterType, string> = {
  normal: "",
  fire: "FIRE",
  flood: "FLOOD",
  chemical: "CHEMICAL LEAK",
  earthquake: "EARTHQUAKE",
  security: "INTRUDER",
};

export function alarmMessageFor(
  state: SimulationState,
): string | null {

  if (state.disaster === "normal") {
    return null;
  }

  if (!state.detected) {
    return null;
  }

  switch (state.disaster) {

    case "fire":
      return "FIRE! EVACUATE NOW — FOLLOW THE GREEN LIGHTS";

    case "flood":
      return "FLOOD! EVACUATE TO HIGHER GROUND";

    case "chemical":
      return "CHEMICAL LEAK! LEAVE THE BUILDING — FOLLOW THE GREEN LIGHTS";

    case "earthquake":
      return "EARTHQUAKE! MOVE TO A SAFE EXIT OR THE PROTECTED REFUGE";

    case "security": {
      if (state.threat?.contained) {
        return `LOCKDOWN — THREAT CONTAINED NEAR ${(state.threat.containedIn ?? "A SEALED ZONE").toUpperCase()}`;
      }
      return "LOCKDOWN! SECURITY THREAT — GO TO A REFUGE OR LEAVE THE BUILDING";
    }

    default:
      return null;
  }
}


// ------------------------------------------------------------
// EVENT LOG HELPERS
// ------------------------------------------------------------

const MAX_EVENTS = 12;

export function logEvent(
  events: SimEvent[],
  time: number,
  text: string,
  level: SimEvent["level"] = "info",
): SimEvent[] {
  return [{ time, text, level }, ...events].slice(0, MAX_EVENTS);
}


export function detectionEvents(
  state: SimulationState,
  sensor: Sensor,
): SimEvent[] {

  const node = state.nodes.find((n) => n.id === sensor.nodeId);

  const where = node?.label ?? sensor.nodeId;

  const name = HAZARD_NAMES[state.disaster];

  let events = state.events;

  events = logEvent(
    events,
    state.time,
    `${sensor.id} detected ${name} at ${where}`,
    "danger"
  );

  if (state.disaster === "security") {
    events = logEvent(events, state.time, "Building entering LOCKDOWN", "danger");
  } else {
    events = logEvent(events, state.time, "Alarm raised — all occupants alerted", "warning");
  }

  events = logEvent(events, state.time, "LED floor guidance activated", "info");

  return events;
}
