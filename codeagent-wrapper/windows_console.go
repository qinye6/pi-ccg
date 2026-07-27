//go:build windows
// +build windows

package main

import (
	"os/exec"
	"syscall"
)

// hideWindowsConsole hides the console window for Windows commands
// This prevents CMD windows from flashing when running taskkill or rundll32
func hideWindowsConsole(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	// CREATE_NO_WINDOW = 0x08000000
	// This flag prevents creating a new console window
	cmd.SysProcAttr.CreationFlags = 0x08000000
}
