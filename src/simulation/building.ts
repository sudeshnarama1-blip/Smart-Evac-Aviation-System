import type {
  GraphNode,
  GraphEdge,
  Door,
  NodeType,
} from "./types/simulation";


// ============================================================
// BUILDING GRAPH
// ============================================================
//
// 3 floors, same footprint (plan coordinates x 50–850, y 40–540).
//
//  FLOOR 1 (ground)
//    Rooms A–D, west/central corridor, north lobby, south and
//    east halls, protected refuge, 5 EXITS (A–E), 2 stairs.
//
//  FLOORS 2 and 3
//    Upper corridor + lobby, two REFUGE rooms each (above
//    Room A and Room C), reached by Stair A and Stair B.
//
// Flood → people climb to the upper refuges.
// Everything else → people leave through a safe exit.
// ============================================================


// How far one floor of stairs "costs" compared with walking.
// (Distances are in plan units / 100.)
const STAIR_FLIGHT_COST = 2;


// ------------------------------------------------------------
// NODE HELPER
// ------------------------------------------------------------

function node(
  id: string,
  x: number,
  y: number,
  floor: number,
  type: NodeType,
  label: string,
  capacity = 20,
): GraphNode {
  return { id, x, y, floor, type, label, capacity };
}


// ==========================================
// BUILDING NODES
// ==========================================

const groundFloor: GraphNode[] = [

  // Rooms
  node("room-a", 120, 120, 1, "room", "Room A", 8),
  node("room-b", 120, 300, 1, "room", "Room B", 8),
  node("room-c", 700, 120, 1, "room", "Room C", 8),
  node("room-d", 700, 300, 1, "room", "Room D", 8),

  // Circulation
  node("corridor-west", 300, 210, 1, "corridor", "West Corridor"),
  node("central", 500, 210, 1, "corridor", "Central Corridor", 30),
  node("lobby-north", 430, 110, 1, "corridor", "North Lobby", 30),
  node("hall-south", 230, 460, 1, "corridor", "South Hall"),
  node("hall-east", 720, 460, 1, "corridor", "East Hall"),

  // Stairs (ground-floor landings)
  node("stair-a", 500, 390, 1, "stair", "Stair A", 15),
  node("stair-b", 310, 90, 1, "stair", "Stair B", 15),

  // Protected ground-floor refuge (earthquake shelter)
  node("refuge-a", 500, 500, 1, "refuge", "Protected Refuge", 40),

  // Exits
  node("exit-a", 50, 210, 1, "exit", "Exit A", 50),
  node("exit-b", 850, 210, 1, "exit", "Exit B", 50),
  node("exit-c", 400, 40, 1, "exit", "Exit C", 50),
  node("exit-d", 50, 460, 1, "exit", "Exit D", 50),
  node("exit-e", 850, 460, 1, "exit", "Exit E", 50),
];


function upperFloor(floor: number): GraphNode[] {
  return [
    node(`hall-${floor}-west`, 300, 210, floor, "corridor", `Level ${floor} West Hall`),
    node(`hall-${floor}`, 500, 210, floor, "corridor", `Level ${floor} Central Hall`, 30),
    node(`lobby-${floor}`, 430, 110, floor, "corridor", `Level ${floor} Lobby`),
    node(`stair-a-${floor}`, 500, 390, floor, "stair", `Stair A · L${floor}`, 15),
    node(`stair-b-${floor}`, 310, 90, floor, "stair", `Stair B · L${floor}`, 15),
    node(`refuge-${floor}-west`, 120, 120, floor, "refuge", `Refuge ${floor}W`, 30),
    node(`refuge-${floor}-east`, 700, 120, floor, "refuge", `Refuge ${floor}E`, 30),
  ];
}


export const buildingNodes: GraphNode[] = [
  ...groundFloor,
  ...upperFloor(2),
  ...upperFloor(3),
];


const nodeById =
  new Map(buildingNodes.map((n) => [n.id, n]));


// ------------------------------------------------------------
// EDGE HELPER
// ------------------------------------------------------------
//
// Distance is CALCULATED from the node positions (and floors),
// so it always matches the drawing and keeps the A* heuristic
// accurate.

