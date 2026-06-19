package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	const addr = "127.0.0.1:5174"
	fs := http.FileServer(http.Dir("dist"))
	http.Handle("/", fs)
	fmt.Printf("Serving built simulator at http://%s\n", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
