import type {
  GraphNode,
  Person,
} from "../simulation/types/simulation";


// ============================================================
// BUILDING LAYOUT
// ============================================================
//
// Shared by the 2D floor plan AND the 3D cutaway, so both
// views draw exactly the same building, in the same
// coordinates as the nodes in simulation/building.ts.
// ============================================================

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FLOORS = [1, 2, 3];

export const BUILDING: Rect = { x: 50, y: 40, w: 800, h: 500 };


// ------------------------------------------------------------
// AREAS (same footprint on every floor)
// ------------------------------------------------------------

export interface Area {
  id: string;
  rect: Rect;
  // What the area is on the ground floor / upper floors
  kind: "room" | "corridor" | "stair" | "refuge" | "core";
  upperKind?: Area["kind"];
  label?: string;
  upperLabel?: (floor: number) => string;
}

export const AREAS: Area[] = [

  // Rooms (upper floors: A and C become refuges)
  {
    id: "room-a", rect: { x: 50, y: 40, w: 210, h: 140 },
    kind: "room", label: "ROOM A",
    upperKind: "refuge", upperLabel: (f) => `REFUGE ${f}W`,
  },
  {
    id: "room-b", rect: { x: 50, y: 240, w: 210, h: 140 },
    kind: "room", label: "ROOM B",
    upperLabel: (f) => `ROOM B${f}`,
  },
  {
    id: "room-c", rect: { x: 540, y: 40, w: 310, h: 140 },
    kind: "room", label: "ROOM C",
    upperKind: "refuge", upperLabel: (f) => `REFUGE ${f}E`,
  },
  {
    id: "room-d", rect: { x: 540, y: 240, w: 310, h: 140 },
    kind: "room", label: "ROOM D",
    upperLabel: (f) => `ROOM D${f}`,
  },

  // Circulation
  { id: "corridor", rect: { x: 50, y: 180, w: 800, h: 60 }, kind: "corridor" },
  { id: "lobby", rect: { x: 260, y: 40, w: 280, h: 140 }, kind: "corridor", label: "NORTH LOBBY", upperLabel: (f) => `LOBBY ${f}` },
  { id: "spur", rect: { x: 470, y: 240, w: 60, h: 115 }, kind: "corridor" },

  // South band (ground floor only — offices upstairs)
  {
    id: "hall-south", rect: { x: 50, y: 380, w: 360, h: 160 },
    kind: "corridor", label: "SOUTH HALL",
    upperKind: "room", upperLabel: (f) => `OFFICE ${f}S`,
  },
  {
    id: "hall-east", rect: { x: 590, y: 380, w: 260, h: 160 },
    kind: "corridor", label: "EAST HALL",
    upperKind: "room", upperLabel: (f) => `OFFICE ${f}E`,
  },
  { id: "link-west", rect: { x: 410, y: 380, w: 40, h: 60 }, kind: "corridor", upperKind: "core" },
  { id: "link-east", rect: { x: 550, y: 380, w: 40, h: 60 }, kind: "corridor", upperKind: "core" },
  {
    id: "refuge-a", rect: { x: 410, y: 440, w: 180, h: 100 },
    kind: "refuge", label: "PROTECTED REFUGE",
    upperKind: "room", upperLabel: (f) => `PLANT ${f}`,
  },

  // Stairs (on every floor)
  { id: "stair-a", rect: { x: 450, y: 355, w: 100, h: 85 }, kind: "stair", label: "STAIR A" },
  { id: "stair-b", rect: { x: 270, y: 50, w: 80, h: 80 }, kind: "stair", label: "STAIR B" },

  // Service core (not walkable)
  { id: "core-left", rect: { x: 260, y: 240, w: 210, h: 140 }, kind: "core", label: "SERVICE CORE" },
  { id: "core-right", rect: { x: 530, y: 240, w: 10, h: 115 }, kind: "core" },
];


export function areaKind(area: Area, floor: number): Area["kind"] {
  return floor === 1 ? area.kind : area.upperKind ?? area.kind;
}

export function areaLabel(area: Area, floor: number): string | undefined {
  return floor === 1
    ? area.label
    : area.upperLabel?.(floor) ?? area.label;
}


// ------------------------------------------------------------
// EXITS (ground floor)
// ------------------------------------------------------------