function edge(
  from: string,
  to: string,
  width = 2,
): GraphEdge {

  const a = nodeById.get(from);
  const b = nodeById.get(to);

  if (!a || !b) {
    throw new Error(`Edge ${from} → ${to} uses an unknown node`);
  }

  const horizontal = Math.hypot(a.x - b.x, a.y - b.y) / 100;

  const vertical = Math.abs(a.floor - b.floor) * STAIR_FLIGHT_COST;

  return {
    id: `edge-${from}--${to}`,
    from,
    to,
    distance: horizontal + vertical,
    width,
    available: true,

    smoke: 0,
    heat: 0,
    water: 0,
    chemical: 0,
    structuralRisk: 0,
    threatRisk: 0,
  };
}


// ==========================================
// BUILDING CONNECTIONS
// ==========================================

function upperFloorEdges(floor: number): GraphEdge[] {
  return [
    edge(`hall-${floor}-west`, `hall-${floor}`, 3),
    edge(`hall-${floor}`, `stair-a-${floor}`, 3),
    edge(`lobby-${floor}`, `stair-b-${floor}`, 3),
    edge(`lobby-${floor}`, `hall-${floor}`, 3),
    edge(`lobby-${floor}`, `hall-${floor}-west`, 3),
    edge(`hall-${floor}-west`, `refuge-${floor}-west`, 2),
    edge(`hall-${floor}`, `refuge-${floor}-east`, 2),
  ];
}


export const buildingEdges: GraphEdge[] = [

  // ---------- Ground floor ----------

  // Rooms → corridors
  edge("room-a", "corridor-west"),
  edge("room-b", "corridor-west"),
  edge("room-c", "central"),
  edge("room-d", "central"),

  // Second doors (south side)
  edge("room-b", "hall-south"),
  edge("room-d", "hall-east"),

  // Corridor network
  edge("corridor-west", "central", 3),
  edge("lobby-north", "central", 3),
  edge("lobby-north", "corridor-west", 3),
  edge("central", "stair-a", 3),
  edge("stair-a", "refuge-a", 3),
  edge("lobby-north", "stair-b", 3),
  edge("hall-south", "refuge-a", 3),
  edge("hall-south", "stair-a", 2),
  edge("hall-east", "stair-a", 2),
  edge("hall-east", "refuge-a", 3),

  // Exits
  edge("corridor-west", "exit-a", 3),
  edge("central", "exit-b", 3),
  edge("lobby-north", "exit-c", 3),
  edge("hall-south", "exit-d", 3),
  edge("hall-east", "exit-e", 3),

  // ---------- Upper floors ----------

  ...upperFloorEdges(2),
  ...upperFloorEdges(3),

  // ---------- Stairs (vertical) ----------

  edge("stair-a", "stair-a-2", 2),
  edge("stair-a-2", "stair-a-3", 2),
  edge("stair-b", "stair-b-2", 2),
  edge("stair-b-2", "stair-b-3", 2),
];


// ==========================================
// DOORS (ground floor)
// ==========================================

function door(
  id: string,
  from: string,
  to: string,
  emergencyExit = false,
): Door {
  return { id, from, to, state: "open", emergencyExit };
}

export const buildingDoors: Door[] = [
  door("door-room-a", "room-a", "corridor-west"),
  door("door-room-b", "room-b", "corridor-west"),
  door("door-room-b-south", "room-b", "hall-south"),
  door("door-room-c", "room-c", "central"),
  door("door-room-d", "room-d", "central"),
  door("door-room-d-south", "room-d", "hall-east"),

  door("door-exit-a", "corridor-west", "exit-a", true),
  door("door-exit-b", "central", "exit-b", true),
  door("door-exit-c", "lobby-north", "exit-c", true),
  door("door-exit-d", "hall-south", "exit-d", true),
  door("door-exit-e", "hall-east", "exit-e", true),

  // Corridor / lobby security doors (lockable in a lockdown)
  door("door-west-central", "corridor-west", "central"),
  door("door-lobby-west", "lobby-north", "corridor-west"),
  door("door-lobby-central", "lobby-north", "central"),
  door("door-central-stair", "central", "stair-a"),
  door("door-stair-b", "lobby-north", "stair-b"),
  door("door-south-stair", "hall-south", "stair-a"),
  door("door-east-stair", "hall-east", "stair-a"),

  // Refuge doors (seal once people are inside)
  door("door-refuge-stair", "stair-a", "refuge-a"),
  door("door-refuge-south", "hall-south", "refuge-a"),
  door("door-refuge-east", "hall-east", "refuge-a"),

  // Stairwell doors to the upper floors
  door("door-stair-a-up", "stair-a", "stair-a-2"),
  door("door-stair-b-up", "stair-b", "stair-b-2"),
];
