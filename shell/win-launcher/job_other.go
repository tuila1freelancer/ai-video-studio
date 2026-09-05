//go:build !windows

package main

import "os/exec"

// Off Windows the Job Object dance is neither needed nor available; only the shipped Windows binary
// uses it (see job_windows.go). This stub lets the launcher build and vet on the macOS build host.
func killChildWithParent(_ *exec.Cmd) {}
