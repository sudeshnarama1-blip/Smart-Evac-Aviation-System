import type {
  Door,
  GraphEdge,
  GraphNode,
  SimEvent,
  SimulationState,
  ThreatAgent,
} from "./types/simulation";

import { logEvent } from "./detection";


// ============================================================
// SECURITY THREAT + LOCKDOWN
// ============================================================
//
//  • The threat is a moving agent. It enters through Exit D
//    and heads for the nearest area that still has people in
//    it (on the ground floor).
//
//  • Its danger is LIVE: corridors next to it are marked as
//    high-risk every frame, so occupants' routes bend away
//    from wherever it currently is.
//
//  • Once a sensor detects it, the building goes into
//    LOCKDOWN:
//      - refuge doors seal straight away;
//      - every LOCK_INTERVAL seconds the open door nearest
//        to the threat locks.
//    Occupants have badge access through locked doors; the
//    threat does not. Doors keep locking around it until it
//    can no longer reach anyone → CONTAINED.
// ============================================================


// Threat walking speed (plan units / second)
export const THREAT_SPEED = 68;

// Where the intruder comes in
const ENTRY_EXIT = "exit-d";
const ENTRY_HALL = "hall-south";

// Seconds between successive door locks
export const LOCK_INTERVAL = 1.8;


// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function doorMap(doors: Door[]): Map<string, Door> {
  return new Map(doors.map((d) => [edgeKey(d.from, d.to), d]));
}


// Can the THREAT use this edge right now?
function threatCanUse(
  edge: GraphEdge,
  doorsByEdge: Map<string, Door>,
  nodeById: Map<string, GraphNode>,
): boolean {

  const a = nodeById.get(edge.from);
  const b = nodeById.get(edge.to);

  if (!a || !b) return false;

  // Stays on the ground floor
  if (a.floor !== 1 || b.floor !== 1) return false;

  const door = doorsByEdge.get(edgeKey(edge.from, edge.to));

  if (door && (door.state === "locked" || door.state === "closed")) {
    return false;
  }

  return true;
}


// Nodes the threat may pass THROUGH (not just end at)
function isTransit(node: GraphNode): boolean {
  return node.type === "corridor" || node.type === "stair";
}

// Nodes the threat can never enter (sealed / outside)
function isOffLimits(node: GraphNode): boolean {
  return node.type === "refuge" || node.type === "exit";
}


// Dijkstra over the threat's usable edges.
function threatDistances(
  startId: string,
  state: SimulationState,
  allowed?: Set<string>,
): { dist: Map<string, number>; prev: Map<string, string> } {

  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));
  const doorsByEdge = doorMap(state.doors);

  const dist = new Map<string, number>([[startId, 0]]);
  const prev = new Map<string, string>();
  const open = new Set<string>([startId]);
  const done = new Set<string>();

  while (open.size > 0) {

    let current = "";
    let best = Infinity;

    for (const id of open) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) {
        best = d;
        current = id;
      }
    }

    open.delete(current);
    done.add(current);

    const currentNode = nodeById.get(current);

    // Only keep searching outward from corridors/stairs
    // (and from the starting point).
    if (!currentNode || (current !== startId && !isTransit(currentNode))) {
      continue;
    }

    for (const edge of state.edges) {

      if (edge.from !== current && edge.to !== current) continue;

      if (!threatCanUse(edge, doorsByEdge, nodeById)) continue;

      const nextId = edge.from === current ? edge.to : edge.from;
      const next = nodeById.get(nextId);

      if (!next || isOffLimits(next) || done.has(nextId)) continue;

      if (allowed && !allowed.has(nextId)) continue;

      const d =
        best + Math.hypot(next.x - currentNode.x, next.y - currentNode.y);

      if (d < (dist.get(nextId) ?? Infinity)) {
        dist.set(nextId, d);
        prev.set(nextId, current);
        open.add(nextId);
      }
    }
  }

  return { dist, prev };
}


// Nodes where people who still need protecting are
function occupiedNodes(state: SimulationState): Set<string> {
  return new Set(
    state.people
      .filter((p) => p.state !== "safe")
      .flatMap((p) => {
        // Where they are, and where they are heading next
        const next = p.route[p.routeIndex + 1];
        return next ? [p.nodeId, next] : [p.nodeId];
      })
  );
}


// ------------------------------------------------------------
// CREATE
// ------------------------------------------------------------

export function createThreat(nodes: GraphNode[]): ThreatAgent {

  const entry = nodes.find((n) => n.id === ENTRY_EXIT);

  return {
    x: entry?.x ?? 50,
    y: entry?.y ?? 460,
    floor: 1,
    nodeId: ENTRY_EXIT,
    // Walks in through the south-west doors
    route: [ENTRY_EXIT, ENTRY_HALL],
    routeIndex: 0,
    speed: THREAT_SPEED,
    contained: false,
    containedIn: null,
    zone: [],
  };
}


