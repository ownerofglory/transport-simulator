.PHONY: wasm dev build preview clean

wasm:
	npm run wasm:build

dev: wasm
	npm run dev

build:
	npm run build

preview:
	npm run preview

clean:
	rm -rf dist public/sim.wasm public/wasm_exec.js node_modules
