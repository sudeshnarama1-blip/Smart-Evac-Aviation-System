import type {
  GraphNode,
  GraphEdge,
  Door,
  DisasterType,
  Person,
} from "../types/simulation";


// ==========================================
// ROUTING RESULT
// ==========================================

export interface RouteResult {
  path: string[];
  cost: number;
  reachable: boolean;
}


// ==========================================
// SHARED HAZARD RULES
// ==========================================
//
// These are used by the routing engine AND by the 2D/3D
// views, so what the screen shows as "blocked" is exactly
// what the router refuses to use.
// ==========================================

// An exit doorway at or above this hazard level is
// considered unusable (collapsed, flooded, on fire, …).
export const EXIT_BLOCK_THRESHOLD = 0.5;

// Any connection at or above this level is impassable.
export const EDGE_BLOCK_THRESHOLD = 0.95;


// How dangerous an edge is for the current disaster (0 → 1).
export function hazardLevel(
  edge: GraphEdge,
  disaster: DisasterType,
): number {

  switch (disaster) {
    case "fire":       return Math.max(edge.smoke, edge.heat);
    case "flood":      return edge.water;
    case "chemical":   return edge.chemical;
    case "earthquake": return edge.structuralRisk;
    case "security":   return edge.threatRisk;
    default:           return 0;
  }
}


// Is this edge the doorway of an exit?
function touchesExit(
  edge: GraphEdge,
  nodeById: Map<string, GraphNode>,
): boolean {

  return (
    nodeById.get(edge.from)?.type === "exit" ||
    nodeById.get(edge.to)?.type === "exit"
  );
}


// Can this edge be used at all right now?
export function isEdgeBlocked(
  edge: GraphEdge,
  nodes: GraphNode[] | Map<string, GraphNode>,
  disaster: DisasterType,
): boolean {

  if (!edge.available) {
    return true;
  }

  const nodeById =
    nodes instanceof Map
      ? nodes
      : new Map(nodes.map((n) => [n.id, n]));

  const level = hazardLevel(edge, disaster);

  if (level >= EDGE_BLOCK_THRESHOLD) {
    return true;
  }

  if (
    touchesExit(edge, nodeById) &&
    level >= EXIT_BLOCK_THRESHOLD
  ) {
    return true;
  }

  return false;
}


// Is a whole exit unusable? (Used by the views.)
export function isExitBlocked(
  exitId: string,
  edges: GraphEdge[],
  nodes: GraphNode[],
  disaster: DisasterType,
): boolean {

  const exitEdges =
    edges.filter(
      (edge) => edge.from === exitId || edge.to === exitId
    );

  return (
    exitEdges.length > 0 &&
    exitEdges.every(
      (edge) => isEdgeBlocked(edge, nodes, disaster)
    )
  );
}


// ==========================================
// HAZARD COST
// ==========================================

// Hazards don't have to block an edge to matter: a smoky or
// wet corridor is still usable, just much less attractive.
function getHazardCost(
  edge: GraphEdge,
  disaster: DisasterType,
): number {

  const weights: Record<DisasterType, number> = {
    fire: 40,
    flood: 30,
    chemical: 45,
    earthquake: 50,
    security: 60,
    normal: 0,
  };

  // Exposure grows with how far you walk through the hazard
  // (wading 20 m of flood water is worse than wading 2 m).
  return (
    hazardLevel(edge, disaster) *
    weights[disaster] *
    (0.5 + edge.distance)
  );
}


// ==========================================
// DOOR COST
// ==========================================

function getDoorCost(
  edge: GraphEdge,
  doors: Door[],
): number {

  const door = doors.find(
    (d) =>
      (d.from === edge.from && d.to === edge.to) ||
      (d.from === edge.to && d.to === edge.from)
  );

  // No door = no restriction
  if (!door) {
    return 0;
  }

  switch (door.state) {

    case "open":
      return 0;

    case "restricted":
      return 5;

    // A fire door that is isolating a hazard zone stops
    // through-traffic, but must NEVER trap the people
    // already inside that zone. A large (finite) cost does
    // both: nobody routes through it by choice, but the
    // zone's occupants can still get out.
    case "isolating":
      return 20;

    case "closed":
      return Infinity;

    case "manual":
      return 1;

    // Lockdown door: occupants badge through (small delay);
    // the security threat cannot pass at all.
    case "locked":
      return 0.5;

    default:
      return 0;
  }
}


// ==========================================
// PERSON ACCESSIBILITY
// ==========================================

