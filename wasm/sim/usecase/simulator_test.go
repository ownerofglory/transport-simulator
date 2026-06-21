package usecase

import (
	"stuttgart-stadtbahn-simulator/wasm/sim/domain"
	"testing"
)

func TestRideModeDepartsAfterFirstStationDwell(t *testing.T) {
	var simulator Simulator
	simulator.Init(domain.Config{Line: "U-test", Destination: "Terminal", RouteLengthM: 240, SpeedLimitMps: 10, Mode: "ride", Stations: []domain.Station{{Name: "Start"}, {Name: "First stop", DistanceM: 100}, {Name: "Terminal", DistanceM: 240}}})
	reached, departed := false, false
	for i := 0; i < 12000; i++ {
		state := simulator.Step(.05)
		if state.StationIndex == 1 && state.Dwelling {
			reached = true
		}
		if reached && !state.Dwelling && state.DistanceM > 102 && state.SpeedMps > .5 {
			departed = true
			break
		}
	}
	if !reached {
		t.Fatal("ride mode never completed its first station stop")
	}
	if !departed {
		t.Fatalf("ride mode did not depart after dwell: %+v", simulator.State())
	}
}

func TestSimulatorStartsAtSelectedStation(t *testing.T) {
	var simulator Simulator
	state := simulator.Init(domain.Config{Line: "U-test", Destination: "Terminal", RouteLengthM: 500, SpeedLimitMps: 12, Mode: "ride", StartStation: 1, Stations: []domain.Station{{Name: "Start"}, {Name: "Middle", DistanceM: 210}, {Name: "Terminal", DistanceM: 500}}})
	if state.DistanceM != 210 || state.StationIndex != 1 || state.NextStation != "Terminal" {
		t.Fatalf("wrong selected-station state: %+v", state)
	}
}