// ------------------------------------------------------------
// WHERE DOES THE THREAT GO NEXT?
// ------------------------------------------------------------

function planThreatRoute(
  threat: ThreatAgent,
  state: SimulationState,
): string[] | null {

  const { dist, prev } = threatDistances(threat.nodeId, state);

  const occupied = occupiedNodes(state);

  let target = "";
  let best = Infinity;

  for (const [nodeId, d] of dist) {
    if (nodeId !== threat.nodeId && occupied.has(nodeId) && d < best) {
      best = d;
      target = nodeId;
    }
  }

  if (!target) {
    return null;
  }

  const path = [target];

  while (path[0] !== threat.nodeId) {
    const step = prev.get(path[0]);
    if (!step) return null;
    path.unshift(step);
  }

  return path;
}


// A contained threat paces between the corridors of its
// sealed zone (deterministic, so runs are repeatable).
function planWanderRoute(
  threat: ThreatAgent,
  state: SimulationState,
): string[] | null {

  const { dist, prev } =
    threatDistances(threat.nodeId, state, new Set(threat.zone));

  const choices =
    [...dist.keys()]
      .filter((id) => id !== threat.nodeId)
      .sort();

  if (choices.length === 0) return null;

  const target =
    choices[Math.floor(state.time * 3.7) % choices.length];

  const path = [target];

  while (path[0] !== threat.nodeId) {
    const step = prev.get(path[0]);
    if (!step) return null;
    path.unshift(step);
  }

  return path;
}


// ------------------------------------------------------------
// MOVE
// ------------------------------------------------------------

export function moveThreat(
  state: SimulationState,
  deltaTime: number,
): ThreatAgent | null {

  const threat = state.threat;

  if (!threat) return null;

  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));

  let { x, y, nodeId, route, routeIndex } = threat;

  // Once contained it keeps moving, but only around its
  // sealed zone (it can't reach anyone any more).
  let budget =
    threat.speed * deltaTime * (threat.contained ? 0.55 : 1);

  while (budget > 0) {

    // At a node → choose where to go next
    if (routeIndex >= route.length - 1) {

      const plan =
        threat.contained
          ? planWanderRoute({ ...threat, nodeId }, state)
          : planThreatRoute({ ...threat, nodeId }, state);

      if (!plan || plan.length < 2) {
        break;
      }

      route = plan;
      routeIndex = 0;
    }

    const next = nodeById.get(route[routeIndex + 1]);

    if (!next) break;

    // A door ahead was locked → re-plan from here
    const doorsByEdge = doorMap(state.doors);

    const door =
      doorsByEdge.get(edgeKey(route[routeIndex], route[routeIndex + 1]));

    const atNode = nodeById.get(nodeId);

    const stillAtStart =
      atNode && Math.hypot(atNode.x - x, atNode.y - y) < 0.5;

    if (door && door.state === "locked" && stillAtStart) {
      route = [nodeId];
      routeIndex = 0;
      const plan =
        threat.contained
          ? planWanderRoute({ ...threat, nodeId }, state)
          : planThreatRoute({ ...threat, nodeId }, state);
      if (!plan || plan.length < 2) break;
      route = plan;
      continue;
    }

    const dx = next.x - x;
    const dy = next.y - y;
    const distance = Math.hypot(dx, dy);

    if (distance <= budget) {
      x = next.x;
      y = next.y;
      nodeId = next.id;
      routeIndex += 1;
      budget -= distance;
    } else {
      x += (dx / distance) * budget;
      y += (dy / distance) * budget;
      budget = 0;
    }
  }

  return { ...threat, x, y, nodeId, route, routeIndex };
}


// ------------------------------------------------------------
// LIVE DANGER AROUND THE THREAT
// ------------------------------------------------------------
// Rewrites edge.threatRisk from the threat's CURRENT position.

export function applyThreatRisk(
  edges: GraphEdge[],
  threat: ThreatAgent | null,
): GraphEdge[] {

  if (!threat) {
    return edges.map((e) => (e.threatRisk ? { ...e, threatRisk: 0 } : e));
  }

  // The node it's at and the node it's walking to
  const hot = new Set<string>([threat.nodeId]);

  const heading = threat.route[threat.routeIndex + 1];

  if (heading) hot.add(heading);

  // One step further out
  const warm = new Set<string>();

  for (const edge of edges) {
    if (hot.has(edge.from)) warm.add(edge.to);
    if (hot.has(edge.to)) warm.add(edge.from);
  }

  const near = threat.contained ? 0.6 : 0.9;
  const far = threat.contained ? 0 : 0.5;

  return edges.map((edge) => {

    let risk = 0;

    if (hot.has(edge.from) || hot.has(edge.to)) {
      risk = near;
    } else if (warm.has(edge.from) || warm.has(edge.to)) {
      risk = far;
    }

    return edge.threatRisk === risk ? edge : { ...edge, threatRisk: risk };
  });
}


