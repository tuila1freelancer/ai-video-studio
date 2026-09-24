// The Windows key-holder launcher — the exact counterpart of shell/main.swift on macOS.
//
// It is the one compiled artifact that carries the per-build AES key. Electron (shell/electron/
// main.cjs) spawns this; this spawns the vendored node.exe running loader.cjs, and hands the key
// down that child's stdin — never to a readable file, never to argv or the environment where a
// process list would print it back. Recovering the key means disassembling this binary, which is
// the same honest ceiling the Swift launcher has.
//
// Cross-compiled from macOS:
//   GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -X main.appKey=<64 hex>" .
package main

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

// Injected at build time with -ldflags "-X main.appKey=<64 hex>". Empty only in an unkeyed dev
// build, which loader.cjs will reject — a keyless launcher is a build error, not a runtime path.
var appKey string

// Where the runtime is, relative to this binary — or absolute, for an image whose node is installed
// system-wide. Windows keeps the default; the Linux build passes node-linux/bin/node, and the
// container passes /usr/local/bin/node. Injected the same way the key is, so one source builds all
// three and nothing has to guess a layout.
var nodeRel = "node-win/node.exe"

// Where the payload is, relative to this binary. cwd is set to it: integrity.js finds app.jsc.json
// by process.argv[1]'s directory, which is "." — so this is load-bearing, not cosmetic.
var payloadRel = "app-payload"

func main() {
	// Resolve everything from the executable's own location, never the working directory: a
	// per-machine install directory under Program Files is unpredictable, and so is cwd with it.
	exe, err := os.Executable()
	if err != nil {
		os.Exit(1)
	}
	base := filepath.Dir(exe)
	nodeExe := nodeRel
	if !filepath.IsAbs(nodeExe) {
		nodeExe = filepath.Join(base, nodeRel)
	}
	payload := filepath.Join(base, payloadRel)

	// The V8 flags are the same doctrine as scripts/bytecode-flags.mjs, and both are mandatory: a
	// missing --no-lazy makes V8 hand back no wrapper, a missing --no-flush-bytecode throws a
	// SyntaxError minutes into a render when V8 discards the bytecode and recompiles from spaces.
	cmd := exec.Command(nodeExe, "--no-lazy", "--no-flush-bytecode", "loader.cjs")
	cmd.Dir = payload
	// AVS_DIST lives in this compiled binary, not a readable file — same as the Swift launcher's
	// EXTRA_ENV. It keeps isDist() true so the developer license bypass stays dead.
	cmd.Env = append(os.Environ(), "AVS_DIST=1")
	// Inherit the parent's stdout/stderr directly: the server's "AVS_READY <url>" reaches Electron
	// unbuffered, and there is no pipe for us to drain (and deadlock on).
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	stdin, err := cmd.StdinPipe()
	if err != nil {
		os.Exit(1)
	}
	if err := cmd.Start(); err != nil {
		os.Exit(1)
	}
	// Tie node.exe's lifetime to ours: on Windows, killing this launcher does NOT cascade to the
	// child, so without this node.exe would orphan and hold the server port. No-op off Windows.
	killChildWithParent(cmd)

	// loader.cjs reads stdin to EOF; write the key and close, or boot hangs waiting for it.
	_, _ = io.WriteString(stdin, appKey+"\n")
	_ = stdin.Close()

	if err := cmd.Wait(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		os.Exit(1)
	}
}
