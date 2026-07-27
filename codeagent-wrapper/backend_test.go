package main

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestClaudeBuildArgs_ModesAndPermissions(t *testing.T) {
	backend := ClaudeBackend{}

	t.Run("new mode always bypasses permissions (autonomous orchestration)", func(t *testing.T) {
		cfg := &Config{Mode: "new", WorkDir: "/repo"}
		got := backend.BuildArgs(cfg, "todo")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--output-format", "stream-json", "--verbose", "todo"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("new mode can opt-in skip-permissions", func(t *testing.T) {
		cfg := &Config{Mode: "new", SkipPermissions: true}
		got := backend.BuildArgs(cfg, "-")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--output-format", "stream-json", "--verbose", "-"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("resume mode includes session id", func(t *testing.T) {
		cfg := &Config{Mode: "resume", SessionID: "sid-123", WorkDir: "/ignored"}
		got := backend.BuildArgs(cfg, "resume-task")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "-r", "sid-123", "--output-format", "stream-json", "--verbose", "resume-task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("resume mode without session still returns base flags", func(t *testing.T) {
		cfg := &Config{Mode: "resume", WorkDir: "/ignored"}
		got := backend.BuildArgs(cfg, "follow-up")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--output-format", "stream-json", "--verbose", "follow-up"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("resume mode can opt-in skip permissions", func(t *testing.T) {
		cfg := &Config{Mode: "resume", SessionID: "sid-123", SkipPermissions: true}
		got := backend.BuildArgs(cfg, "resume-task")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "-r", "sid-123", "--output-format", "stream-json", "--verbose", "resume-task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("nil config returns nil", func(t *testing.T) {
		if backend.BuildArgs(nil, "ignored") != nil {
			t.Fatalf("nil config should return nil args")
		}
	})
}