// ------------------------------------------------------------
// LOCKDOWN
// ------------------------------------------------------------

// Refuges seal the moment lockdown starts.
export function startLockdown(
  state: SimulationState,
): { doors: Door[]; events: SimEvent[] } {

  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));

  let sealed = 0;

  const doors = state.doors.map((door) => {
    const touchesRefuge =
      nodeById.get(door.from)?.type === "refuge" ||
      nodeById.get(door.to)?.type === "refuge";

    if (touchesRefuge && door.state !== "locked") {
      sealed++;
      return { ...door, state: "locked" as const };
    }
    return door;
  });

  const events =
    logEvent(
      state.events,
      state.time,
      `${sealed} refuge doors sealed (badge access only)`,
      "warning"
    );

  return { doors, events };
}


// Lock ONE door per interval, chosen to cut the threat off:
//
//   1. the next open door on the path it is walking
//      (so it can't follow anyone), otherwise
//   2. the open ground-floor door nearest to it.
//
// Once it is contained, only the doors right around it are
// locked, until it is completely sealed in.

export function lockNextDoor(
  state: SimulationState,
): { doors: Door[]; events: SimEvent[]; locked: boolean } {

  const threat = state.threat;

  const unchanged = { doors: state.doors, events: state.events, locked: false };

  if (!threat) return unchanged;

  const nodeById = new Map(state.nodes.map((n) => [n.id, n]));

  const doorsByEdge = doorMap(state.doors);

  const atNode = nodeById.get(threat.nodeId);

  const midEdge =
    !!atNode && Math.hypot(atNode.x - threat.x, atNode.y - threat.y) > 0.5;

  // The doorway it is physically walking through right now
  const currentEdge =
    midEdge
      ? edgeKey(threat.route[threat.routeIndex], threat.route[threat.routeIndex + 1])
      : "";

  const isGroundDoor = (door: Door) =>
    nodeById.get(door.from)?.floor === 1 &&
    nodeById.get(door.to)?.floor === 1;

  let chosen: Door | undefined;


  if (threat.contained) {

    // Seal it in: doors touching its node
    chosen =
      state.doors.find(
        (door) =>
          door.state !== "locked" &&
          isGroundDoor(door) &&
          (door.from === threat.nodeId || door.to === threat.nodeId)
      );

  } else {

    // 1. Next door on its path
    const start = midEdge ? threat.routeIndex + 1 : threat.routeIndex;

    for (let i = start; i < threat.route.length - 1 && !chosen; i++) {

      const key = edgeKey(threat.route[i], threat.route[i + 1]);

      const door = doorsByEdge.get(key);

      if (door && door.state !== "locked" && key !== currentEdge) {
        chosen = door;
      }
    }

    // 2. Nearest open door
    if (!chosen) {

      let bestDistance = Infinity;

      for (const door of state.doors) {

        if (door.state === "locked" || !isGroundDoor(door)) continue;

        if (edgeKey(door.from, door.to) === currentEdge) continue;

        const a = nodeById.get(door.from);
        const b = nodeById.get(door.to);

        if (!a || !b) continue;

        const distance =
          Math.hypot((a.x + b.x) / 2 - threat.x, (a.y + b.y) / 2 - threat.y);

        if (distance < bestDistance) {
          bestDistance = distance;
          chosen = door;
        }
      }
    }
  }


  if (!chosen) return unchanged;

  const target = chosen;

  const doors =
    state.doors.map((door) =>
      door === target ? { ...door, state: "locked" as const } : door
    );

  const label = (id: string) => nodeById.get(id)?.label ?? id;

  const events =
    logEvent(
      state.events,
      state.time,
      `Door locked: ${label(target.from)} ↔ ${label(target.to)}`,
      "info"
    );

  return { doors, events, locked: true };
}


// Can the threat still reach anybody?
export function isThreatContained(state: SimulationState): boolean {

  const threat = state.threat;

  if (!threat) return false;

  const { dist } = threatDistances(threat.nodeId, state);

  const occupied = occupiedNodes(state);

  for (const nodeId of dist.keys()) {
    if (occupied.has(nodeId)) return false;
  }

  return true;
}


// Seal the threat's zone: record every area it can still
// reach, and lock every door on the edge of that zone.
export function sealZone(
  state: SimulationState,
): { zone: string[]; doors: Door[]; sealed: number } {

  const threat = state.threat;

  if (!threat) return { zone: [], doors: state.doors, sealed: 0 };

  const zone = new Set(threatDistances(threat.nodeId, state).dist.keys());

  let sealed = 0;

  const doors = state.doors.map((door) => {

    const inside = zone.has(door.from) || zone.has(door.to);
    const crosses = zone.has(door.from) !== zone.has(door.to);

    if (inside && crosses && door.state !== "locked") {
      sealed++;
      return { ...door, state: "locked" as const };
    }

    return door;
  });

  return { zone: [...zone], doors, sealed };
}
