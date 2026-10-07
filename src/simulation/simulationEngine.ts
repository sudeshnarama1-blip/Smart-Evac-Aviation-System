import type {
  SimulationState,
  Person,
  PersonType,
  DisasterType,
  GraphNode,
} from "./types/simulation";

import {
  buildingNodes,
  buildingEdges,
  buildingDoors,
} from "./building";

import { findRoute } from "./routing/pathfinding";

import { createScenario } from "./scenarios/scenarioEngine";

import {
  alarmMessageFor,
  checkDetection,
  createSensors,
  detectionEvents,
  logEvent,
  updateSensorStatus,
} from "./detection";

import {
  LOCK_INTERVAL,
  applyThreatRisk,
  createThreat,
  isThreatContained,
  sealZone,
  lockNextDoor,
  moveThreat,
  startLockdown,
} from "./security";


// ==========================================
// SETTINGS
// ==========================================

// Walking speed in building units per second
// (the building is about 800 units wide).
const BASE_WALK_SPEED = 90;

// How fast flood water rises per second (0 → 1).
const FLOOD_RISE_RATE = 0.025;

// How long one flight of stairs is to walk, in plan units
// (so climbing takes a realistic amount of time).
const FLOOR_TRAVEL_UNITS = 160;

// During a security threat, routes are recalculated this
// often (seconds) so people keep steering away from it.
const SECURITY_REROUTE_INTERVAL = 1;


// ==========================================
// HELPERS
// ==========================================

function getNode(
  nodes: GraphNode[],
  id: string,
): GraphNode | undefined {

  return nodes.find(
    (node) => node.id === id
  );
}


// ==========================================
// INITIAL PEOPLE
// ==========================================

// Every person starts EXACTLY on their room's
// node position, so x/y and nodeId always agree.

const peopleSetup: {
  id: string;
  nodeId: string;
  speed: number;
  type: PersonType;
}[] = [
  { id: "person-01", nodeId: "room-a",      speed: 1,    type: "adult" },
  { id: "person-02", nodeId: "room-a",      speed: 0.9,  type: "adult" },
  { id: "person-03", nodeId: "room-b",      speed: 0.6,  type: "elderly" },
  { id: "person-04", nodeId: "room-b",      speed: 0.85, type: "child" },
  { id: "person-05", nodeId: "room-c",      speed: 1,    type: "adult" },
  { id: "person-06", nodeId: "room-c",      speed: 0.7,  type: "wheelchair" },
  { id: "person-07", nodeId: "room-d",      speed: 1,    type: "adult" },
  { id: "person-08", nodeId: "room-d",      speed: 0.9,  type: "adult" },
  { id: "person-09", nodeId: "central",     speed: 1,    type: "adult" },
  { id: "person-10", nodeId: "central",     speed: 1.1,  type: "responder" },
  { id: "person-11", nodeId: "hall-south",  speed: 1,    type: "adult" },
  { id: "person-12", nodeId: "lobby-north", speed: 0.95, type: "adult" },
  { id: "person-13", nodeId: "hall-2",      speed: 1,    type: "adult" },
  { id: "person-14", nodeId: "hall-3-west", speed: 0.8,  type: "elderly" },
];


function createPeople(): Person[] {

  return peopleSetup.map((setup) => {

    const node =
      getNode(
        buildingNodes,
        setup.nodeId
      );

    return {
      id: setup.id,
      nodeId: setup.nodeId,
      destinationId: setup.nodeId,
      speed: setup.speed,
      state: "normal",
      type: setup.type,
      route: [],
      routeIndex: 0,
      x: node?.x ?? 0,
      y: node?.y ?? 0,
      z: node?.floor ?? 1,
    };
  });
}


// ==========================================
// INITIAL SIMULATION
// ==========================================

export function createInitialSimulation(): SimulationState {

  return {
    time: 0,

    disaster: "normal",

    nodes: buildingNodes,

    edges: buildingEdges,

    doors: buildingDoors,

    people: createPeople(),

    hazards: [],

    alarmActive: false,

    simulationRunning: false,

    sensors: createSensors(buildingNodes),

    detected: false,

    scenarioStartedAt: 0,

    alarmMessage: null,

    lockdown: false,

    threat: null,

    events: [
      {
        time: 0,
        text: "Sensor network online — monitoring",
        level: "info",
      },
    ],

    lastRerouteAt: 0,

    lastLockAt: 0,
  };
}


