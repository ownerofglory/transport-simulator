import * as THREE from 'three';
import type { StationConfig } from '../../simulator/simulator-types';
import type { LatLon } from './trafficGeo';
import {
  PEDESTRIAN_HIP_HEIGHT_M,
  animatePedestrian,
  buildPedestrian,
  poseSeated,
  poseStanding,
  poseStandingHold,
  setPedestrianUmbrella,
  type PedestrianRig
} from './pedestrianMesh';
import { readInteriorFloorY, readSeatAnchors } from '../../vehicles/interiorSeating';
import { dampAngle } from './trafficPath';
import { trafficDensityScale } from './trafficDensity';
import type { TrafficDensity } from '../../app/types';
import { fetchTransitItineraries, type TransitItinerary } from './transitPassengerRoutingClient';
import type { WeatherKind } from '../weather';

export type TransitPassengerContext = {
  line: string;
  stationGeoAt(index: number): LatLon | undefined;
  stationWorldAt(index: number): THREE.Vector3;
  stationTangentAt(index: number): THREE.Vector3;
  vehicleRoot: THREE.Group;
  vehicleCars: THREE.Group[];
};

type Phase = 'waiting' | 'boarding' | 'riding' | 'alighting';

type Passenger = {
  originIndex: number;
  destinationIndex: number;
  phase: Phase;
  rig: PedestrianRig;
  from: THREE.Vector3;
  to: THREE.Vector3;
  transitionS: number;
  progressS: number;
  car: THREE.Group | null;
  /** Index into the car's registered seat anchors while riding, else null. */
  seatIndex: number | null;
};

type StationState = {
  stationIndex: number;
  loaded: boolean;
  attempted: boolean;
};

const PRELOAD_AHEAD_M = 420;
const STATION_TOLERANCE_M = 24;
const MAX_ACTIVE_PASSENGERS = 12;
const MAX_STATION_PASSENGERS = 4;
const BOARDING_DURATION_S = 1.3;
const ALIGHTING_DURATION_S = 1.1;

/**
 * Small visual passenger cohorts driven by scheduled public-transit journeys.
 * A query is made per approaching stop (not per person); only itineraries whose
 * first matching PT leg is the selected line are allowed to board this vehicle.
 */
export class TransitPassengerSystem {
  readonly root = new THREE.Group();
  private readonly passengers: Passenger[] = [];
  private readonly stations = new Map<number, StationState>();
  private readonly controllers = new Set<AbortController>();
  // Seats taken per car (by uuid), so two riders never share a cushion.
  private readonly occupiedSeats = new Map<string, Set<number>>();
  private disposed = false;
  private clockS = 0;
  private densityScale = 1;
  private wetWeather = false;

  constructor(private readonly ctx: TransitPassengerContext) {
    this.root.name = 'Transit passengers';
  }

  setWeather(kind: WeatherKind): void {
    this.wetWeather = kind === 'rain' || kind === 'thunder';
    for (const passenger of this.passengers) {
      setPedestrianUmbrella(passenger.rig, this.wetWeather && passenger.phase === 'waiting');
    }
  }

