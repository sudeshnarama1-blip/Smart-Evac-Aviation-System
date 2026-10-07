import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import Building3D from "./components/Building3D";
import FloorPlan2D from "./components/FloorPlan2D";

import {
  activateDisaster,
  createInitialSimulation,
  resetSimulation,
  updateSimulation,
} from "./simulation/simulationEngine";

import type {
  DisasterType,
  SimulationState,
} from "./simulation/types/simulation";

import "./App.css";


// ============================================================
// TYPES
// ============================================================

type ViewMode = "2d" | "3d";


// ============================================================
// MAIN APP
// ============================================================

function App() {

  const [simulation, setSimulation] =
    useState<SimulationState>(
      createInitialSimulation()
    );

  const [viewMode, setViewMode] =
    useState<ViewMode>("2d");

  const lastTime =
    useRef<number | null>(null);


  // ==========================================================
  // SIMULATION LOOP
  // ==========================================================

  useEffect(() => {

    let frameId: number;

    const tick = (time: number) => {

      if (lastTime.current === null) {
        lastTime.current = time;
      }

      const delta =
        Math.min(
          (time - lastTime.current) / 1000,
          0.1
        );

      lastTime.current = time;


      setSimulation(
        current => {

          if (
            current.simulationRunning === false
          ) {
            return current;
          }

          return updateSimulation(
            current,
            delta
          );
        }
      );


      frameId =
        requestAnimationFrame(
          tick
        );
    };


    frameId =
      requestAnimationFrame(
        tick
      );


    return () => {

      cancelAnimationFrame(
        frameId
      );

    };

  }, []);


  // ==========================================================
  // SCENARIO
  // ==========================================================

  const changeScenario = (
    disaster: DisasterType
  ) => {

    // Functional update: always work from the
    // latest simulation frame, never a stale copy.
    setSimulation(
      current =>
        activateDisaster(
          disaster,
          current
        )
    );


    /*
     * 2D is better for:
     * Fire
     * Chemical
     * Security
     *
     * 3D is better for:
     * Flood
     * Earthquake
     */

    if (
      disaster === "flood" ||
      disaster === "earthquake"
    ) {

      setViewMode("3d");

    } else {

      setViewMode("2d");

    }
  };


  // ==========================================================
  // RESET
  // ==========================================================

  const reset = () => {

    setSimulation(
      resetSimulation()
    );

    setViewMode("2d");

    lastTime.current = null;
  };


  // ==========================================================
  // PLAY / PAUSE
  // ==========================================================

  const toggleSimulation = () => {

    setSimulation(
      current => ({
        ...current,

        simulationRunning:
          !current.simulationRunning,
      })
    );
  };


  // ==========================================================
  // STATISTICS
  // ==========================================================

  const total =
    simulation.people.length;


  const evacuating =
    simulation.people.filter(
      person =>
        person.state === "evacuating"
    ).length;


  const safe =
    simulation.people.filter(
      person =>
        person.state === "safe"
    ).length;


  const trapped =
    simulation.people.filter(
      person =>
        person.state === "trapped"
    ).length;


  // People who cannot use stairs, waiting at a
  // stair landing for assisted evacuation.
  const waiting =
    simulation.people.filter(
      person =>
        person.state === "waiting"
    ).length;


  const scenarioName =
    simulation.disaster === "normal"
      ? "NORMAL OPERATIONS"
      : `${simulation.disaster.toUpperCase()} RESPONSE`;


  return (
    <div className="evac-app">


      {/* ====================================================
          HEADER
      ==================================================== */}

      <header className="topbar">

        <div className="brand">

          <div className="brand-symbol">
            AE
          </div>

          <div className="brand-text">

            <strong>
              ADAPTIVE EVACUATION
            </strong>

            <span>
              ALL-HAZARD BUILDING SIMULATION
            </span>

          </div>

        </div>


        <div className="top-center">

          <span>
            BUILDING / A-01
          </span>

          <span className="separator">
            /
          </span>

          <span>
            LIVE SIMULATION
          </span>

        </div>


        <div className="system-state">

          <span
            className={
              simulation.alarmActive
                ? "state-light emergency"
                : "state-light"
            }
          />

          <span>

            {simulation.lockdown
              ? "LOCKDOWN ACTIVE"
              : simulation.alarmActive
                ? "EMERGENCY ACTIVE"
                : "SYSTEM OPERATIONAL"}

          </span>

        </div>

      </header>


      {/* ====================================================
          MAIN
      ==================================================== */}

      <main className="main-layout">


        {/* ==================================================
            LEFT CONTROL PANEL
        ================================================== */}

        <aside className="sidebar">


          <div className="sidebar-section">

            <div className="section-label">
              EMERGENCY SCENARIO
            </div>


            <ScenarioButton
              label="Normal"
              icon="○"
              active={
                simulation.disaster === "normal"
              }
              onClick={() =>
                changeScenario("normal")
              }
            />


            <ScenarioButton
              label="Fire"
              icon="🔥"
              active={
                simulation.disaster === "fire"
              }
              onClick={() =>
                changeScenario("fire")
              }
            />


            <ScenarioButton
              label="Flood"
              icon="≈"
              active={
                simulation.disaster === "flood"
              }
              onClick={() =>
                changeScenario("flood")
              }
            />


            <ScenarioButton
              label="Chemical"
              icon="☣"
              active={
                simulation.disaster === "chemical"
              }
              onClick={() =>
                changeScenario("chemical")
              }
            />


            <ScenarioButton
              label="Earthquake"
              icon="⚠"
              active={
                simulation.disaster === "earthquake"
              }
              onClick={() =>
                changeScenario("earthquake")
              }
            />


            <ScenarioButton
              label="Security"
              icon="●"
              active={
                simulation.disaster === "security"
              }
              onClick={() =>
                changeScenario("security")
              }
            />

          </div>


          {/* ==================================================
              VIEW
          ================================================== */}

          <div className="sidebar-divider" />


          <div className="sidebar-section">

            <div className="section-label">
              VISUALIZATION
            </div>


            <button
              className={
                viewMode === "2d"
                  ? "view-option selected"
                  : "view-option"
              }
              onClick={() =>
                setViewMode("2d")
              }
            >

              <span className="view-icon">
                ▦
              </span>

              2D FLOOR PLAN

            </button>


            <button
              className={
                viewMode === "3d"
                  ? "view-option selected"
                  : "view-option"
              }
              onClick={() =>
                setViewMode("3d")
              }
            >

              <span className="view-icon">
                ◇
              </span>

              3D CUTAWAY

            </button>

          </div>


          {/* ==================================================
              CONTROLS
          ================================================== */}

          <div className="sidebar-bottom">

            <button
              className="start-button"
              onClick={toggleSimulation}
            >

              <span>
                {
                  simulation.simulationRunning
                    ? "Ⅱ"
                    : "▶"
                }
              </span>

              {
                simulation.simulationRunning
                  ? "PAUSE SIMULATION"
                  : "START SIMULATION"
              }

            </button>


            <button
              className="reset-button"
              onClick={reset}
            >

              ↻ RESET SYSTEM

            </button>

          </div>

        </aside>


        {/* ==================================================
            BUILDING
        ================================================== */}

        <section className="building-area">


          <div className="building-header">

            <div>

              <div className="building-overline">
                LIVE BUILDING MODEL
              </div>

              <h1>
                {scenarioName}
              </h1>

            </div>


            <div className="view-mode-label">

              {
                viewMode === "2d"
                  ? "ARCHITECTURAL FLOOR PLAN"
                  : "TRANSPARENT 3D CUTAWAY"
              }

            </div>

          </div>


          {/* =================================================
              VISUALIZATION
          ================================================= */}

          {/* =================================================
              ALARM BANNER
          ================================================= */}

          {simulation.alarmMessage ? (

            <div
              className={
                `alarm-banner ${simulation.disaster}` +
                (simulation.threat?.contained ? " contained" : "")
              }
              role="alert"
            >
              <span className="alarm-icon">
                {simulation.disaster === "security" ? "🔒" : "⚠"}
              </span>

              <span className="alarm-text">
                {simulation.alarmMessage}
              </span>
            </div>

          ) : simulation.disaster !== "normal" && !simulation.detected ? (

            <div className="alarm-banner verifying">
              <span className="alarm-icon">◉</span>
              <span className="alarm-text">
                SENSOR ANOMALY — VERIFYING…
              </span>
            </div>

          ) : null}


          <div className="building-stage">

            {
              viewMode === "3d"

                ?

                <Building3D
                  simulation={
                    simulation
                  }
                />

                :

                <FloorPlan2D
                  simulation={
                    simulation
                  }
                />
            }

          </div>


          {/* =================================================
              METRICS
          ================================================= */}

          <div className="metrics-bar">

            <Metric
              label="OCCUPANTS"
              value={total}
            />

            <Metric
              label="EVACUATING"
              value={evacuating}
            />

            <Metric
              label="SAFE"
              value={safe}
              green
            />

            <Metric
              label="TRAPPED"
              value={trapped}
              red={
                trapped > 0
              }
            />

            <Metric
              label="SIMULATION"
              value={
                `${simulation.time.toFixed(1)}s`
              }
            />

          </div>

        </section>


        {/* ==================================================
            RIGHT PANEL
        ================================================== */}

        <aside className="right-panel">


          <InfoCard
            title="CURRENT EVENT"
          >

            <div className="event-name">

              {
                simulation.disaster ===
                "normal"

                  ? "NO ACTIVE THREAT"

                  : simulation.disaster
                      .toUpperCase()
              }

            </div>


            <div className="event-status">

              <span
                className={
                  simulation.alarmActive
                    ? "tiny-light red"
                    : "tiny-light green"
                }
              />

              {
                simulation.alarmActive
                  ? "RESPONSE PROTOCOL ACTIVE"
                  : "MONITORING"
              }

            </div>

          </InfoCard>


          <InfoCard
            title="SENSOR NETWORK"
          >

            <StatusRow
              label="Sensors online"
              value={simulation.sensors.length}
              green
            />

            <StatusRow
              label="Alerting"
              value={
                simulation.sensors.filter(
                  sensor => sensor.status !== "idle"
                ).length
              }
              red
            />

          </InfoCard>


          <InfoCard
            title="DETECTION LOG"
          >

            <div className="event-log">

              {simulation.events.map((event, index) => (

                <div
                  key={`${event.time}-${index}`}
                  className={`event-row ${event.level}`}
                >
                  <span className="event-time">
                    {event.time.toFixed(1)}s
                  </span>

                  <span className="event-text">
                    {event.text}
                  </span>
                </div>

              ))}

            </div>

          </InfoCard>


          <InfoCard
            title="OCCUPANTS"
          >

            <div className="occupant-number">
              {total}
            </div>

            <div className="occupant-caption">
              PEOPLE DETECTED
            </div>


            <div className="occupant-grid">

              <div>

                <strong>
                  {evacuating}
                </strong>

                <span>
                  MOVING
                </span>

              </div>


              <div>

                <strong className="green-text">
                  {safe}
                </strong>

                <span>
                  SAFE
                </span>

              </div>


              <div>

                <strong
                  className={
                    trapped > 0
                      ? "red-text"
                      : ""
                  }
                >
                  {trapped}
                </strong>

                <span>
                  TRAPPED
                </span>

              </div>


              <div>

                <strong className="blue-text">
                  {waiting}
                </strong>

                <span>
                  ASSIST
                </span>

              </div>

            </div>

          </InfoCard>


          <InfoCard
            title="DOOR NETWORK"
          >

            <StatusRow
              label="Open"
              value={
                simulation.doors.filter(
                  door =>
                    door.state === "open"
                ).length
              }
              green
            />


            <StatusRow
              label="Isolating"
              value={
                simulation.doors.filter(
                  door =>
                    door.state ===
                    "isolating"
                ).length
              }
              red
            />

            <StatusRow
              label="Locked (lockdown)"
              value={
                simulation.doors.filter(
                  door =>
                    door.state ===
                    "locked"
                ).length
              }
              red
            />

          </InfoCard>


          <InfoCard
            title="LEGEND"
          >

            <Legend
              symbol="•••"
              label="LED strip — walk this way"
              route
            />

            <Legend
              symbol="●"
              label="Occupant"
            />

            <Legend
              symbol="■"
              label="Emergency exit"
              exit
            />

            <Legend
              symbol="!"
              label="Hazard"
              hazard
            />

            <Legend
              symbol="✕"
              label="Blocked exit (never routed)"
              hazard
            />

            <Legend
              symbol="▲"
              label="Stair to a higher floor"
              route
            />

            <Legend
              symbol="◌"
              label="Waiting for assisted evacuation"
            />

            <Legend
              symbol="•••"
              label="Red LEDs — danger, do not enter"
              hazard
            />

            <Legend
              symbol="■"
              label="Sensor node (red = detecting)"
            />

            <Legend
              symbol="🔒"
              label="Door locked in lockdown"
            />

          </InfoCard>

        </aside>

      </main>

    </div>
  );
}


