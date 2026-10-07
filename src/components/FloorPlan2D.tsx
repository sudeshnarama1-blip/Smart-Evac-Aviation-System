import { useState } from "react";

import type {
  GraphNode,
  Hazard,
  Person,
  SimulationState,
} from "../simulation/types/simulation";

import { isExitBlocked } from "../simulation/routing/pathfinding";

import {
  AREAS,
  BUILDING,
  DOOR_POSITIONS,
  EXITS,
  FLOORS,
  areaKind,
  areaLabel,
  createPlacement,
} from "./buildingLayout";

import { LED_COLORS, computeLeds } from "./ledGuidance";


// ============================================================
// 2D FLOOR PLAN
// ============================================================
//
// EVERYTHING here is drawn in the SAME coordinate system as
// the building graph in building.ts. The SVG viewBox does
// the scaling to the screen, so nothing can drift.
//
// One floor is shown at a time (tabs at the top). People are
// shown on the floor they are nearest to — while climbing a
// stair they switch floors halfway up.
// ============================================================


const STATE_COLORS: Record<Person["state"], string> = {
  normal: "#5d666b",
  evacuating: "#d69c36",
  safe: "#35a86c",
  waiting: "#3b82c4",
  trapped: "#df4141",
  avoiding: "#ed704b",
};


const HAZARD_STYLE: Record<
  string,
  { fill: string; stroke: string; icon: string }
> = {
  fire:       { fill: "rgba(255,70,40,0.22)",  stroke: "#e2462b", icon: "🔥" },
  flood:      { fill: "rgba(40,140,220,0.28)", stroke: "#2a8bd6", icon: "🌊" },
  chemical:   { fill: "rgba(140,185,40,0.25)", stroke: "#7da823", icon: "☣" },
  earthquake: { fill: "rgba(210,145,45,0.22)", stroke: "#c8862a", icon: "⚠" },
  security:   { fill: "rgba(230,50,50,0.22)",  stroke: "#d93a3a", icon: "!" },
};


// Exit sign geometry for each wall side
function exitSign(node: GraphNode, side: string) {
  if (side === "west") {
    return { x: node.x - 50, y: node.y - 18, w: 50, h: 36 };
  }
  if (side === "east") {
    return { x: node.x, y: node.y - 18, w: 50, h: 36 };
  }
  return { x: node.x - 30, y: node.y - 36, w: 60, h: 34 };
}


function floorOf(person: Person): number {
  return Math.round(person.z);
}


// ============================================================
// COMPONENT
// ============================================================