  update(vehicleDistanceM: number, stations: StationConfig[], doorsOpen: boolean, underground: boolean, dtSec: number): void {
    this.clockS += dtSec;
    this.root.visible = !underground;

    for (let index = 0; index < stations.length - 1; index++) {
      const aheadM = stations[index].distanceM - vehicleDistanceM;
      if (aheadM <= PRELOAD_AHEAD_M && aheadM >= -STATION_TOLERANCE_M) this.beginStation(index, stations);
    }

    const stationIndex = nearestStationIndex(vehicleDistanceM, stations);
    if (doorsOpen && stationIndex !== -1) {
      this.startBoardingAt(stationIndex, vehicleDistanceM, stations);
      this.startAlightingAt(stationIndex, vehicleDistanceM, stations);
    }

    for (let index = this.passengers.length - 1; index >= 0; index--) {
      const passenger = this.passengers[index];
      if (passenger.phase === 'waiting') {
        // A quiet stance keeps the queue alive without looking like walkers
        // pacing through a platform edge.
        passenger.rig.body.position.y = Math.sin(this.clockS * 1.6 + passenger.rig.phaseOffset) * 0.008;
        continue;
      }
      passenger.progressS += Math.min(Math.max(dtSec, 0), 0.2);
      const progress = THREE.MathUtils.clamp(passenger.progressS / passenger.transitionS, 0, 1);
      if (passenger.phase === 'boarding' || passenger.phase === 'alighting') {
        passenger.rig.root.position.lerpVectors(passenger.from, passenger.to, progress);
        const walkX = passenger.to.x - passenger.from.x;
        const walkZ = passenger.to.z - passenger.from.z;
        if (walkX * walkX + walkZ * walkZ > 0.01) {
          passenger.rig.root.rotation.y = dampAngle(
            passenger.rig.root.rotation.y,
            Math.atan2(walkX, walkZ),
            8,
            dtSec
          );
        }
        animatePedestrian(passenger.rig, passenger.progressS * 1.25);
      }
      if (progress < 1) continue;
      if (passenger.phase === 'boarding') this.enterVehicle(passenger);
      else if (passenger.phase === 'alighting') this.removePassenger(index);
    }
  }

  /**
   * Ambient population multiplier. One journey query is made per approaching
   * station whatever the density — a denser cohort just boards from the same
   * itinerary — so this never changes the request count.
   */
  setDensity(density: TrafficDensity): void {
    this.densityScale = trafficDensityScale(density);
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    for (const passenger of this.passengers) passenger.rig.root.removeFromParent();
    this.passengers.length = 0;
    this.occupiedSeats.clear();
    this.stations.clear();
    this.root.clear();
  }

  private beginStation(stationIndex: number, stations: StationConfig[]): void {
    const existing = this.stations.get(stationIndex);
    if (existing?.attempted) return;
    const state: StationState = existing ?? { stationIndex, loaded: false, attempted: false };
    state.attempted = true;
    this.stations.set(stationIndex, state);
    void this.loadStationJourney(state, stations);
  }