// ==========================================
// WHERE IS "SAFE" FOR EACH HAZARD?
// ==========================================
//
//   FIRE / CHEMICAL → leave through a safe exit
//   SECURITY   → leave, or shelter in a sealed refuge
//   EARTHQUAKE → a safe exit, or the protected ground refuge
//                (never upstairs during a quake)
//   FLOOD      → go UP: refuges on floor 2 or higher
//                (ground-floor exits may be under water)

function getSafeTargets(
  disaster: DisasterType,
  nodes: GraphNode[],
): GraphNode[] {

  if (disaster === "flood") {
    return nodes.filter(
      (node) => node.type === "refuge" && node.floor >= 2
    );
  }

  if (disaster === "earthquake") {
    return nodes.filter(
      (node) =>
        node.type === "exit" ||
        (node.type === "refuge" && node.floor === 1)
    );
  }

  // SECURITY → leave the building OR shelter in any
  // (sealed) refuge — whichever is safer and closer.
  if (disaster === "security") {
    return nodes.filter(
      (node) => node.type === "exit" || node.type === "refuge"
    );
  }

  return nodes.filter((node) => node.type === "exit");
}


// Cheapest reachable route from a person to any of the targets.
function bestRouteTo(
  person: Person,
  targets: GraphNode[],
  state: SimulationState,
): { path: string[]; cost: number; target: string } | null {

  let best: { path: string[]; cost: number; target: string } | null = null;

  for (const target of targets) {

    const result =
      findRoute(
        person.nodeId,
        target.id,
        state.nodes,
        state.edges,
        state.doors,
        state.disaster,
        person
      );

    if (
      result.reachable &&
      (best === null || result.cost < best.cost)
    ) {
      best = {
        path: result.path,
        cost: result.cost,
        target: target.id,
      };
    }
  }

  return best;
}


// ==========================================
// CALCULATE ROUTE FOR PERSON
// ==========================================

export function calculatePersonRoute(
  person: Person,
  state: SimulationState,
): Person {

  // Already OUTSIDE the building — leave them alone.
  // (People sheltering in a refuge are re-checked, because a
  // refuge that suits one hazard may not suit the next.)
  if (
    person.state === "safe" &&
    state.nodes.find((n) => n.id === person.nodeId)?.type === "exit"
  ) {
    return person;
  }


  // Already in a refuge that is still a valid target?
  // Then they simply stay put.
  const targets = getSafeTargets(state.disaster, state.nodes);

  if (targets.some((t) => t.id === person.nodeId)) {
    return {
      ...person,
      destinationId: person.nodeId,
      route: [person.nodeId],
      routeIndex: 0,
      state: "safe",
    };
  }


  // A* to every safe target; keep the cheapest.
  const best = bestRouteTo(person, targets, state);

  if (best) {
    return {
      ...person,
      destinationId: best.target,
      route: best.path,
      routeIndex: 0,
      state: "evacuating",
    };
  }


  // No safe target reachable. Someone who can't use stairs
  // goes to the nearest stair LANDING and waits there for
  // assisted evacuation (that is what refuge landings are for).
  if (person.type === "wheelchair") {

    const landings =
      state.nodes.filter(
        (node) =>
          node.type === "stair" &&
          node.floor === state.nodes.find((n) => n.id === person.nodeId)?.floor
      );

    const landing = bestRouteTo(person, landings, state);

    if (landing) {
      return {
        ...person,
        destinationId: landing.target,
        route: landing.path,
        routeIndex: 0,
        state: "evacuating",
      };
    }
  }


  return {
    ...person,

    state:
      state.disaster === "security"
        ? "avoiding"
        : "trapped",

    route: [],
    routeIndex: 0,
  };
}


// ==========================================
// RECALCULATE ALL PEOPLE
// ==========================================

export function recalculateRoutes(
  state: SimulationState,
): SimulationState {

  return {
    ...state,

    people:
      state.people.map(
        (person) =>
          calculatePersonRoute(
            person,
            state
          )
      ),
  };
}


// ==========================================
// ACTIVATE DISASTER
// ==========================================
//
// Starting a scenario does NOT tell anyone to move yet.
// The hazard starts, the sensors have to find it, and only
// then does the alarm sound and the evacuation begin.