// ============================================================
// SCENARIO BUTTON
// ============================================================

function ScenarioButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}) {

  return (
    <button
      className={
        active
          ? "scenario-button active"
          : "scenario-button"
      }
      onClick={onClick}
    >

      <span className="scenario-icon">
        {icon}
      </span>

      <span>
        {label}
      </span>

      {active && (
        <span className="active-marker">
          ●
        </span>
      )}

    </button>
  );
}


// ============================================================
// INFO CARD
// ============================================================

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {

  return (
    <div className="right-card">

      <div className="card-label">
        {title}
      </div>

      {children}

    </div>
  );
}


// ============================================================
// METRIC
// ============================================================

function Metric({
  label,
  value,
  green,
  red,
}: {
  label: string;
  value: string | number;
  green?: boolean;
  red?: boolean;
}) {

  return (
    <div className="metric">

      <span>
        {label}
      </span>

      <strong
        className={
          green
            ? "green-text"
            : red
              ? "red-text"
              : ""
        }
      >
        {value}
      </strong>

    </div>
  );
}


// ============================================================
// STATUS ROW
// ============================================================

function StatusRow({
  label,
  value,
  green,
  red,
}: {
  label: string;
  value: number;
  green?: boolean;
  red?: boolean;
}) {

  return (
    <div className="door-status-row">

      <span>
        {label}
      </span>

      <strong
        className={
          green
            ? "green-text"
            : red
              ? "red-text"
              : ""
        }
      >
        {value}
      </strong>

    </div>
  );
}


// ============================================================
// LEGEND
// ============================================================

function Legend({
  symbol,
  label,
  route,
  exit,
  hazard,
}: {
  symbol: string;
  label: string;
  route?: boolean;
  exit?: boolean;
  hazard?: boolean;
}) {

  return (
    <div className="legend-row">

      <span
        className={[
          "legend-symbol",

          route
            ? "route-symbol"
            : "",

          exit
            ? "exit-symbol"
            : "",

          hazard
            ? "hazard-symbol"
            : "",
        ].join(" ")}
      >
        {symbol}
      </span>

      <span>
        {label}
      </span>

    </div>
  );
}


export default App;