  private async loadStationJourney(state: StationState, stations: StationConfig[]): Promise<void> {
    const origin = this.ctx.stationGeoAt(state.stationIndex);
    const destinationIndex = pickDownstreamDestination(state.stationIndex, stations.length);
    const destination = destinationIndex === undefined ? undefined : this.ctx.stationGeoAt(destinationIndex);
    if (!origin || !destination || destinationIndex === undefined) return;

    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const itineraries = await fetchTransitItineraries(origin, destination, controller.signal);
      if (this.disposed || !itineraries || !this.stations.has(state.stationIndex)) return;
      if (!findBoardableItinerary(itineraries, this.ctx.line, stations[state.stationIndex].name, stations[destinationIndex].name)) return;
      state.loaded = true;
      this.spawnWaiting(state.stationIndex, destinationIndex);
    } finally {
      this.controllers.delete(controller);
    }
  }

  private spawnWaiting(originIndex: number, destinationIndex: number): void {
    const count = Math.min(
      MAX_STATION_PASSENGERS * this.densityScale,
      MAX_ACTIVE_PASSENGERS * this.densityScale - this.passengers.length
    );
    const station = this.ctx.stationWorldAt(originIndex);
    const tangent = this.ctx.stationTangentAt(originIndex);
    const lateral = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    for (let index = 0; index < count; index++) {
      const rig = buildPedestrian();
      setPedestrianUmbrella(rig, this.wetWeather);
      // Wrapped into rows of four: a denser cohort waits further along the
      // platform instead of trailing off sideways into the track bed.
      const row = index % 4;
      const column = Math.floor(index / 4);
      const offset = lateral
        .clone()
        .multiplyScalar(3.1 + row * 0.55)
        .addScaledVector(tangent, (row - 1.5) * 0.7 + column * 1.9);
      const position = station.clone().add(offset);
      rig.root.position.copy(position);
      rig.root.rotation.y = Math.atan2(tangent.x, tangent.z);
      this.root.add(rig.root);
      this.passengers.push({
        originIndex,
        destinationIndex,
        phase: 'waiting',
        rig,
        from: position.clone(),
        to: position.clone(),
        transitionS: 0,
        progressS: 0,
        car: null,
        seatIndex: null
      });
    }
  }

  private startBoardingAt(stationIndex: number, vehicleDistanceM: number, stations: StationConfig[]): void {
    for (const passenger of this.passengers) {
      if (passenger.phase !== 'waiting' || passenger.originIndex !== stationIndex) continue;
      const target = this.boardingTarget(vehicleDistanceM, stations, passenger.originIndex);
      passenger.phase = 'boarding';
      setPedestrianUmbrella(passenger.rig, false);
      passenger.from.copy(passenger.rig.root.position);
      passenger.to.copy(target);
      passenger.transitionS = BOARDING_DURATION_S + Math.random() * 0.45;
      passenger.progressS = 0;
    }
  }

  private startAlightingAt(stationIndex: number, vehicleDistanceM: number, stations: StationConfig[]): void {
    for (const passenger of this.passengers) {
      if (passenger.phase !== 'riding' || passenger.destinationIndex !== stationIndex) continue;
      const target = this.exitTarget(vehicleDistanceM, stations, stationIndex);
      this.releaseSeat(passenger);
      poseStanding(passenger.rig);
      passenger.rig.root.getWorldPosition(passenger.from);
      this.root.attach(passenger.rig.root);
      passenger.rig.root.position.copy(passenger.from);
      passenger.phase = 'alighting';
      setPedestrianUmbrella(passenger.rig, this.wetWeather);
      passenger.to.copy(target);
      passenger.transitionS = ALIGHTING_DURATION_S + Math.random() * 0.4;
      passenger.progressS = 0;
      passenger.car = null;
    }
  }

  private boardingTarget(vehicleDistanceM: number, stations: StationConfig[], stationIndex: number): THREE.Vector3 {
    const car = this.nearestCar(vehicleDistanceM, stations[stationIndex].distanceM);
    return car.getWorldPosition(new THREE.Vector3());
  }

  private exitTarget(vehicleDistanceM: number, stations: StationConfig[], stationIndex: number): THREE.Vector3 {
    const station = this.ctx.stationWorldAt(stationIndex);
    const tangent = this.ctx.stationTangentAt(stationIndex);
    const lateral = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    const distanceOffset = THREE.MathUtils.clamp(vehicleDistanceM - stations[stationIndex].distanceM, -5, 5);
    return station.addScaledVector(lateral, 5).addScaledVector(tangent, distanceOffset);
  }

  private enterVehicle(passenger: Passenger): void {
    const car = this.nearestCar(0, 0);
    car.attach(passenger.rig.root);
    passenger.phase = 'riding';
    passenger.car = car;

    const seatIndex = this.claimSeat(car);
    const anchors = readSeatAnchors(car);
    const interiorFloorY = readInteriorFloorY(car);
    if (seatIndex !== null) {
      const seat = anchors[seatIndex];
      passenger.seatIndex = seatIndex;
      // Drop the rig so its hips land on the cushion; hip height scales with build.
      passenger.rig.root.position.set(seat.x, seat.y - PEDESTRIAN_HIP_HEIGHT_M * passenger.rig.scale, seat.z);
      passenger.rig.root.rotation.set(0, seat.yaw, 0);
      // How high this cushion sits above this car's floor decides how far the
      // knees come up, so the feet land on the floor in every vehicle.
      const seatFloorY = seat.floorY ?? interiorFloorY;
      poseSeated(passenger.rig, seatFloorY === undefined ? undefined : seat.y - seatFloorY);
      return;
    }

    // Standees ride the aisle at floor level, holding the ceiling rail. A car
    // that never registered its interior keeps them on its own origin plane.
    const floorY = interiorFloorY ?? 0;
    const standing = this.standingRiderCount(car);
    passenger.seatIndex = null;
    passenger.rig.root.position.set(standing % 2 ? 0.2 : -0.2, floorY, ((standing % 4) - 1.5) * 1.15);
    passenger.rig.root.rotation.set(0, standing % 2 ? Math.PI / 2 : -Math.PI / 2, 0);
    poseStandingHold(passenger.rig);
  }

  /** Takes a free seat in `car`, preferring a spread over the whole saloon. */
  private claimSeat(car: THREE.Group): number | null {
    const anchors = readSeatAnchors(car);
    if (anchors.length === 0) return null;
    let taken = this.occupiedSeats.get(car.uuid);
    if (!taken) {
      taken = new Set<number>();
      this.occupiedSeats.set(car.uuid, taken);
    }
    if (taken.size >= anchors.length) return null;
    const start = Math.floor(Math.random() * anchors.length);
    for (let step = 0; step < anchors.length; step++) {
      const index = (start + step) % anchors.length;
      if (taken.has(index)) continue;
      taken.add(index);
      return index;
    }
    return null;
  }

  private releaseSeat(passenger: Passenger): void {
    if (passenger.seatIndex === null || !passenger.car) return;
    this.occupiedSeats.get(passenger.car.uuid)?.delete(passenger.seatIndex);
    passenger.seatIndex = null;
  }

  private standingRiderCount(car: THREE.Group): number {
    return this.passengers.filter(
      (candidate) => candidate.phase === 'riding' && candidate.car === car && candidate.seatIndex === null
    ).length;
  }

  private nearestCar(_vehicleDistanceM: number, _stationDistanceM: number): THREE.Group {
    // The visual controller owns car placement. Picking a middle car avoids
    // crowding either end and keeps passengers inside articulated formations.
    return this.ctx.vehicleCars[Math.floor(this.ctx.vehicleCars.length / 2)] ?? this.ctx.vehicleRoot;
  }

  private removePassenger(index: number): void {
    const [passenger] = this.passengers.splice(index, 1);
    this.releaseSeat(passenger);
    passenger.rig.root.removeFromParent();
  }
}

