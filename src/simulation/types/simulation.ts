// ===============================
// ADAPTIVE EVACUATION SIMULATION
// Core Data Types
// ===============================

export type DisasterType =
  | "normal"
  | "fire"
  | "flood"
  | "chemical"
  | "earthquake"
  | "security";

export type NodeType =
  | "room"
  | "corridor"
  | "stair"
  | "exit"
  | "refuge";

export type PersonType =
  | "adult"
  | "child"
  | "elderly"
  | "wheelchair"
  | "responder";

export type PersonState =
  | "normal"
  | "evacuating"
  | "safe"
  | "waiting"
  | "trapped"
  | "avoiding";

export type DoorState =
  | "open"
  | "closed"
  | "restricted"
  | "isolating"
  | "manual"
  // Lockdown: access-controlled. Occupants can still pass
  // (badge access), the security threat cannot.
  | "locked";


// ==========================================
// BUILDING
// ==========================================

export interface GraphNode {
  id: string;

  // Position used by the 2D/3D renderer
  x: number;
  y: number;

  // Floor number
  floor: number;

  type: NodeType;

  label: string;

  // Maximum people this node can comfortably contain
  capacity?: number;
}


export interface GraphEdge {
  id: string;

  from: string;
  to: string;

  // Physical distance
  distance: number;

  // Width of corridor / doorway
  width: number;

  // Whether the connection currently exists
  available: boolean;

  // Hazard levels
  smoke: number;
  heat: number;
  water: number;
  chemical: number;

  // Structural damage
  structuralRisk: number;

  // Security/threat risk
  threatRisk: number;
}


// ==========================================
// DOORS
// ==========================================

export interface Door {
  id: string;

  from: string;
  to: string;

  state: DoorState;

  // Whether this door is an emergency egress door
  emergencyExit: boolean;
}


// ==========================================
// PEOPLE
// ==========================================

export interface Person {
  id: string;

  // Current location
  nodeId: string;

  // Where this person is trying to reach
  destinationId: string;

  // Movement speed
  speed: number;

  state: PersonState;

  type: PersonType;

  // Current calculated route
  route: string[];

  // Current position in route
  routeIndex: number;

  // Exact visual position for animation
  x: number;
  y: number;

  // Vertical position as a floor number.
  // 1 = ground floor. Fractional while on stairs
  // (e.g. 1.5 = halfway between floor 1 and 2).
  z: number;
}


// ==========================================
// HAZARDS
// ==========================================

export interface Hazard {
  id: string;

  type: DisasterType;

  // Hazard can affect a node
  nodeId?: string;

  // Or an entire connection
  edgeId?: string;

  // 0 → 1
  intensity: number;

  active: boolean;
}


// ==========================================
// SENSORS
// ==========================================
//
// One sensor node per room / corridor / stair / refuge.
// They detect smoke, heat, water, gas, vibration and
// intruders, and are what triggers the whole response.

export type SensorStatus =
  | "idle"      // nothing detected
  | "alert"     // hazard within range
  | "source";   // the sensor that first located the hazard

export interface Sensor {
  id: string;
  nodeId: string;
  x: number;
  y: number;
  floor: number;
  status: SensorStatus;
}


// ==========================================
// SECURITY THREAT (moving agent)
// ==========================================

export interface ThreatAgent {
  // Plan position (same coordinates as people)
  x: number;
  y: number;
  floor: number;

  // Last node reached
  nodeId: string;

  // Path it is currently following
  route: string[];
  routeIndex: number;

  speed: number;

  // True once lockdown doors have sealed it off
  // from every occupant.
  contained: boolean;

  // Name of the area it was sealed into
  containedIn: string | null;

  // Node ids of the sealed zone it may still move around in
  zone: string[];
}


// ==========================================
// EVENT LOG
// ==========================================

export interface SimEvent {
  time: number;
  text: string;
  level: "info" | "warning" | "danger" | "success";
}


// ==========================================
// SIMULATION
// ==========================================

export interface SimulationState {
  time: number;

  disaster: DisasterType;

  nodes: GraphNode[];

  edges: GraphEdge[];

  doors: Door[];

  people: Person[];

  hazards: Hazard[];

  alarmActive: boolean;

  simulationRunning: boolean;

  // ---------- detection & response ----------

  sensors: Sensor[];

  // Has a sensor confirmed the hazard yet?
  // (Nobody is told to move until it has.)
  detected: boolean;

  // When the current scenario began (simulation time)
  scenarioStartedAt: number;

  // Big message shown across the top of the screen
  alarmMessage: string | null;

  // Security lockdown mode
  lockdown: boolean;

  // The moving security threat (security scenario only)
  threat: ThreatAgent | null;

  // Newest first
  events: SimEvent[];

  // Internal timers (simulation time)
  lastRerouteAt: number;
  lastLockAt: number;
}