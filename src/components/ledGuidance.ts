import type {
  GraphNode,
  SimulationState,
} from "../simulation/types/simulation";

import {
  hazardLevel,
  isEdgeBlocked,
} from "../simulation/routing/pathfinding";


// ============================================================
// LED FLOOR STRIPS (aircraft-style escape-path lighting)
// ============================================================
//
// Every corridor connection has a strip of LEDs set into the
// floor along its centre line. Their state comes straight
// from the simulation:
//
//   GREEN chase   → an evacuation route uses this corridor;
//                   the light "runs" in the direction to walk
//   AMBER chase   → route goes through a hazard (e.g. wading
//                   through shallow water) — proceed with care
//   RED flashing  → danger / blocked: do not enter
//   OFF (dim)     → not part of any route
//
// Before a sensor has confirmed a hazard, all strips are off.
// ============================================================

export type LedColor = "green" | "amber" | "red" | "off";

export interface Led {
  x: number;
  y: number;
  floor: number;
  color: LedColor;
  // Bright pulse of the chase / flash
  lit: boolean;
}

// Spacing between LEDs (plan units)
const LED_SPACING = 18;

// How fast the chase runs (LEDs per second)
const CHASE_SPEED = 10;

// Every Nth LED is lit in the chase pattern
const CHASE_GAP = 4;

const CAUTION_LEVEL = 0.4;
const DANGER_LEVEL = 0.5;


function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}


export function computeLeds(state: SimulationState): Led[] {

  const nodeById =
    new Map<string, GraphNode>(state.nodes.map((n) => [n.id, n]));


  // ----------------------------------------------------------
  // Which way are people walking along each corridor?
  // (+1 = from → to, -1 = to → from)
  // ----------------------------------------------------------

  const flow = new Map<string, number>();

  if (state.detected) {

    for (const person of state.people) {

      if (person.state !== "evacuating") continue;

      const rest = person.route.slice(person.routeIndex);

      for (let i = 0; i < rest.length - 1; i++) {

        const key = edgeKey(rest[i], rest[i + 1]);

        // Walking in "alphabetical" direction = +1
        const direction = rest[i] < rest[i + 1] ? 1 : -1;

        flow.set(key, (flow.get(key) ?? 0) + direction);
      }
    }
  }


  // Nodes inside a sealed security zone
  const sealedZone = new Set(state.threat?.contained ? state.threat.zone : []);


  // ----------------------------------------------------------
  // Lay out the LEDs
  // ----------------------------------------------------------

  const chaseStep = Math.floor(state.time * CHASE_SPEED);
  const flashOn = Math.floor(state.time * 2.5) % 2 === 0;

  const leds: Led[] = [];

  for (const edge of state.edges) {

    const a = nodeById.get(edge.from);
    const b = nodeById.get(edge.to);

    // Stair flights have their own lighting
    if (!a || !b || a.floor !== b.floor) continue;

    const length = Math.hypot(b.x - a.x, b.y - a.y);

    const count = Math.max(2, Math.floor(length / LED_SPACING));

    const key = edgeKey(edge.from, edge.to);

    const level = hazardLevel(edge, state.disaster);

    const dangerous =
      state.detected &&
      (
        isEdgeBlocked(edge, nodeById, state.disaster) ||
        level >= DANGER_LEVEL ||
        (sealedZone.has(edge.from) && sealedZone.has(edge.to))
      );

    const net = flow.get(key) ?? 0;

    // Which end is "forward" for the chase
    const forward =
      net === 0 ? 0 : (net > 0) === (edge.from < edge.to) ? 1 : -1;

    let color: LedColor = "off";

    if (net !== 0) {
      color = level >= CAUTION_LEVEL ? "amber" : "green";
    } else if (dangerous) {
      color = "red";
    }

    for (let i = 1; i < count; i++) {

      const t = i / count;

      // Index counted from the end people walk FROM
      const along = forward >= 0 ? i : count - i;

      let lit = false;

      if (color === "green" || color === "amber") {
        lit = ((along - chaseStep) % CHASE_GAP + CHASE_GAP) % CHASE_GAP === 0;
      } else if (color === "red") {
        lit = flashOn;
      }

      leds.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        floor: a.floor,
        color,
        lit,
      });
    }
  }

  return leds;
}


// Display colours shared by the 2D and 3D views
export const LED_COLORS: Record<LedColor, { lit: string; dim: string }> = {
  green: { lit: "#3dff9a", dim: "#1d6b43" },
  amber: { lit: "#ffc23d", dim: "#7a5a17" },
  red:   { lit: "#ff4a4a", dim: "#6e1f1f" },
  off:   { lit: "#9aa3a6", dim: "#9aa3a6" },
};
