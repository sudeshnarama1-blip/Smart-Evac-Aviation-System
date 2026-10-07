import { useEffect, useRef } from "react";
import * as THREE from "three";

import type {
  Person,
  SimulationState,
} from "../simulation/types/simulation";

import { isExitBlocked } from "../simulation/routing/pathfinding";

import {
  AREAS,
  BUILDING,
  FLOORS,
  areaKind,
  createPlacement,
} from "./buildingLayout";

import type { Rect } from "./buildingLayout";

import { LED_COLORS, computeLeds } from "./ledGuidance";


// ============================================================
// 3D CUTAWAY
// ============================================================
//
// Uses the SAME building coordinates as the 2D plan and the
// simulation (building.ts). One helper, toWorld(), converts
// plan x/y → 3D x/z, so people, rooms, routes and hazards
// always line up.
// ============================================================

interface Building3DProps {
  simulation: SimulationState;
}


// ------------------------------------------------------------
// COORDINATES
// ------------------------------------------------------------

// 45 plan units = 1 metre-ish in 3D.
const SCALE = 1 / 45;

const CENTER_X = BUILDING.x + BUILDING.w / 2;
const CENTER_Y = BUILDING.y + BUILDING.h / 2;

const FLOOR_HEIGHT = 3;
const FLOOR_COUNT = FLOORS.length;

// Height of the cut-away walls
const WALL_HEIGHT = 1.1;

function toWorld(x: number, y: number): [number, number] {
  return [
    (x - CENTER_X) * SCALE,
    (y - CENTER_Y) * SCALE,
  ];
}

function floorElevation(floor: number): number {
  return (floor - 1) * FLOOR_HEIGHT;
}


// ------------------------------------------------------------
// COLOURS
// ------------------------------------------------------------

const PERSON_COLORS: Record<Person["state"], number> = {
  normal: 0x7d858a,
  evacuating: 0xd7a63d,
  safe: 0x48b97b,
  waiting: 0x3b82c4,
  trapped: 0xe04444,
  avoiding: 0xf0784b,
};

const HAZARD_COLORS: Record<string, number> = {
  fire: 0xff5a2e,
  flood: 0x2a8bd6,
  chemical: 0x9bc93a,
  earthquake: 0xd8962f,
  security: 0xe23d3d,
};


// ============================================================
// COMPONENT
// ============================================================