export default function FloorPlan2D({
  simulation,
}: {
  simulation: SimulationState;
}) {

  const [floor, setFloor] = useState(1);

  const nodeById =
    new Map<string, GraphNode>(
      simulation.nodes.map((node) => [node.id, node])
    );

  const placePerson = createPlacement(nodeById);

  // Work out every person's drawing position once
  // (placement must see everyone, in order).
  const placed =
    simulation.people.map((person, index) => ({
      person,
      position: placePerson(person, index),
    }));


  // People per floor (shown on the tabs)
  const countOnFloor = (f: number) =>
    simulation.people.filter((p) => floorOf(p) === f).length;


  // LED floor strips on this floor
  const leds =
    computeLeds(simulation).filter((led) => led.floor === floor);

  const threat =
    simulation.threat && Math.round(simulation.threat.floor) === floor
      ? simulation.threat
      : null;


  // Stairs that people on this floor are heading UP or DOWN
  const stairArrows = new Map<string, "up" | "down">();

  for (const person of simulation.people) {

    if (person.state !== "evacuating") continue;

    const rest = person.route.slice(person.routeIndex);

    for (let i = 0; i < rest.length - 1; i++) {

      const a = nodeById.get(rest[i]);
      const b = nodeById.get(rest[i + 1]);

      if (a && b && a.floor === floor && b.floor !== floor) {
        stairArrows.set(a.id, b.floor > floor ? "up" : "down");
      }
    }
  }


  const flood =
    simulation.hazards.find(
      (hazard) => hazard.type === "flood" && hazard.active
    );


  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  return (
    <div className="plan-wrap">

      {/* ================= FLOOR TABS ================= */}

      <div className="floor-tabs">
        {[...FLOORS].reverse().map((f) => (
          <button
            key={f}
            className={f === floor ? "floor-tab active" : "floor-tab"}
            onClick={() => setFloor(f)}
          >
            <span>LEVEL {f}</span>
            <strong>{countOnFloor(f)}</strong>
          </button>
        ))}
      </div>


      <svg
        className="plan-svg"
        viewBox="-20 -30 940 600"
        preserveAspectRatio="xMidYMid meet"
      >

        <defs>
          <pattern
            id="plan-grid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="rgba(70,76,79,0.10)"
              strokeWidth="1"
            />
          </pattern>

          <pattern
            id="core-hatch"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0" y1="0" x2="0" y2="10"
              stroke="rgba(70,76,79,0.22)"
              strokeWidth="2"
            />
          </pattern>
        </defs>


        {/* ================= SHELL ================= */}

        <rect
          x={BUILDING.x}
          y={BUILDING.y}
          width={BUILDING.w}
          height={BUILDING.h}
          className="plan-floor"
        />

        <rect
          x={BUILDING.x}
          y={BUILDING.y}
          width={BUILDING.w}
          height={BUILDING.h}
          fill="url(#plan-grid)"
        />


        {/* ================= AREAS ================= */}

        {AREAS.map((area) => {

          const kind = areaKind(area, floor);
          const label = areaLabel(area, floor);

          const onFire =
            simulation.hazards.some(
              (hazard) =>
                hazard.active &&
                hazard.nodeId === area.id &&
                nodeById.get(hazard.nodeId)?.floor === floor
            );

          const className =
            kind === "core"
              ? "plan-core"
              : kind === "corridor"
                ? "plan-corridor"
                : kind === "refuge"
                  ? "plan-refuge"
                  : kind === "stair"
                    ? "plan-room stair"
                    : onFire
                      ? "plan-room hazard"
                      : "plan-room";

          const isRoomLike = kind === "room" || kind === "refuge";

          return (
            <g key={area.id}>
              <rect
                x={area.rect.x}
                y={area.rect.y}
                width={area.rect.w}
                height={area.rect.h}
                className={className}
                fill={kind === "core" ? "url(#core-hatch)" : undefined}
              />

              {kind === "stair" &&
                [0, 1, 2, 3, 4].map((i) => (
                  <line
                    key={i}
                    x1={area.rect.x + 12}
                    x2={area.rect.x + area.rect.w - 12}
                    y1={area.rect.y + 30 + i * 8}
                    y2={area.rect.y + 30 + i * 8}
                    className="plan-step"
                  />
                ))}

              {label && (
                <text
                  x={isRoomLike ? area.rect.x + 14 : area.rect.x + area.rect.w / 2}
                  y={
                    isRoomLike || kind === "stair"
                      ? area.rect.y + 20
                      : area.rect.y + area.rect.h / 2 + 4
                  }
                  className={
                    kind === "refuge"
                      ? "plan-label refuge"
                      : kind === "core"
                        ? "plan-label muted"
                        : isRoomLike
                          ? "plan-label room"
                          : "plan-label small"
                  }
                  textAnchor={isRoomLike ? "start" : "middle"}
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}

        <text x={300} y={232} className="plan-label small">
          {floor === 1 ? "WEST CORRIDOR" : `LEVEL ${floor} HALL`}
        </text>

        <text x={680} y={232} className="plan-label small">
          {floor === 1 ? "CENTRAL CORRIDOR" : `LEVEL ${floor} HALL`}
        </text>


        {/* ================= FLOOD WATER (ground floor) ================= */}

        {flood && floor === 1 && (
          <rect
            x={BUILDING.x}
            y={BUILDING.y}
            width={BUILDING.w}
            height={BUILDING.h}
            className="plan-water"
            style={{ opacity: 0.12 + flood.intensity * 0.3 }}
          />
        )}


        {/* ================= OUTER WALL ================= */}

        <rect
          x={BUILDING.x}
          y={BUILDING.y}
          width={BUILDING.w}
          height={BUILDING.h}
          className="plan-wall"
        />


        {/* ================= EXITS ================= */}

        {floor === 1 &&
          EXITS.map((exit) => {

            const node = nodeById.get(exit.id);

            if (!node) {
              return null;
            }

            const blocked =
              isExitBlocked(
                exit.id,
                simulation.edges,
                simulation.nodes,
                simulation.disaster
              );

            const sign = exitSign(node, exit.side);

            return (
              <g key={exit.id}>
                <rect
                  x={sign.x}
                  y={sign.y}
                  width={sign.w}
                  height={sign.h}
                  rx={3}
                  className={blocked ? "plan-exit blocked" : "plan-exit"}
                />

                <text
                  x={sign.x + sign.w / 2}
                  y={sign.y + sign.h / 2 - 1}
                  className={
                    blocked ? "plan-exit-label blocked" : "plan-exit-label"
                  }
                >
                  {exit.label}
                </text>

                <text
                  x={sign.x + sign.w / 2}
                  y={sign.y + sign.h / 2 + 10}
                  className={
                    blocked ? "plan-exit-sub blocked" : "plan-exit-sub"
                  }
                >
                  {blocked ? "BLOCKED" : "OPEN"}
                </text>

                {blocked && (
                  <g className="plan-exit-cross">
                    <line
                      x1={sign.x + 4} y1={sign.y + 4}
                      x2={sign.x + sign.w - 4} y2={sign.y + sign.h - 4}
                    />
                    <line
                      x1={sign.x + sign.w - 4} y1={sign.y + 4}
                      x2={sign.x + 4} y2={sign.y + sign.h - 4}
                    />
                  </g>
                )}
              </g>
            );
          })}


        {/* ================= HAZARDS ================= */}

        {simulation.hazards.map((hazard: Hazard) => {

          if (!hazard.active || !hazard.nodeId) {
            return null;
          }

          const node = nodeById.get(hazard.nodeId);

          if (!node || node.floor !== floor) {
            return null;
          }

          const style =
            HAZARD_STYLE[hazard.type] ?? HAZARD_STYLE.security;

          const radius =
            hazard.type === "flood"
              ? 40 + hazard.intensity * 50
              : 58;

          return (
            <g key={hazard.id} className="plan-hazard">
              <circle
                cx={node.x}
                cy={node.y}
                r={radius}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={2}
                strokeDasharray="6 4"
              />

              <text
                x={node.x}
                y={node.y - 4}
                className="plan-hazard-icon"
              >
                {style.icon}
              </text>

              <text
                x={node.x}
                y={node.y + 20}
                className="plan-hazard-label"
                fill={style.stroke}
              >
                {hazard.type === "flood"
                  ? `FLOOD ${Math.round(hazard.intensity * 100)}%`
                  : hazard.type.toUpperCase()}
              </text>
            </g>
          );
        })}


        {/* ================= LED FLOOR STRIPS ================= */}

        <g className="plan-leds">
          {leds.map((led, i) => {

            const palette = LED_COLORS[led.color];

            return (
              <circle
                key={i}
                cx={led.x}
                cy={led.y}
                r={led.lit ? 3.4 : 2.4}
                fill={led.lit ? palette.lit : palette.dim}
                className={
                  led.color === "off"
                    ? "plan-led off"
                    : led.lit
                      ? `plan-led lit ${led.color}`
                      : "plan-led"
                }
              />
            );
          })}
        </g>


        {/* ================= STAIR DIRECTION ================= */}

        {[...stairArrows.entries()].map(([nodeId, direction]) => {

          const node = nodeById.get(nodeId);

          if (!node) {
            return null;
          }

          return (
            <g key={`arrow-${nodeId}`} transform={`translate(${node.x} ${node.y - 8})`}>
              <rect x={-24} y={-11} width={48} height={18} rx={9} className="plan-stair-badge" />
              <text y={2} className="plan-stair-text">
                {direction === "up" ? "▲ UP" : "▼ DOWN"}
              </text>
            </g>
          );
        })}


        {/* ================= DOORS (ground floor) ================= */}

        {floor === 1 &&
          simulation.doors.map((door) => {

            const pos = DOOR_POSITIONS[door.id];

            if (!pos) {
              return null;
            }

            const closed =
              door.state === "closed" ||
              door.state === "isolating";

            const locked = door.state === "locked";

            const length = 22;

            return (
              <g key={door.id}>
                <rect
                  x={pos.vertical ? pos.x - 3 : pos.x - length / 2}
                  y={pos.vertical ? pos.y - length / 2 : pos.y - 3}
                  width={pos.vertical ? 6 : length}
                  height={pos.vertical ? length : 6}
                  rx={2}
                  className={
                    locked
                      ? "plan-door locked"
                      : closed
                        ? "plan-door closed"
                        : "plan-door"
                  }
                >
                  <title>{`${door.id}: ${door.state}`}</title>
                </rect>

                {locked && (
                  <text
                    x={pos.x + (pos.vertical ? 10 : 0)}
                    y={pos.y + (pos.vertical ? 3 : -7)}
                    className="plan-lock-icon"
                  >
                    🔒
                  </text>
                )}
              </g>
            );
          })}


        {/* ================= SENSOR NODES ================= */}

        {simulation.sensors
          .filter((sensor) => sensor.floor === floor)
          .map((sensor) => (
            <g
              key={sensor.id}
              transform={`translate(${sensor.x} ${sensor.y})`}
              className={`plan-sensor ${sensor.status}`}
            >
              <title>{`${sensor.id} · ${sensor.status}`}</title>
              {sensor.status !== "idle" && (
                <circle r={11} className="plan-sensor-ring" />
              )}
              <rect x={-5} y={-5} width={10} height={10} rx={2.5} />
              <circle r={1.8} className="plan-sensor-eye" />
            </g>
          ))}


        {/* ================= SEALED THREAT ZONE ================= */}

        {simulation.threat?.contained &&
          simulation.threat.zone.map((nodeId) => {
            const node = nodeById.get(nodeId);
            if (!node || node.floor !== floor) return null;
            return (
              <circle
                key={`zone-${nodeId}`}
                cx={node.x}
                cy={node.y}
                r={44}
                className="plan-sealed-zone"
              />
            );
          })}


        {/* ================= SECURITY THREAT ================= */}

        {threat && (
          <g
            transform={`translate(${threat.x.toFixed(1)} ${threat.y.toFixed(1)})`}
            className={threat.contained ? "plan-threat contained" : "plan-threat"}
          >
            <title>{threat.contained ? "Security threat — contained" : "Security threat"}</title>
            <circle r={26} className="plan-threat-zone" />
            <circle r={13} className="plan-threat-ring" />
            <circle cy={-9} r={5} className="plan-threat-head" />
            <rect x={-6.5} y={-4} width={13} height={14} rx={4} className="plan-threat-body" />
            <text y={-22} className="plan-threat-label">
              {threat.contained ? "CONTAINED" : "THREAT"}
            </text>
          </g>
        )}


        {/* ================= PEOPLE ================= */}

        {placed.map(({ person, position: [x, y] }) => {

          if (floorOf(person) !== floor) {
            return null;
          }

          const color = STATE_COLORS[person.state];

          return (
            <g
              key={person.id}
              transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
              className={`plan-person ${person.state}`}
            >
              <title>
                {`${person.id} · ${person.type} · ${person.state}`}
              </title>

              {(person.state === "trapped" || person.state === "waiting") && (
                <circle
                  r={14}
                  className={
                    person.state === "trapped"
                      ? "plan-person-alert"
                      : "plan-person-waiting"
                  }
                />
              )}

              <circle cy={-9} r={4.5} fill="#2f3539" />

              <rect
                x={-5.5}
                y={-4}
                width={11}
                height={13}
                rx={4}
                fill={color}
              />

              {person.type === "wheelchair" && (
                <circle
                  cx={0}
                  cy={11}
                  r={4}
                  fill="none"
                  stroke="#2f3539"
                  strokeWidth={1.4}
                />
              )}
            </g>
          );
        })}


        {/* ================= LABELS ================= */}

        <text x={BUILDING.x} y={-12} className="plan-label tag" textAnchor="start">
          LEVEL {String(floor).padStart(2, "0")}
          {floor > 1 ? " · NO EXITS — USE STAIRS" : ""}
        </text>

        <g transform={`translate(${BUILDING.x + BUILDING.w - 10} -16)`}>
          <circle r={10} className="plan-north" />
          <text y={4} className="plan-label small">N</text>
        </g>

      </svg>
    </div>
  );
}
