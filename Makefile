.PHONY: all build clean dev macapp stop test help

STATE_DIR := $(shell python3 -c "import tempfile,os;print(os.path.join(os.path.expanduser('~/Library/Caches'),'mermaid-editor'))" 2>/dev/null || echo /tmp/mermaid-editor)

APP_NAME := Mermaid Editor
APP_BUNDLE := $(APP_NAME).app
APP_ID := com.local.mermaid-editor

help: #: Show this help message
	@echo "------------------------------------------------------------------------------"
	@printf "    \033[1;34m%s\033[0m\n" "$(APP_NAME)"
	@echo "------------------------------------------------------------------------------"
	@awk '/^[A-Za-z_ -]*:.*#:/ {printf("\033[1;32m%-20s\033[0m", $$1); f=0; for(i=1;i<=NF;i++){if($$i=="#:"){f=1;continue}if(f)printf("%s ",$$i)}; printf("\n"); }' Makefile* | sort

all: build #: Build everything

node_modules: package.json
	npm install

static/bundle.js: node_modules frontend/app.js frontend/editor.js
	npx esbuild frontend/app.js \
		--bundle \
		--format=iife \
		--minify \
		--sourcemap \
		--outfile=static/bundle.js

static/style.css: frontend/style.css
	cp frontend/style.css static/style.css

build: static/bundle.js static/style.css #: Build the frontend and Go binary
	go build -o mermaid-editor .

dev: node_modules #: Run in dev mode with watch
	cp frontend/style.css static/style.css
	npx esbuild frontend/app.js \
		--bundle \
		--format=iife \
		--sourcemap \
		--outfile=static/bundle.js \
		--watch &
	go run .

macapp: build #: Build a macOS .app bundle
	rm -rf "$(APP_BUNDLE)"
	mkdir -p "$(APP_BUNDLE)/Contents/MacOS"
	mkdir -p "$(APP_BUNDLE)/Contents/Resources"
	cp mermaid-editor "$(APP_BUNDLE)/Contents/MacOS/mermaid-editor"
	cp icon.icns "$(APP_BUNDLE)/Contents/Resources/icon.icns"
	printf 'APPL????' > "$(APP_BUNDLE)/Contents/PkgInfo"
	/usr/libexec/PlistBuddy -c "Add :CFBundleName string '$(APP_NAME)'" \
		-c "Add :CFBundleDisplayName string '$(APP_NAME)'" \
		-c "Add :CFBundleIdentifier string '$(APP_ID)'" \
		-c "Add :CFBundleVersion string '1.0.0'" \
		-c "Add :CFBundleShortVersionString string '1.0.0'" \
		-c "Add :CFBundleExecutable string 'mermaid-editor'" \
		-c "Add :CFBundleIconFile string 'icon'" \
		-c "Add :CFBundlePackageType string 'APPL'" \
		-c "Add :CFBundleInfoDictionaryVersion string '6.0'" \
		-c "Add :LSMinimumSystemVersion string '10.15'" \
		-c "Add :NSHighResolutionCapable bool true" \
		"$(APP_BUNDLE)/Contents/Info.plist"
	codesign --force --deep --sign - "$(APP_BUNDLE)"
	@echo "Built $(APP_BUNDLE)"

macinstall: macapp #: Install the macOS .app bundle
	cp -pr "$(APP_BUNDLE)" /Applications

test: #: Run tests
	go test -v -count=1 -timeout 30s ./...

stop: #: Stop the running instance
	@if [ -f "$(STATE_DIR)/pid" ]; then \
		kill $$(cat "$(STATE_DIR)/pid") 2>/dev/null && echo "Stopped." || echo "Not running."; \
	else \
		echo "Not running."; \
	fi

clean: #: Remove build artifacts
	rm -f static/bundle.js static/bundle.js.map static/style.css mermaid-editor
	rm -rf "$(APP_BUNDLE)"
