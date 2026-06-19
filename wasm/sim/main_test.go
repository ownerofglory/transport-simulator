package main

import "testing"

func TestRideModeDepartsAfterFirstStationDwell(t *testing.T) {
	simulator := Simulator{}
	simulator.Init(Config{
		Line:          "U-test",
		Destination:   "Terminal",
		RouteLengthM:  240,
		SpeedLimitMps: 10,
		Mode:          "ride",
		Stations: []Station{
			{Name: "Start", DistanceM: 0},
			{Name: "First stop", DistanceM: 100},
			{Name: "Terminal", DistanceM: 240},
		},
	})

	reachedFirstStop := false
	departedFirstStop := false
	for i := 0; i < 12_000; i++ {
		state := simulator.Step(0.05)
		if state.StationIndex == 1 && state.Dwelling {
			reachedFirstStop = true
		}
		if reachedFirstStop && !state.Dwelling && state.DistanceM > 102 && state.SpeedMps > 0.5 {
			departedFirstStop = true
			break
		}
	}

	if !reachedFirstStop {
		t.Fatal("ride mode never completed its first station stop")
	}
	if !departedFirstStop {
		t.Fatalf("ride mode did not depart after dwell: distance=%.2f speed=%.2f dwelling=%v",
			simulator.state.DistanceM, simulator.state.SpeedMps, simulator.state.Dwelling)
	}
}

func TestSimulatorStartsAtSelectedStation(t *testing.T) {
	simulator := Simulator{}
	simulator.Init(Config{
		Line:          "U-test",
		Destination:   "Terminal",
		RouteLengthM:  500,
		SpeedLimitMps: 12,
		Mode:          "ride",
		StartStation:  1,
		Stations: []Station{
			{Name: "Start", DistanceM: 0},
			{Name: "Middle", DistanceM: 210},
			{Name: "Terminal", DistanceM: 500},
		},
	})

	if simulator.state.DistanceM != 210 {
		t.Fatalf("expected selected station distance 210, got %.2f", simulator.state.DistanceM)
	}
	if simulator.state.StationIndex != 1 || simulator.state.NextStation != "Terminal" {
		t.Fatalf("wrong station state: index=%d next=%q", simulator.state.StationIndex, simulator.state.NextStation)
	}
}