export function activateDisaster(
  disaster: DisasterType,
  state: SimulationState,
): SimulationState {

  const fresh = createInitialSimulation();

  // "Normal" = stand down. Everyone back to their
  // starting positions, nobody moves.
  if (disaster === "normal") {
    return {
      ...fresh,
      simulationRunning: state.simulationRunning,
      events: logEvent(
        fresh.events,
        0,
        "Stand down — normal operations",
        "success"
      ),
    };
  }


  const scenario =
    createScenario(
      disaster,
      buildingEdges,
      buildingDoors
    );

  const threat =
    disaster === "security" ? createThreat(buildingNodes) : null;


  return {
    ...fresh,

    disaster: scenario.disaster,

    edges: applyThreatRisk(scenario.edges, threat),

    doors: scenario.doors,

    hazards: scenario.hazards,

    threat,

    // Not yet — the sensors have to confirm it first.
    alarmActive: false,
    detected: false,

    // Start immediately.
    simulationRunning: true,

    events: logEvent(
      fresh.events,
      0,
      "Sensor anomaly — verifying…",
      "warning"
    ),
  };
}


// ==========================================
// RESET SIMULATION
// ==========================================

export function resetSimulation(): SimulationState {

  return createInitialSimulation();
}


// ==========================================
// MOVE ONE PERSON
// ==========================================

// People walk smoothly along their route,
// node by node. x/y is ALWAYS the real
// position; nodeId is the last node reached.

function movePerson(
  person: Person,
  state: SimulationState,
  deltaTime: number,
): Person {

  if (
    person.state !== "evacuating" ||
    person.route.length === 0
  ) {
    return person;
  }


  let { x, y, z, routeIndex, nodeId } = person;

  // Distance this person can cover this frame
  let budget =
    person.speed *
    BASE_WALK_SPEED *
    deltaTime *
    (person.z % 1 !== 0 ? 0.6 : 1); // slower on stairs


  // Spend the budget across as many route
  // segments as needed (no stalling at nodes).

  while (budget > 0) {

    // Reached the final node of the route.
    if (routeIndex >= person.route.length - 1) {

      const finalNode =
        getNode(
          state.nodes,
          person.route[person.route.length - 1]
        );

      // Arriving at a stair landing (rather than an exit or
      // refuge) means "waiting for assisted evacuation".
      const arrivedState =
        finalNode?.type === "stair" ? "waiting" : "safe";

      return {
        ...person,
        x: finalNode?.x ?? x,
        y: finalNode?.y ?? y,
        z: finalNode?.floor ?? z,
        nodeId: finalNode?.id ?? nodeId,
        routeIndex,
        state: arrivedState,
      };
    }


    const nextNode =
      getNode(
        state.nodes,
        person.route[routeIndex + 1]
      );

    if (!nextNode) {
      break;
    }


    // Distance in 3D: a flight of stairs counts as
    // FLOOR_TRAVEL_UNITS of walking.
    const dx = nextNode.x - x;
    const dy = nextNode.y - y;
    const dz = (nextNode.floor - z) * FLOOR_TRAVEL_UNITS;

    const distance =
      Math.hypot(dx, dy, dz);


    if (distance <= budget) {

      // Arrive at the next node and keep going
      x = nextNode.x;
      y = nextNode.y;
      z = nextNode.floor;

      nodeId = nextNode.id;

      routeIndex += 1;

      budget -= distance;

    } else {

      // Partway along the segment
      const fraction = budget / distance;

      x += dx * fraction;
      y += dy * fraction;
      z += (dz / FLOOR_TRAVEL_UNITS) * fraction;

      budget = 0;
    }
  }


  return {
    ...person,
    x,
    y,
    z,
    nodeId,
    routeIndex,
  };
}


// ==========================================
// RE-ROUTE ONE PERSON (while they are walking)
// ==========================================
//
// If someone is halfway down a corridor and their new route
// sends them a different way, they first walk BACK to the
// node they came from — they never cut through walls.

function rerouteWhileWalking(
  person: Person,
  state: SimulationState,
): Person {

  if (person.state !== "evacuating" && person.state !== "avoiding") {
    return person;
  }

  const updated = calculatePersonRoute(person, state);

  if (updated.route.length < 2) {
    return updated;
  }

  const oldRest = person.route.slice(person.routeIndex).join(">");
  const newRest = updated.route.join(">");

  // Same plan as before — keep walking undisturbed.
  if (oldRest === newRest) {
    return person;
  }

  const node = state.nodes.find((n) => n.id === person.nodeId);

  const midEdge =
    node && Math.hypot(node.x - person.x, node.y - person.y) > 1;

  const oldNext = person.route[person.routeIndex + 1];

  // Still heading the same way: just swap in the new plan.
  if (!midEdge || updated.route[1] === oldNext) {
    return updated;
  }

  // Turn round: walk back to the last node, then follow
  // the new route from there.
  return {
    ...updated,
    route: [oldNext ?? person.nodeId, ...updated.route],
    routeIndex: 0,
  };
}