function nearestStationIndex(distanceM: number, stations: StationConfig[]): number {
  let result = -1;
  let best = STATION_TOLERANCE_M;
  for (let index = 0; index < stations.length; index++) {
    const gap = Math.abs(stations[index].distanceM - distanceM);
    if (gap <= best) {
      best = gap;
      result = index;
    }
  }
  return result;
}

function pickDownstreamDestination(originIndex: number, stationCount: number): number | undefined {
  const remaining = stationCount - originIndex - 1;
  if (remaining < 1) return undefined;
  return originIndex + 1 + Math.floor(Math.random() * Math.min(remaining, 4));
}

function findBoardableItinerary(itineraries: TransitItinerary[], line: string, origin: string, destination: string): boolean {
  return itineraries.some((itinerary) => itinerary.legs.some((leg) => {
    if (leg.type !== 'pt' || normalize(leg.routeShortName) !== normalize(line)) return false;
    const stops = leg.stops ?? [];
    const originIndex = stops.findIndex((stop) => sameStop(stop.name, origin));
    const destinationIndex = stops.findIndex((stop, index) => index > originIndex && sameStop(stop.name, destination));
    return originIndex >= 0 && destinationIndex > originIndex;
  }));
}

function sameStop(a: string, b: string): boolean {
  const left = normalize(a);
  const right = normalize(b);
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function normalize(value: string | undefined): string {
  return (value ?? '').toLocaleLowerCase('de-DE').replace(/\([^)]*\)|\bstg\.?\s*\d+|[^a-z0-9]/g, '');
}
