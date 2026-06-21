package usecase

import (
	"encoding/json"
	"math"

	"stuttgart-stadtbahn-simulator/wasm/sim/domain"
)

const (
	accelMps2       = 0.92
	brakeMps2       = 1.18
	comfortBrake    = 1.05
	stationStopZone = 1.15
	dwellSeconds    = 8.0
)

type Simulator struct {
	config           domain.Config
	state            domain.State
	paused           bool
	targetStationIdx int
	throttle         float64
	brake            float64
}

func DefaultConfig() domain.Config {
	return domain.Config{Line: "U-demo", Destination: "Charlottenplatz", RouteLengthM: 2200, SpeedLimitMps: 15.5, Mode: "ride", Stations: []domain.Station{
		{Name: "Killesberg", DistanceM: 0}, {Name: "Pragfriedhof", DistanceM: 620},
		{Name: "Hauptbahnhof", DistanceM: 1380}, {Name: "Charlottenplatz", DistanceM: 2200},
	}}
}

func (s *Simulator) Init(config domain.Config) domain.State {
	if config.RouteLengthM <= 0 {
		config.RouteLengthM = 1000
	}
	if config.SpeedLimitMps <= 0 {
		config.SpeedLimitMps = 15.5
	}
	if config.Mode == "" {
		config.Mode = "ride"
	}
	if len(config.Stations) == 0 {
		config.Stations = DefaultConfig().Stations
	}
	s.config, s.paused, s.throttle, s.brake = config, false, 0, 0
	start := config.StartStation
	if start < 0 || start >= len(config.Stations) {
		start = 0
	}
	s.targetStationIdx = min(start+1, len(config.Stations)-1)
	s.state = domain.State{Line: config.Line, Destination: config.Destination, DistanceM: config.Stations[start].DistanceM,
		NextStation: nextStationName(config, s.targetStationIdx), StationIndex: start, DoorsOpen: true, Dwelling: true,
		DwellRemainingS: 4, TripComplete: start >= len(config.Stations)-1, Mode: config.Mode, DriverScore: 1000}
	return s.state
}

func (s *Simulator) Step(dt float64) domain.State {
	if dt < 0 || math.IsNaN(dt) || math.IsInf(dt, 0) {
		dt = 0
	}
	if dt > .25 {
		dt = .25
	}
	if s.paused || s.state.TripComplete {
		return s.state
	}
	s.state.SimTimeS += dt
	if s.state.Dwelling {
		s.state.SpeedMps, s.throttle, s.brake, s.state.DoorsOpen = 0, 0, 0, true
		s.state.DwellRemainingS -= dt
		if s.state.DwellRemainingS <= 0 {
			s.state.Dwelling, s.state.DoorsOpen, s.state.DwellRemainingS = false, false, 0
		}
		return s.state
	}
	target := s.currentTargetStation()
	if s.config.Mode == "driver" {
		s.stepDriver(dt, target)
	} else {
		s.stepRide(dt, target)
	}
	s.state.DistanceM = math.Min(s.config.RouteLengthM, s.state.DistanceM+s.state.SpeedMps*dt)
	if math.Abs(target.DistanceM-s.state.DistanceM) <= stationStopZone && s.state.SpeedMps < 1.2 {
		s.arrive()
	}
	if s.config.Mode == "driver" && s.state.DistanceM > target.DistanceM+28 {
		s.penalty(75)
		s.state.SafetyEvents++
		s.arrive()
	}
	return s.state
}

func (s *Simulator) Reset() domain.State                { return s.Init(s.config) }
func (s *Simulator) SetPaused(paused bool) domain.State { s.paused = paused; return s.state }
func (s *Simulator) SetDriverInput(throttle, brake float64) domain.State {
	s.throttle = math.Max(0, math.Min(1, throttle))
	s.brake = math.Max(0, math.Min(1, brake))
	return s.state
}
func (s *Simulator) State() domain.State { return s.state }
func (s *Simulator) JSON() string {
	data, err := json.Marshal(s.state)
	if err != nil {
		return `{"error":"failed to encode simulator state"}`
	}
	return string(data)
}

func (s *Simulator) stepRide(dt float64, target domain.Station) {
	remaining := math.Max(0, target.DistanceM-s.state.DistanceM)
	targetSpeed := math.Min(s.config.SpeedLimitMps, math.Sqrt(2*comfortBrake*math.Max(remaining-stationStopZone*.5, 0)))
	if remaining > stationStopZone && targetSpeed < .9 {
		targetSpeed = .9
	}
	if s.state.SpeedMps > targetSpeed {
		s.state.SpeedMps -= brakeMps2 * dt
	} else {
		s.state.SpeedMps += accelMps2 * dt
	}
	s.state.SpeedMps = math.Max(0, math.Min(s.config.SpeedLimitMps, s.state.SpeedMps))
}

func (s *Simulator) stepDriver(dt float64, target domain.Station) {
	s.state.SpeedMps = math.Max(0, math.Min(s.config.SpeedLimitMps*1.18, s.state.SpeedMps+(s.throttle*1.05-s.brake*1.55-.05)*dt))
	s.state.Speeding = s.state.SpeedMps > s.config.SpeedLimitMps+.35
	if s.state.Speeding {
		s.penalty(1)
	}
	if target.DistanceM-s.state.DistanceM < 20 && s.state.SpeedMps > 4.2 {
		s.state.SafetyEvents++
		s.penalty(2)
	}
}

func (s *Simulator) currentTargetStation() domain.Station {
	if s.targetStationIdx >= 0 && s.targetStationIdx < len(s.config.Stations) {
		return s.config.Stations[s.targetStationIdx]
	}
	return domain.Station{Name: "End of line", DistanceM: s.config.RouteLengthM}
}

func (s *Simulator) arrive() {
	target := s.currentTargetStation()
	stopError := target.DistanceM - s.state.DistanceM
	s.state.DistanceM, s.state.SpeedMps, s.state.StationIndex = target.DistanceM, 0, s.targetStationIdx
	s.state.DoorsOpen, s.state.Dwelling, s.state.DwellRemainingS = true, true, dwellSeconds
	s.state.LastStopErrorM, s.state.TimetableDeltaS = stopError, s.state.SimTimeS-target.ScheduledS
	if s.config.Mode == "driver" {
		s.scoreStop(stopError)
	}
	if s.targetStationIdx >= len(s.config.Stations)-1 {
		s.state.TripComplete, s.state.NextStation = true, "End of line"
		return
	}
	s.targetStationIdx++
	s.state.NextStation = nextStationName(s.config, s.targetStationIdx)
}

func (s *Simulator) scoreStop(errorM float64) {
	abs := math.Abs(errorM)
	if abs <= .55 {
		s.state.DriverScore += 20
	} else if abs <= 1.4 {
		s.state.DriverScore += 8
	} else {
		s.penalty(int(math.Min(80, abs*8)))
	}
	if math.Abs(s.state.TimetableDeltaS) > 25 {
		s.penalty(12)
	}
}
func (s *Simulator) penalty(points int) { s.state.DriverScore = max(0, s.state.DriverScore-points) }
func nextStationName(c domain.Config, index int) string {
	if index >= 0 && index < len(c.Stations) {
		return c.Stations[index].Name
	}
	return "End of line"
}
