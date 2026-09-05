//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

// Assign node.exe to a Job Object whose limit is KILL_ON_JOB_CLOSE: when the last handle to the job
// closes — which happens when this launcher process exits — Windows terminates every process in it.
// Windows does not cascade a parent kill to its children, so without this node.exe survives the
// window closing and holds the server port against the next launch.
func killChildWithParent(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	createJobObject := kernel32.NewProc("CreateJobObjectW")
	setInformationJobObject := kernel32.NewProc("SetInformationJobObject")
	assignProcessToJobObject := kernel32.NewProc("AssignProcessToJobObject")

	job, _, _ := createJobObject.Call(0, 0)
	if job == 0 {
		return
	}

	type basicLimit struct {
		PerProcessUserTimeLimit int64
		PerJobUserTimeLimit     int64
		LimitFlags              uint32
		MinimumWorkingSetSize   uintptr
		MaximumWorkingSetSize   uintptr
		ActiveProcessLimit      uint32
		Affinity                uintptr
		PriorityClass           uint32
		SchedulingClass         uint32
	}
	type ioCounters struct {
		ReadOperationCount  uint64
		WriteOperationCount uint64
		OtherOperationCount uint64
		ReadTransferCount   uint64
		WriteTransferCount  uint64
		OtherTransferCount  uint64
	}
	type extendedLimit struct {
		BasicLimitInformation basicLimit
		IoInfo                ioCounters
		ProcessMemoryLimit    uintptr
		JobMemoryLimit        uintptr
		PeakProcessMemoryUsed uintptr
		PeakJobMemoryUsed     uintptr
	}
	const extendedLimitInformationClass = 9
	const limitKillOnJobClose = 0x00002000
	// Process access rights not exported by stdlib syscall. AssignProcessToJobObject needs both.
	const processTerminate = 0x0001
	const processSetQuota = 0x0100

	var info extendedLimit
	info.BasicLimitInformation.LimitFlags = limitKillOnJobClose
	setInformationJobObject.Call(job, extendedLimitInformationClass,
		uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info))

	handle, err := syscall.OpenProcess(processSetQuota|processTerminate, false, uint32(cmd.Process.Pid))
	if err != nil {
		return
	}
	defer syscall.CloseHandle(handle)
	assignProcessToJobObject.Call(job, uintptr(handle))
	// The job handle is deliberately NOT closed: closing it now would fire the kill immediately.
	// It is released when this process exits, which is exactly when the child should die.
}
