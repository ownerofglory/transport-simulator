package main

import (
	"encoding/json"
	"math"
	"syscall/js"
)

type Station struct {
	Name       string  `json:"name"`
	DistanceM  float64 `json:"distanceM"`
	ScheduledS float64 `json:"scheduledS,omitempty"`
}

type Config struct {
	Line          string    `json:"line"`
	Destination   string    `json:"destination"`
	RouteLengthM  float64   `json:"routeLengthM"`
	SpeedLimitMps float64   `json:"speedLimitMps"`
	Mode          string    `json:"mode,omitempty"`
	StartStation  int       `json:"startStationIndex,omitempty"`
	Stations      []Station `json:"stations"`
}

type State struct {
	Line            string  `json:"line"`
	Destination     string  `json:"destination"`
	DistanceM       float64 `json:"distanceM"`
	SpeedMps        float64 `json:"speedMps"`
	NextStation     string  `json:"nextStation"`
	StationIndex    int     `json:"stationIndex"`
	DoorsOpen       bool    `json:"doorsOpen"`
	Dwelling        bool    `json:"dwelling"`
	DwellRemainingS float64 `json:"dwellRemainingS"`
	TripComplete    bool    `json:"tripComplete"`
	SimTimeS        float64 `json:"simTimeS"`
	Mode            string  `json:"mode"`
	DriverScore     int     `json:"driverScore"`
	LastStopErrorM  float64 `json:"lastStopErrorM"`
	TimetableDeltaS float64 `json:"timetableDeltaS"`
	SafetyEvents    int     `json:"safetyEvents"`
	Speeding        bool    `json:"speeding"`
}

type Simulator struct {
	config           Config
	state            State
	paused           bool
	targetStationIdx int
	throttle         float64
	brake            float64
}

var sim Simulator

const (
	accelMps2       = 0.92
	brakeMps2       = 1.18
	comfortBrake    = 1.05
	stationStopZone = 1.15
	dwellSeconds    = 8.0
)

func defaultConfig() Config {
	return Config{
		Line:          "U-demo",
		Destination:   "Charlottenplatz",
		RouteLengthM:  2200,
		SpeedLimitMps: 15.5,
		Mode:          "ride",
		Stations: []Station{
			{Name: "Killesberg", DistanceM: 0},
			{Name: "Pragfriedhof", DistanceM: 620},
			{Name: "Hauptbahnhof", DistanceM: 1380},
			{Name: "Charlottenplatz", DistanceM: 2200},
		},
	}
}

func (s *Simulator) Init(config Config) {
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
		config.Stations = defaultConfig().Stations
	}

	s.config = config
	s.paused = false
	s.throttle = 0
	s.brake = 0
	startStation := config.StartStation
	if startStation < 0 || startStation >= len(config.Stations) {
		startStation = 0
	}
	s.targetStationIdx = min(startStation+1, len(config.Stations)-1)
	tripComplete := startStation >= len(config.Stations)-1

	s.state = State{
		Line:            config.Line,
		Destination:     config.Destination,
		DistanceM:       config.Stations[startStation].DistanceM,
		SpeedMps:        0,
		NextStation:     nextStationName(config, s.targetStationIdx),
		StationIndex:    startStation,
		DoorsOpen:       true,
		Dwelling:        true,
		DwellRemainingS: 4,
		TripComplete:    tripComplete,
		SimTimeS:        0,
		Mode:            config.Mode,
		DriverScore:     1000,
		LastStopErrorM:  0,
		TimetableDeltaS: 0,
		SafetyEvents:    0,
		Speeding:        false,
	}
}

func nextStationName(c Config, idx int) string {
	if idx >= 0 && idx < len(c.Stations) {
		return c.Stations[idx].Name
	}
	return "End of line"
}

func (s *Simulator) Step(dt float64) State {
	if dt < 0 || math.IsNaN(dt) || math.IsInf(dt, 0) {
		dt = 0
	}
	if dt > 0.25 {
		dt = 0.25
	}

	if s.paused || s.state.TripComplete {
		return s.state
	}

	s.state.SimTimeS += dt

	if s.state.Dwelling {
		s.state.SpeedMps = 0
		s.throttle = 0
		s.brake = 0
		s.state.DoorsOpen = true
		s.state.DwellRemainingS -= dt
		if s.state.DwellRemainingS <= 0 {
			s.state.Dwelling = false
			s.state.DoorsOpen = false
			s.state.DwellRemainingS = 0
		}
		return s.state
	}

	target := s.currentTargetStation()
	if s.config.Mode == "driver" {
		s.stepDriverPhysics(dt, target)
	} else {
		s.stepRidePhysics(dt, target)
	}

	s.state.DistanceM += s.state.SpeedMps * dt
	if s.state.DistanceM > s.config.RouteLengthM {
		s.state.DistanceM = s.config.RouteLengthM
	}

	if math.Abs(target.DistanceM-s.state.DistanceM) <= stationStopZone && s.state.SpeedMps < 1.2 {
		s.arriveAtStation()
	}
	if s.config.Mode == "driver" && s.state.DistanceM > target.DistanceM+28 {
		s.addDriverPenalty(75)
		s.state.SafetyEvents++
		s.arriveAtStation()
	}

	return s.state
}