export type WallSide = "west" | "east" | "north";

export const EXITS: { id: string; label: string; side: WallSide }[] = [
  { id: "exit-a", label: "EXIT A", side: "west" },
  { id: "exit-b", label: "EXIT B", side: "east" },
  { id: "exit-c", label: "EXIT C", side: "north" },
  { id: "exit-d", label: "EXIT D", side: "west" },
  { id: "exit-e", label: "EXIT E", side: "east" },
];


// ------------------------------------------------------------
// DOORS (ground floor)
// ------------------------------------------------------------
// Each point lies exactly on the straight line between the two
// nodes the door joins, so a route always passes through it.

export const DOOR_POSITIONS: Record<
  string,
  { x: number; y: number; vertical: boolean }
> = {
  "door-room-a":       { x: 240, y: 180, vertical: false },
  "door-room-b":       { x: 240, y: 240, vertical: false },
  "door-room-b-south": { x: 175, y: 380, vertical: false },
  "door-room-c":       { x: 567, y: 180, vertical: false },
  "door-room-d":       { x: 567, y: 240, vertical: false },
  "door-room-d-south": { x: 710, y: 380, vertical: false },
  "door-exit-a":       { x: 50,  y: 210, vertical: true },
  "door-exit-b":       { x: 850, y: 210, vertical: true },
  "door-exit-c":       { x: 400, y: 40,  vertical: false },
  "door-exit-d":       { x: 50,  y: 460, vertical: true },
  "door-exit-e":       { x: 850, y: 460, vertical: true },

  // Lockdown / security doors
  "door-west-central":  { x: 400, y: 210, vertical: true },
  "door-lobby-west":    { x: 339, y: 180, vertical: false },
  "door-lobby-central": { x: 479, y: 180, vertical: false },
  "door-central-stair": { x: 500, y: 240, vertical: false },
  "door-stair-b":       { x: 350, y: 97,  vertical: true },
  "door-south-stair":   { x: 410, y: 413, vertical: true },
  "door-east-stair":    { x: 590, y: 419, vertical: true },
  "door-refuge-stair":  { x: 500, y: 440, vertical: false },
  "door-refuge-south":  { x: 410, y: 487, vertical: true },
  "door-refuge-east":   { x: 590, y: 484, vertical: true },
};


// ------------------------------------------------------------
// WHERE TO DRAW A PERSON (used by BOTH views)
// ------------------------------------------------------------

// Small fixed offsets so people in the same place
// don't draw on top of each other.
const PERSON_OFFSETS: [number, number][] = [
  [-14, -10], [14, 10], [-14, 10], [14, -10],
  [0, -16], [0, 16], [-24, 0], [24, 0],
  [-8, 0], [8, 0], [-20, -16], [20, 16],
  [-20, 16], [20, -16],
];


export function createPlacement(nodeById: Map<string, GraphNode>) {

  // How many people are already gathered at each node
  const gathered = new Map<string, number>();

  return (person: Person, index: number): [number, number] => {

    const node = nodeById.get(person.nodeId);

    // Arrived somewhere (safe or waiting) → gather neatly
    if (
      node &&
      (person.state === "safe" || person.state === "waiting")
    ) {

      const count = gathered.get(node.id) ?? 0;

      gathered.set(node.id, count + 1);

      const row = count % 4;
      const column = Math.floor(count / 4);

      // Outside an exit: assembly point beyond the wall
      if (node.type === "exit") {

        const exit = EXITS.find((e) => e.id === node.id);

        if (exit?.side === "west") {
          return [node.x - 24 - column * 14, node.y - 42 + row * 28];
        }

        if (exit?.side === "east") {
          return [node.x + 24 + column * 14, node.y - 42 + row * 28];
        }

        return [node.x - 42 + row * 28, node.y - 22 - column * 14];
      }

      // Inside a refuge / landing: small grid around the node
      return [
        node.x - 30 + row * 20,
        node.y - 6 + column * 22,
      ];
    }

    // Walking (or waiting to start): small offset, tighter
    // while moving so people stay inside the corridors.
    const [ox, oy] = PERSON_OFFSETS[index % PERSON_OFFSETS.length];

    const spread = person.state === "evacuating" ? 0.55 : 1;

    return [
      person.x + ox * spread,
      person.y + oy * spread,
    ];
  };
}
