#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/tests
swiftc Sources/Rollout.swift tests/rollout/main.swift -o build/tests/rollout-tests
build/tests/rollout-tests
swiftc Sources/IconRasterizer.swift tests/icons/main.swift -o build/tests/icon-tests -framework Cocoa
build/tests/icon-tests
swiftc Sources/StatusPreferences.swift tests/preferences/main.swift -o build/tests/preferences-tests
build/tests/preferences-tests
swiftc Sources/WorkingMarkFrames.swift Sources/OrbitAnimation.swift Sources/OrbitRenderer.swift Sources/IconRasterizer.swift tests/orbit/main.swift -o build/tests/orbit-tests -framework Cocoa
build/tests/orbit-tests
# Compile the real controller without the executable's top-level launch code.
sed '/^let app = NSApplication.shared/,$d' Sources/main.swift > build/tests/StatusController.swift
swiftc Sources/IconRasterizer.swift Sources/OrbitAnimation.swift Sources/OrbitRenderer.swift Sources/Rollout.swift Sources/StatusPreferences.swift Sources/WorkingMarkFrames.swift build/tests/StatusController.swift tests/controller/main.swift -o build/tests/controller-tests -framework Cocoa
build/tests/controller-tests