func (s *Simulator) stepRidePhysics(dt float64, target Station) {
	remaining := target.DistanceM - s.state.DistanceM
	if remaining < 0 {
		remaining = 0
	}

	// Follow a braking curve all the way to the platform. A small minimum
	// approach speed prevents the automatic train from stopping short and
	// becoming trapped inside the braking zone.
	targetSpeed := math.Sqrt(2 * comfortBrake * math.Max(remaining-stationStopZone*0.5, 0))
	if targetSpeed > s.config.SpeedLimitMps {
		targetSpeed = s.config.SpeedLimitMps
	}
	if remaining > stationStopZone && targetSpeed < 0.9 {
		targetSpeed = 0.9
	}

	if s.state.SpeedMps > targetSpeed {
		s.state.SpeedMps -= brakeMps2 * dt
	} else {
		s.state.SpeedMps += accelMps2 * dt
	}

	s.clampSpeed()
}

func (s *Simulator) stepDriverPhysics(dt float64, target Station) {
	accel := (s.throttle * 1.05) - (s.brake * 1.55) - 0.05
	s.state.SpeedMps += accel * dt
	if s.state.SpeedMps < 0 {
		s.state.SpeedMps = 0
	}
	if s.state.SpeedMps > s.config.SpeedLimitMps*1.18 {
		s.state.SpeedMps = s.config.SpeedLimitMps * 1.18
	}

	s.state.Speeding = s.state.SpeedMps > s.config.SpeedLimitMps+0.35
	if s.state.Speeding {
		s.addDriverPenalty(1)
	}

	remaining := target.DistanceM - s.state.DistanceM
	if remaining < 20 && s.state.SpeedMps > 4.2 {
		s.state.SafetyEvents++
		s.addDriverPenalty(2)
	}
}

func (s *Simulator) clampSpeed() {
	if s.state.SpeedMps < 0 {
		s.state.SpeedMps = 0
	}
	if s.state.SpeedMps > s.config.SpeedLimitMps {
		s.state.SpeedMps = s.config.SpeedLimitMps
	}
}

func (s *Simulator) currentTargetStation() Station {
	if s.targetStationIdx >= 0 && s.targetStationIdx < len(s.config.Stations) {
		return s.config.Stations[s.targetStationIdx]
	}
	return Station{Name: "End of line", DistanceM: s.config.RouteLengthM}
}

func (s *Simulator) arriveAtStation() {
	target := s.currentTargetStation()
	stopError := target.DistanceM - s.state.DistanceM
	s.state.DistanceM = target.DistanceM
	s.state.SpeedMps = 0
	s.state.StationIndex = s.targetStationIdx
	s.state.DoorsOpen = true
	s.state.Dwelling = true
	s.state.DwellRemainingS = dwellSeconds
	s.state.LastStopErrorM = stopError
	s.state.TimetableDeltaS = s.state.SimTimeS - target.ScheduledS

	if s.config.Mode == "driver" {
		s.scoreDriverStop(stopError)
	}

	if s.targetStationIdx >= len(s.config.Stations)-1 {
		s.state.TripComplete = true
		s.state.NextStation = "End of line"
		return
	}

	s.targetStationIdx++
	s.state.NextStation = nextStationName(s.config, s.targetStationIdx)
}

func (s *Simulator) scoreDriverStop(stopError float64) {
	absError := math.Abs(stopError)
	switch {
	case absError <= 0.55:
		s.state.DriverScore += 20
	case absError <= 1.4:
		s.state.DriverScore += 8
	default:
		s.addDriverPenalty(int(math.Min(80, absError*8)))
	}

	if math.Abs(s.state.TimetableDeltaS) > 25 {
		s.addDriverPenalty(12)
	}
}

func (s *Simulator) addDriverPenalty(points int) {
	s.state.DriverScore -= points
	if s.state.DriverScore < 0 {
		s.state.DriverScore = 0
	}
}

func (s *Simulator) JSON() string {
	data, err := json.Marshal(s.state)
	if err != nil {
		return `{"error":"failed to encode simulator state"}`
	}
	return string(data)
}

func initSim(this js.Value, args []js.Value) any {
	config := defaultConfig()
	if len(args) > 0 && args[0].Type() == js.TypeString {
		_ = json.Unmarshal([]byte(args[0].String()), &config)
	}
	sim.Init(config)
	return sim.JSON()
}

func stepSim(this js.Value, args []js.Value) any {
	dt := 1.0 / 60.0
	if len(args) > 0 && args[0].Type() == js.TypeNumber {
		dt = args[0].Float()
	}
	sim.Step(dt)
	return sim.JSON()
}

func resetSim(this js.Value, args []js.Value) any {
	sim.Init(sim.config)
	return sim.JSON()
}

func setPaused(this js.Value, args []js.Value) any {
	if len(args) > 0 && args[0].Type() == js.TypeBoolean {
		sim.paused = args[0].Bool()
	}
	return sim.JSON()
}

func setDriverInput(this js.Value, args []js.Value) any {
	if len(args) > 0 && args[0].Type() == js.TypeNumber {
		sim.throttle = math.Max(0, math.Min(1, args[0].Float()))
	}
	if len(args) > 1 && args[1].Type() == js.TypeNumber {
		sim.brake = math.Max(0, math.Min(1, args[1].Float()))
	}
	return sim.JSON()
}

func registerBridge() {
	bridge := js.Global().Get("Object").New()
	bridge.Set("initSim", js.FuncOf(initSim))
	bridge.Set("stepSim", js.FuncOf(stepSim))
	bridge.Set("resetSim", js.FuncOf(resetSim))
	bridge.Set("setPaused", js.FuncOf(setPaused))
	bridge.Set("setDriverInput", js.FuncOf(setDriverInput))
	js.Global().Set("ssim", bridge)
}

func main() {
	sim.Init(defaultConfig())
	registerBridge()
	select {}
}
