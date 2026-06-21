package main

import (
	"encoding/json"
	"syscall/js"

	"stuttgart-stadtbahn-simulator/wasm/sim/domain"
	"stuttgart-stadtbahn-simulator/wasm/sim/usecase"
)

var simulator usecase.Simulator

func initSim(_ js.Value, args []js.Value) any {
	config := usecase.DefaultConfig()
	if len(args) > 0 && args[0].Type() == js.TypeString {
		_ = json.Unmarshal([]byte(args[0].String()), &config)
	}
	simulator.Init(config)
	return simulator.JSON()
}
func stepSim(_ js.Value, args []js.Value) any {
	dt := 1.0 / 60
	if len(args) > 0 && args[0].Type() == js.TypeNumber {
		dt = args[0].Float()
	}
	simulator.Step(dt)
	return simulator.JSON()
}
func resetSim(_ js.Value, _ []js.Value) any { simulator.Reset(); return simulator.JSON() }
func setPaused(_ js.Value, args []js.Value) any {
	if len(args) > 0 && args[0].Type() == js.TypeBoolean {
		simulator.SetPaused(args[0].Bool())
	}
	return simulator.JSON()
}
func setDriverInput(_ js.Value, args []js.Value) any {
	var throttle, brake float64
	if len(args) > 0 && args[0].Type() == js.TypeNumber {
		throttle = args[0].Float()
	}
	if len(args) > 1 && args[1].Type() == js.TypeNumber {
		brake = args[1].Float()
	}
	simulator.SetDriverInput(throttle, brake)
	return simulator.JSON()
}

func main() {
	simulator.Init(domain.Config{})
	bridge := js.Global().Get("Object").New()
	bridge.Set("initSim", js.FuncOf(initSim))
	bridge.Set("stepSim", js.FuncOf(stepSim))
	bridge.Set("resetSim", js.FuncOf(resetSim))
	bridge.Set("setPaused", js.FuncOf(setPaused))
	bridge.Set("setDriverInput", js.FuncOf(setDriverInput))
	js.Global().Set("ssim", bridge)
	select {}
}
