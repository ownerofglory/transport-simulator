package domain

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