// ==========================================
// UPDATE SIMULATION (one frame)
// ==========================================

export function updateSimulation(
  previous: SimulationState,
  deltaTime: number,
): SimulationState {

  if (!previous.simulationRunning) {
    return previous;
  }

  let state: SimulationState = {
    ...previous,
    time: previous.time + deltaTime,
  };


  // ---------- 1. Flood water keeps rising ----------

  state.hazards =
    state.hazards.map((hazard) =>
      hazard.type === "flood"
        ? {
            ...hazard,
            intensity:
              Math.min(
                1,
                hazard.intensity + FLOOD_RISE_RATE * deltaTime
              ),
          }
        : hazard
    );


  // ---------- 2. The security threat moves ----------

  if (state.threat) {
    state.threat = moveThreat(state, deltaTime);
    state.edges = applyThreatRisk(state.edges, state.threat);
  }


  // ---------- 3. Sensors look for the hazard ----------

  if (!state.detected) {

    const sensor = checkDetection(state);

    if (sensor) {

      state = {
        ...state,
        detected: true,
        alarmActive: true,
        events: detectionEvents(state, sensor),
      };

      // Security → lockdown: refuges seal immediately
      if (state.disaster === "security") {

        const lockdown = startLockdown(state);

        state = {
          ...state,
          lockdown: true,
          doors: lockdown.doors,
          events: lockdown.events,
          // First door locks right away
          lastLockAt: state.time - LOCK_INTERVAL,
        };
      }

      // Everyone gets a route now
      state = recalculateRoutes(state);

      state.lastRerouteAt = state.time;
    }
  }


  // ---------- 4. Lockdown: lock doors around the threat ----------

  if (state.lockdown && state.threat) {

    // One door per interval, cutting off its path,
    // until it can no longer reach anyone.
    if (
      !state.threat.contained &&
      state.time - state.lastLockAt >= LOCK_INTERVAL
    ) {

      const result = lockNextDoor(state);

      if (result.locked) {
        state = {
          ...state,
          doors: result.doors,
          events: result.events,
          lastLockAt: state.time,
        };
      }
    }

    const threat = state.threat;

    if (threat && !threat.contained && isThreatContained(state)) {

      const node =
        state.nodes.find((n) => n.id === threat.nodeId);

      const sealed = sealZone(state);

      state.threat = {
        ...threat,
        contained: true,
        containedIn: node?.label ?? "a sealed zone",
        zone: sealed.zone,
      };

      state.doors = sealed.doors;

      state.edges = applyThreatRisk(state.edges, state.threat);

      state.events =
        logEvent(
          state.events,
          state.time,
          `THREAT CONTAINED in ${node?.label ?? "a sealed zone"} — ` +
            `zone sealed (${sealed.sealed} more doors locked)`,
          "success"
        );
    }
  }


  // ---------- 5. Keep steering people away from the threat ----------

  if (
    state.detected &&
    state.disaster === "security" &&
    state.time - state.lastRerouteAt >= SECURITY_REROUTE_INTERVAL
  ) {

    const current = state;

    state = {
      ...state,
      people: state.people.map((p) => rerouteWhileWalking(p, current)),
      lastRerouteAt: state.time,
    };
  }


  // ---------- 6. People move (only once alerted) ----------

  if (state.detected) {

    const current = state;

    const wasDone =
      state.people.every((p) => p.state === "safe" || p.state === "waiting");

    state.people =
      state.people.map((person) =>
        movePerson(person, current, deltaTime)
      );

    const nowDone =
      state.people.every((p) => p.state === "safe" || p.state === "waiting");

    if (!wasDone && nowDone) {

      const waiting =
        state.people.filter((p) => p.state === "waiting").length;

      state.events =
        logEvent(
          state.events,
          state.time,
          waiting > 0
            ? `All mobile occupants safe — ${waiting} awaiting assisted evacuation`
            : "All occupants safe",
          "success"
        );
    }
  }


  // ---------- 7. Sensor lights + alarm text ----------

  state.sensors = updateSensorStatus(state);

  state.alarmMessage = alarmMessageFor(state);

  return state;
}