function getPersonCost(
  edge: GraphEdge,
  fromNode: GraphNode,
  toNode: GraphNode,
  person: Person,
): number {

  const changesFloor =
    fromNode.floor !== toNode.floor;


  // Wheelchair users cannot use stair flights
  // (walking up to a stair LANDING is fine).
  if (
    person.type === "wheelchair" &&
    changesFloor
  ) {
    return Infinity;
  }


  // Elderly people find stairs and narrow routes harder
  if (person.type === "elderly") {
    return (changesFloor ? 2 : 0) + (edge.width < 2 ? 1 : 0);
  }


  // Children have a small additional movement cost
  if (person.type === "child") {
    return 0.2;
  }


  return 0;
}


// ==========================================
// TOTAL EDGE COST
// ==========================================

function getEdgeCost(
  edge: GraphEdge,
  nodeById: Map<string, GraphNode>,
  doors: Door[],
  disaster: DisasterType,
  person: Person,
): number {

  if (isEdgeBlocked(edge, nodeById, disaster)) {
    return Infinity;
  }

  const fromNode = nodeById.get(edge.from);
  const toNode = nodeById.get(edge.to);

  if (!fromNode || !toNode) {
    return Infinity;
  }

  const doorCost = getDoorCost(edge, doors);

  const personCost =
    getPersonCost(edge, fromNode, toNode, person);

  if (
    !Number.isFinite(doorCost) ||
    !Number.isFinite(personCost)
  ) {
    return Infinity;
  }

  return (
    edge.distance +
    getHazardCost(edge, disaster) +
    doorCost +
    personCost
  );
}


// ==========================================
// HEURISTIC
// ==========================================
//
// Uses the SAME units as edge.distance (plan units / 100,
// plus 2 per floor), and never overestimates — so A* always
// finds the genuinely cheapest route.

function heuristic(
  current: GraphNode,
  target: GraphNode,
): number {

  return (
    Math.hypot(
      current.x - target.x,
      current.y - target.y
    ) / 100 +
    Math.abs(current.floor - target.floor) * 2
  );
}


// ==========================================
// A* PATHFINDING
// ==========================================

export function findRoute(
  startId: string,
  targetId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  doors: Door[],
  disaster: DisasterType,
  person: Person,
): RouteResult {

  const nodeById =
    new Map(nodes.map((n) => [n.id, n]));

  const start = nodeById.get(startId);
  const target = nodeById.get(targetId);

  if (!start || !target) {
    return { path: [], cost: Infinity, reachable: false };
  }

  // Already there
  if (startId === targetId) {
    return { path: [startId], cost: 0, reachable: true };
  }


  // Adjacency list (built once per search)
  const neighbours = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    for (const end of [edge.from, edge.to]) {
      const list = neighbours.get(end) ?? [];
      list.push(edge);
      neighbours.set(end, list);
    }
  }


  const openSet = new Set<string>([startId]);

  const cameFrom = new Map<string, string>();

  const gScore = new Map<string, number>([[startId, 0]]);

  const fScore =
    new Map<string, number>([[startId, heuristic(start, target)]]);


  while (openSet.size > 0) {

    // Node with the lowest F score
    let currentId = "";
    let lowest = Infinity;

    for (const id of openSet) {
      const score = fScore.get(id) ?? Infinity;
      if (score < lowest) {
        lowest = score;
        currentId = id;
      }
    }

    if (!currentId) {
      break;
    }


    // Destination reached → rebuild the path
    if (currentId === targetId) {

      const path: string[] = [];

      let step: string | undefined = currentId;

      while (step) {
        path.unshift(step);
        step = cameFrom.get(step);
      }

      return {
        path,
        cost: gScore.get(targetId) ?? Infinity,
        reachable: true,
      };
    }


    openSet.delete(currentId);


    for (const edge of neighbours.get(currentId) ?? []) {

      const neighbourId =
        edge.from === currentId ? edge.to : edge.from;

      const neighbour = nodeById.get(neighbourId);

      if (!neighbour) {
        continue;
      }

      // Never walk THROUGH an exit, a refuge or someone's
      // room on the way somewhere else — corridors only.
      if (
        neighbourId !== targetId &&
        (
          neighbour.type === "exit" ||
          neighbour.type === "refuge" ||
          neighbour.type === "room"
        )
      ) {
        continue;
      }

      const edgeCost =
        getEdgeCost(edge, nodeById, doors, disaster, person);

      if (!Number.isFinite(edgeCost)) {
        continue;
      }

      const tentativeG =
        (gScore.get(currentId) ?? Infinity) + edgeCost;

      if (tentativeG < (gScore.get(neighbourId) ?? Infinity)) {

        cameFrom.set(neighbourId, currentId);

        gScore.set(neighbourId, tentativeG);

        fScore.set(
          neighbourId,
          tentativeG + heuristic(neighbour, target)
        );

        openSet.add(neighbourId);
      }
    }
  }


  // No route exists
  return { path: [], cost: Infinity, reachable: false };
}