export default function Building3D({
  simulation,
}: Building3DProps) {

  const containerRef =
    useRef<HTMLDivElement | null>(null);

  const simulationRef =
    useRef<SimulationState>(simulation);


  // Keep the newest simulation available to
  // the Three.js animation loop.
  useEffect(() => {
    simulationRef.current = simulation;
  }, [simulation]);


  useEffect(() => {

    const container = containerRef.current;

    if (!container) {
      return;
    }


    // ==========================================================
    // SCENE, CAMERA, RENDERER
    // ==========================================================

    const scene = new THREE.Scene();

    scene.background = new THREE.Color("#111315");

    const camera =
      new THREE.PerspectiveCamera(
        42,
        Math.max(container.clientWidth, 1) /
          Math.max(container.clientHeight, 1),
        0.1,
        1000
      );

    const renderer =
      new THREE.WebGLRenderer({ antialias: true });

    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, 2)
    );

    renderer.setSize(
      container.clientWidth,
      container.clientHeight
    );

    container.appendChild(renderer.domElement);


    // Everything we create goes in here so
    // cleanup can dispose of it reliably.
    const disposables: { dispose: () => void }[] = [];

    const track = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };


    // ==========================================================
    // LIGHTS
    // ==========================================================

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));

    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(10, 18, 12);
    scene.add(sun);


    // ==========================================================
    // ROOT (shaken during earthquakes)
    // ==========================================================

    const root = new THREE.Group();
    scene.add(root);


    // ==========================================================
    // FLOOR SLABS
    // ==========================================================

    const slabWidth = BUILDING.w * SCALE;
    const slabDepth = BUILDING.h * SCALE;

    const slabGeometry =
      track(new THREE.BoxGeometry(slabWidth, 0.08, slabDepth));

    for (let floor = 1; floor <= FLOOR_COUNT; floor++) {

      const material =
        track(
          new THREE.MeshStandardMaterial({
            color: floor === 1 ? 0xb9bfc1 : 0x9ba2a5,
            transparent: true,
            opacity: floor === 1 ? 0.55 : 0.2,
            side: THREE.DoubleSide,
            depthWrite: floor === 1,
          })
        );

      const slab = new THREE.Mesh(slabGeometry, material);

      slab.position.y = floorElevation(floor) - 0.04;

      root.add(slab);


      // Outline of each slab
      const edges =
        track(new THREE.EdgesGeometry(slabGeometry));

      const outline =
        new THREE.LineSegments(
          edges,
          track(
            new THREE.LineBasicMaterial({
              color: 0x6c7579,
              transparent: true,
              opacity: floor === 1 ? 0.9 : 0.35,
            })
          )
        );

      outline.position.copy(slab.position);

      root.add(outline);
    }


    // Corner columns
    const columnGeometry =
      track(
        new THREE.BoxGeometry(
          0.12,
          FLOOR_HEIGHT * (FLOOR_COUNT - 1),
          0.12
        )
      );

    const columnMaterial =
      track(
        new THREE.MeshStandardMaterial({
          color: 0x7d8589,
          transparent: true,
          opacity: 0.35,
        })
      );

    for (const [cx, cz] of [
      [-slabWidth / 2, -slabDepth / 2],
      [slabWidth / 2, -slabDepth / 2],
      [-slabWidth / 2, slabDepth / 2],
      [slabWidth / 2, slabDepth / 2],
    ]) {

      const column = new THREE.Mesh(columnGeometry, columnMaterial);

      column.position.set(
        cx,
        (FLOOR_HEIGHT * (FLOOR_COUNT - 1)) / 2,
        cz
      );

      root.add(column);
    }


    // ==========================================================
    // ROOMS ON EVERY FLOOR (cut-away walls)
    // ==========================================================

    const AREA_COLORS: Record<string, { color: number; opacity: number }> = {
      room:     { color: 0xe6e9e7, opacity: 0.07 },
      corridor: { color: 0xcfd4d1, opacity: 0.04 },
      stair:    { color: 0xb4bbbd, opacity: 0.14 },
      refuge:   { color: 0x42c982, opacity: 0.16 },
      core:     { color: 0x6c7579, opacity: 0.1 },
    };

    const addRoomBox = (
      rect: Rect,
      floor: number,
      kind: string,
    ) => {

      const style = AREA_COLORS[kind] ?? AREA_COLORS.room;

      const [x, z] =
        toWorld(
          rect.x + rect.w / 2,
          rect.y + rect.h / 2
        );

      const geometry =
        track(
          new THREE.BoxGeometry(
            rect.w * SCALE,
            WALL_HEIGHT,
            rect.h * SCALE
          )
        );

      const walls =
        new THREE.Mesh(
          geometry,
          track(
            new THREE.MeshStandardMaterial({
              color: style.color,
              transparent: true,
              opacity: style.opacity,
              depthWrite: false,
            })
          )
        );

      walls.position.set(
        x,
        floorElevation(floor) + WALL_HEIGHT / 2,
        z
      );

      root.add(walls);


      const outline =
        new THREE.LineSegments(
          track(new THREE.EdgesGeometry(geometry)),
          track(
            new THREE.LineBasicMaterial({
              color: kind === "refuge" ? 0x42c982 : 0x8d969a,
              transparent: true,
              opacity: floor === 1 ? 1 : 0.55,
            })
          )
        );

      outline.position.copy(walls.position);

      root.add(outline);
    };

    for (const floor of FLOORS) {
      for (const area of AREAS) {
        addRoomBox(area.rect, floor, areaKind(area, floor));
      }
    }


    // ==========================================================
    // EXITS (green / red markers)
    // ==========================================================

    const exitMeshes = new Map<string, THREE.Mesh>();

    const exitGeometry =
      track(new THREE.BoxGeometry(0.5, 1.8, 0.9));

    for (const node of simulationRef.current.nodes) {

      if (node.type !== "exit") {
        continue;
      }

      const [x, z] = toWorld(node.x, node.y);

      const exit =
        new THREE.Mesh(
          exitGeometry,
          track(
            new THREE.MeshStandardMaterial({
              color: 0x42c982,
              emissive: 0x0f4a2c,
            })
          )
        );

      exit.position.set(x, 0.9, z);

      root.add(exit);

      exitMeshes.set(node.id, exit);
    }


    // ==========================================================
    // WATER (rises with flood intensity)
    // ==========================================================

    const waterGeometry =
      track(
        new THREE.BoxGeometry(
          slabWidth - 0.05,
          1,
          slabDepth - 0.05
        )
      );

    const waterMaterial =
      track(
        new THREE.MeshStandardMaterial({
          color: 0x298bd1,
          transparent: true,
          opacity: 0.4,
          metalness: 0.2,
          roughness: 0.15,
          depthWrite: false,
        })
      );

    const water = new THREE.Mesh(waterGeometry, waterMaterial);

    water.visible = false;

    root.add(water);


    // ==========================================================
    // HAZARD MARKERS
    // ==========================================================

    const hazardGeometry =
      track(new THREE.CylinderGeometry(1.2, 1.2, 1.6, 32, 1, true));

    const hazardGroup = new THREE.Group();

    root.add(hazardGroup);


    // ==========================================================
    // PEOPLE (re-used meshes, updated every frame)
    // ==========================================================

    const headGeometry =
      track(new THREE.SphereGeometry(0.12, 14, 14));

    const bodyGeometry =
      track(new THREE.CylinderGeometry(0.1, 0.14, 0.42, 10));

    const headMaterial =
      track(new THREE.MeshStandardMaterial({ color: 0xd7dadd }));

    const peopleMeshes =
      new Map<
        string,
        {
          group: THREE.Group;
          bodyMaterial: THREE.MeshStandardMaterial;
        }
      >();

    const peopleGroup = new THREE.Group();

    root.add(peopleGroup);


    // ==========================================================
    // LED FLOOR STRIPS (rebuilt every frame)
    // ==========================================================

    const ledMaterial =
      track(
        new THREE.PointsMaterial({
          size: 0.17,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
        })
      );

    let ledPoints: THREE.Points | null = null;


    // ==========================================================
    // SENSOR NODES (on each floor's ceiling)
    // ==========================================================

    const sensorGeometry =
      track(new THREE.SphereGeometry(0.09, 10, 10));

    const sensorMeshes =
      new Map<string, THREE.MeshBasicMaterial>();

    for (const sensor of simulationRef.current.sensors) {

      const material =
        track(new THREE.MeshBasicMaterial({ color: 0x5f8f75 }));

      const mesh = new THREE.Mesh(sensorGeometry, material);

      const [x, z] = toWorld(sensor.x, sensor.y);

      mesh.position.set(
        x,
        floorElevation(sensor.floor) + WALL_HEIGHT + 0.12,
        z
      );

      root.add(mesh);

      sensorMeshes.set(sensor.id, material);
    }


    // ==========================================================
    // SECURITY THREAT
    // ==========================================================

    const threatGroup = new THREE.Group();

    const threatMaterial =
      track(new THREE.MeshStandardMaterial({
        color: 0xe23d3d,
        emissive: 0x5a0d0d,
      }));

    const threatBody =
      new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.13, 0.17, 0.5, 12)),
        threatMaterial
      );

    threatBody.position.y = 0.28;

    const threatHead =
      new THREE.Mesh(
        track(new THREE.SphereGeometry(0.14, 14, 14)),
        threatMaterial
      );

    threatHead.position.y = 0.66;

    const threatRingMaterial =
      track(new THREE.MeshBasicMaterial({
        color: 0xff4a4a,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false,
      }));

    const threatRing =
      new THREE.Mesh(
        track(new THREE.RingGeometry(0.45, 0.6, 32)),
        threatRingMaterial
      );

    threatRing.rotation.x = -Math.PI / 2;
    threatRing.position.y = 0.04;

    threatGroup.add(threatBody, threatHead, threatRing);

    threatGroup.visible = false;

    root.add(threatGroup);


    // ==========================================================
    // GRID
    // ==========================================================

    const grid = new THREE.GridHelper(40, 40, 0x41484d, 0x252a2d);

    grid.position.y = -0.1;

    scene.add(grid);

    track(grid.geometry);


    // ==========================================================
    // ORBIT CAMERA (drag to rotate, wheel to zoom)
    // ==========================================================

    let azimuth = 0.75;
    let elevation = 0.62;
    let distance = 24;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const updateCamera = () => {

      camera.position.set(
        distance * Math.cos(elevation) * Math.sin(azimuth),
        distance * Math.sin(elevation),
        distance * Math.cos(elevation) * Math.cos(azimuth)
      );

      camera.lookAt(0, 1.5, 0);
    };

    updateCamera();

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {

      if (!dragging) {
        return;
      }

      azimuth -= (event.clientX - lastX) * 0.006;

      elevation =
        Math.min(
          1.45,
          Math.max(
            0.12,
            elevation + (event.clientY - lastY) * 0.006
          )
        );

      lastX = event.clientX;
      lastY = event.clientY;

      updateCamera();
    };

    const onPointerUp = () => {
      dragging = false;
    };

    const onWheel = (event: WheelEvent) => {

      event.preventDefault();

      distance =
        Math.min(
          45,
          Math.max(
            10,
            distance * (event.deltaY > 0 ? 1.08 : 0.92)
          )
        );

      updateCamera();
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });


    // ==========================================================
    // ANIMATION LOOP
    // ==========================================================

    let frameId = 0;

    const animate = (time: number) => {

      frameId = requestAnimationFrame(animate);

      const current = simulationRef.current;

      const nodeById =
        new Map(current.nodes.map((node) => [node.id, node]));


      // ---------------- earthquake shake ----------------

      if (current.disaster === "earthquake" && current.simulationRunning) {

        root.position.x = Math.sin(time * 0.045) * 0.06;
        root.position.z = Math.cos(time * 0.037) * 0.05;

      } else {

        root.position.set(0, 0, 0);
      }


      // ---------------- water level ----------------

      const flood =
        current.hazards.find(
          (hazard) => hazard.type === "flood" && hazard.active
        );

      if (flood) {

        // Up to about knee/waist height on the ground floor
        const depth = 0.1 + flood.intensity * 1.1;

        water.visible = true;
        water.scale.y = depth;
        water.position.y = depth / 2;
        waterMaterial.opacity = 0.25 + flood.intensity * 0.25;

      } else {

        water.visible = false;
      }


      // ---------------- exits ----------------

      for (const [exitId, mesh] of exitMeshes) {

        const blocked =
          isExitBlocked(
            exitId,
            current.edges,
            current.nodes,
            current.disaster
          );

        const material = mesh.material as THREE.MeshStandardMaterial;

        material.color.setHex(blocked ? 0xe04444 : 0x42c982);
        material.emissive.setHex(blocked ? 0x4a0f0f : 0x0f4a2c);
      }


      // ---------------- hazards ----------------

      // Few hazards, so just rebuild these
      for (const child of [...hazardGroup.children]) {

        hazardGroup.remove(child);

        const mesh = child as THREE.Mesh;

        (mesh.material as THREE.Material).dispose();
      }

      for (const hazard of current.hazards) {

        if (!hazard.active || !hazard.nodeId || hazard.type === "flood") {
          continue;
        }

        const node = nodeById.get(hazard.nodeId);

        if (!node) {
          continue;
        }

        const [x, z] = toWorld(node.x, node.y);

        const pulse = 0.85 + Math.sin(time * 0.006) * 0.15;

        const marker =
          new THREE.Mesh(
            hazardGeometry,
            new THREE.MeshBasicMaterial({
              color: HAZARD_COLORS[hazard.type] ?? 0xff4444,
              transparent: true,
              opacity: 0.32 * pulse,
              side: THREE.DoubleSide,
              depthWrite: false,
            })
          );

        marker.position.set(x, 0.8 + floorElevation(node.floor), z);
        marker.scale.set(pulse, 1, pulse);

        hazardGroup.add(marker);
      }


      // ---------------- people ----------------

      const seen = new Set<string>();

      const placePerson = createPlacement(nodeById);

      current.people.forEach((person, index) => {

        seen.add(person.id);

        let entry = peopleMeshes.get(person.id);

        if (!entry) {

          const group = new THREE.Group();

          const head = new THREE.Mesh(headGeometry, headMaterial);
          head.position.y = 0.58;

          const bodyMaterial =
            track(new THREE.MeshStandardMaterial({ color: 0x7d858a }));

          const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
          body.position.y = 0.25;

          group.add(head, body);

          peopleGroup.add(group);

          entry = { group, bodyMaterial };

          peopleMeshes.set(person.id, entry);
        }


        // Same placement rules as the 2D plan
        const [planX, planY] = placePerson(person, index);

        const [x, z] = toWorld(planX, planY);

        // person.z is the (fractional) floor, so people
        // visibly climb while on the stairs.
        entry.group.position.set(
          x,
          floorElevation(person.z),
          z
        );

        entry.bodyMaterial.color.setHex(PERSON_COLORS[person.state]);
      });

      // Remove anyone no longer in the simulation
      for (const [id, entry] of peopleMeshes) {

        if (!seen.has(id)) {

          peopleGroup.remove(entry.group);
          peopleMeshes.delete(id);
        }
      }


      // ---------------- LED floor strips ----------------

      if (ledPoints) {
        root.remove(ledPoints);
        ledPoints.geometry.dispose();
        ledPoints = null;
      }

      const leds = computeLeds(current);

      if (leds.length > 0) {

        const positions: number[] = [];
        const colors: number[] = [];

        const color = new THREE.Color();

        for (const led of leds) {

          const [x, z] = toWorld(led.x, led.y);

          positions.push(x, floorElevation(led.floor) + 0.03, z);

          const palette = LED_COLORS[led.color];

          color.set(
            led.color === "off"
              ? "#3a4044"
              : led.lit
                ? palette.lit
                : palette.dim
          );

          colors.push(color.r, color.g, color.b);
        }

        const geometry = new THREE.BufferGeometry();

        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(positions, 3)
        );

        geometry.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(colors, 3)
        );

        ledPoints = new THREE.Points(geometry, ledMaterial);

        root.add(ledPoints);
      }


      // ---------------- sensors ----------------

      for (const sensor of current.sensors) {

        const material = sensorMeshes.get(sensor.id);

        if (!material) continue;

        material.color.setHex(
          sensor.status === "source"
            ? 0xff3b3b
            : sensor.status === "alert"
              ? 0xffb02e
              : 0x5f8f75
        );
      }


      // ---------------- security threat ----------------

      const threat = current.threat;

      if (threat) {

        const [x, z] = toWorld(threat.x, threat.y);

        threatGroup.visible = true;

        threatGroup.position.set(x, floorElevation(threat.floor), z);

        const pulse = 1 + Math.sin(time * 0.008) * 0.15;

        threatRing.scale.set(pulse, pulse, pulse);

        threatRingMaterial.color.setHex(
          threat.contained ? 0xffb02e : 0xff4a4a
        );

      } else {

        threatGroup.visible = false;
      }


      renderer.render(scene, camera);
    };

    frameId = requestAnimationFrame(animate);


    // ==========================================================
    // RESIZE (follows the container, not just the window)
    // ==========================================================

    const resize = () => {

      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);

      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      renderer.setSize(width, height);
    };

    const observer = new ResizeObserver(resize);

    observer.observe(container);


    // ==========================================================
    // CLEANUP
    // ==========================================================

    return () => {

      cancelAnimationFrame(frameId);

      observer.disconnect();

      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);

      for (const child of hazardGroup.children) {
        ((child as THREE.Mesh).material as THREE.Material).dispose();
      }

      if (ledPoints) {
        ledPoints.geometry.dispose();
      }

      for (const item of disposables) {
        item.dispose();
      }

      renderer.dispose();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };

  }, []);


  return (
    <div
      ref={containerRef}
      className="building-3d"
    />
  );
}