func TestClaudeBuildArgs_GeminiAndCodexModes(t *testing.T) {
	t.Run("gemini new mode passes workdir via include-directories", func(t *testing.T) {
		backend := GeminiBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/workspace"}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"-o", "stream-json", "-y", "--include-directories", "/workspace", "-p", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("gemini new mode without workdir omits include-directories", func(t *testing.T) {
		backend := GeminiBackend{}
		cfg := &Config{Mode: "new"}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"-o", "stream-json", "-y", "-p", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("gemini resume mode uses session id without include-directories", func(t *testing.T) {
		backend := GeminiBackend{}
		cfg := &Config{Mode: "resume", SessionID: "sid-999", WorkDir: "/workspace"}
		got := backend.BuildArgs(cfg, "resume")
		want := []string{"-o", "stream-json", "-y", "-r", "sid-999", "-p", "resume"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("gemini resume mode without session omits identifier", func(t *testing.T) {
		backend := GeminiBackend{}
		cfg := &Config{Mode: "resume"}
		got := backend.BuildArgs(cfg, "resume")
		want := []string{"-o", "stream-json", "-y", "-p", "resume"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("gemini nil config returns nil", func(t *testing.T) {
		backend := GeminiBackend{}
		if backend.BuildArgs(nil, "ignored") != nil {
			t.Fatalf("nil config should return nil args")
		}
	})

	t.Run("codex build args includes bypass by default (CODEX_REQUIRE_APPROVAL unset)", func(t *testing.T) {
		t.Setenv("CODEX_REQUIRE_APPROVAL", "")

		backend := CodexBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/tmp"}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"e", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-C", "/tmp", "--json", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("codex build args omits bypass when CODEX_REQUIRE_APPROVAL=true", func(t *testing.T) {
		t.Setenv("CODEX_REQUIRE_APPROVAL", "true")

		backend := CodexBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/tmp"}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"e", "--skip-git-repo-check", "-C", "/tmp", "--json", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("progress flag does not affect backend args", func(t *testing.T) {
		backend := CodexBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/tmp", Progress: true}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"e", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-C", "/tmp", "--json", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})
}

func TestGeminiBuildArgs_NeverReceivesDashAsPrompt(t *testing.T) {
	// Gemini CLI does not support "-" as stdin marker for -p flag.
	// Verify that BuildArgs never produces "-p -" — the actual task text
	// must be passed directly via -p.
	backend := GeminiBackend{}
	cfg := &Config{Mode: "new", WorkDir: "/workspace"}

	// When called with actual task text (geminiDirect path in executor)
	got := backend.BuildArgs(cfg, "Analyze the authentication module")
	want := []string{"-o", "stream-json", "-y", "--include-directories", "/workspace", "-p", "Analyze the authentication module"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}

	// Ensure "-" as targetArg would produce the broken "-p -" (this is what we prevent in executor)
	gotBroken := backend.BuildArgs(cfg, "-")
	for i, arg := range gotBroken {
		if arg == "-p" && i+1 < len(gotBroken) && gotBroken[i+1] == "-" {
			// This confirms the bug path — executor must never call BuildArgs with "-" for Gemini
			return
		}
	}
	t.Fatal("expected BuildArgs with '-' to produce '-p -' (the known broken path)")
}

func TestGeminiBuildArgs_OmitsPFlagWhenTargetEmpty(t *testing.T) {
	// On Windows, executor passes targetArg="" to signal stdin pipe mode.
	// buildGeminiArgs should omit -p entirely when targetArg is empty.
	backend := GeminiBackend{}
	cfg := &Config{Mode: "new", WorkDir: "/workspace"}

	got := backend.BuildArgs(cfg, "")
	// Should NOT contain -p at all
	for i, arg := range got {
		if arg == "-p" {
			t.Fatalf("expected no -p flag when targetArg is empty, but found -p at index %d: %v", i, got)
		}
	}
	// Should still contain other flags
	want := []string{"-o", "stream-json", "-y", "--include-directories", "/workspace"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestGeminiBuildArgs_WithModel_OmitsPFlagWhenTargetEmpty(t *testing.T) {
	backend := GeminiBackend{}
	cfg := &Config{Mode: "new", WorkDir: "/workspace", GeminiModel: "gemini-3.1-pro-preview"}

	got := backend.BuildArgs(cfg, "")
	for i, arg := range got {
		if arg == "-p" {
			t.Fatalf("expected no -p flag when targetArg is empty, but found -p at index %d: %v", i, got)
		}
	}
	want := []string{"-m", "gemini-3.1-pro-preview", "-o", "stream-json", "-y", "--include-directories", "/workspace"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestClaudeBuildArgs_BackendMetadata(t *testing.T) {
	tests := []struct {
		backend Backend
		name    string
		command string
	}{
		{backend: CodexBackend{}, name: "codex", command: "codex"},
		{backend: ClaudeBackend{}, name: "claude", command: "claude"},
		{backend: GeminiBackend{}, name: "gemini", command: "gemini"},
	}

	for _, tt := range tests {
		if got := tt.backend.Name(); got != tt.name {
			t.Fatalf("Name() = %s, want %s", got, tt.name)
		}
		if got := tt.backend.Command(); got != tt.command {
			t.Fatalf("Command() = %s, want %s", got, tt.command)
		}
	}
}

func TestLoadMinimalEnvSettings(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	t.Run("missing file returns empty", func(t *testing.T) {
		if got := loadMinimalEnvSettings(); len(got) != 0 {
			t.Fatalf("got %v, want empty", got)
		}
	})

	t.Run("valid env returns string map", func(t *testing.T) {
		dir := filepath.Join(home, ".claude")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("MkdirAll: %v", err)
		}
		path := filepath.Join(dir, "settings.json")
		data := []byte(`{"env":{"ANTHROPIC_API_KEY":"secret","FOO":"bar"}}`)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}

		got := loadMinimalEnvSettings()
		if got["ANTHROPIC_API_KEY"] != "secret" || got["FOO"] != "bar" {
			t.Fatalf("got %v, want keys present", got)
		}
	})

	t.Run("non-string values are ignored", func(t *testing.T) {
		dir := filepath.Join(home, ".claude")
		path := filepath.Join(dir, "settings.json")
		data := []byte(`{"env":{"GOOD":"ok","BAD":123,"ALSO_BAD":true}}`)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}

		got := loadMinimalEnvSettings()
		if got["GOOD"] != "ok" {
			t.Fatalf("got %v, want GOOD=ok", got)
		}
		if _, ok := got["BAD"]; ok {
			t.Fatalf("got %v, want BAD omitted", got)
		}
		if _, ok := got["ALSO_BAD"]; ok {
			t.Fatalf("got %v, want ALSO_BAD omitted", got)
		}
	})

	t.Run("oversized file returns empty", func(t *testing.T) {
		dir := filepath.Join(home, ".claude")
		path := filepath.Join(dir, "settings.json")
		data := bytes.Repeat([]byte("a"), maxClaudeSettingsBytes+1)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		if got := loadMinimalEnvSettings(); len(got) != 0 {
			t.Fatalf("got %v, want empty", got)
		}
	})
}

func TestGrokBuildArgs_NewMode(t *testing.T) {
	cfg := &Config{Mode: "new", WorkDir: "/tmp/project", Backend: "grok"}
	args := buildGrokArgs(cfg, "do the task")

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--always-approve") {
		t.Fatalf("args missing --always-approve: %v", args)
	}
	if !strings.Contains(joined, "--output-format streaming-json") {
		t.Fatalf("args missing streaming-json output format: %v", args)
	}
	if strings.Contains(joined, "--cwd") {
		t.Fatalf("args must not contain --cwd (workdir comes from cmd.Dir): %v", args)
	}
	// -p must be followed by the task text
	for i, a := range args {
		if a == "-p" {
			if i+1 >= len(args) || args[i+1] != "do the task" {
				t.Fatalf("-p not followed by task text: %v", args)
			}
			return
		}
	}
	t.Fatalf("args missing -p: %v", args)
}

func TestGrokBuildArgs_ResumeMode(t *testing.T) {
	cfg := &Config{Mode: "resume", SessionID: "sess-123", WorkDir: "/tmp/project", Backend: "grok"}
	args := buildGrokArgs(cfg, "continue")

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-r sess-123") {
		t.Fatalf("resume args missing -r <session>: %v", args)
	}
	if !strings.Contains(joined, "-p continue") {
		t.Fatalf("resume args missing -p prompt: %v", args)
	}
}

func TestGrokBuildArgs_WithModel(t *testing.T) {
	cfg := &Config{Mode: "new", WorkDir: ".", Backend: "grok", GrokModel: "grok-4.5"}
	args := buildGrokArgs(cfg, "task")

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-m grok-4.5") {
		t.Fatalf("args missing -m grok-4.5: %v", args)
	}
}

func TestGrokBuildArgs_NilConfig(t *testing.T) {
	if args := buildGrokArgs(nil, "x"); args != nil {
		t.Fatalf("nil config should return nil args, got %v", args)
	}
}

func TestGrokBackend_Metadata(t *testing.T) {
	b := GrokBackend{}
	if b.Name() != "grok" {
		t.Fatalf("name = %s, want grok", b.Name())
	}
	if b.Command() == "" {
		t.Fatalf("command must not be empty")
	}
}

func TestParseJSONStream_GrokEvents(t *testing.T) {
	stream := `{"type":"thought","data":"thinking"}
{"type":"thought","data":" more"}
{"type":"text","data":"Hello"}
{"type":"text","data":" world"}
{"type":"end","stopReason":"EndTurn","sessionId":"019f-abc","requestId":"req-1"}
`
	var sessionFromCallback string
	message, threadID := parseJSONStreamInternalWithContent(
		strings.NewReader(stream), nil, nil, nil, nil, nil, nil,
		func(id string) { sessionFromCallback = id },
	)

	if message != "Hello world" {
		t.Fatalf("message = %q, want %q", message, "Hello world")
	}
	if threadID != "019f-abc" {
		t.Fatalf("threadID = %q, want %q", threadID, "019f-abc")
	}
	if sessionFromCallback != "019f-abc" {
		t.Fatalf("onSessionStarted got %q, want %q", sessionFromCallback, "019f-abc")
	}
}

func TestParseJSONStream_GrokThoughtsExcludedFromMessage(t *testing.T) {
	stream := `{"type":"thought","data":"secret reasoning"}
{"type":"text","data":"answer"}
{"type":"end","stopReason":"EndTurn","sessionId":"s1","requestId":"r1"}
`
	message, _ := parseJSONStreamInternal(strings.NewReader(stream), nil, nil, nil, nil)
	if message != "answer" {
		t.Fatalf("message = %q, want %q (thoughts must not leak)", message, "answer")
	}
}
