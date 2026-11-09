/*
 * keyhelper: sends ONE copy keystroke (Ctrl+C) to Path of Exile 2 when asked.
 *
 * It stays running and reads commands from stdin, one per line, so each hotkey press costs
 * no process start:
 *   copy      -> sends Ctrl+C if the game is the active window; replies "ok" or "notgame"
 *   copyadv   -> same with Ctrl+Alt+C (advanced item description)
 *   fg        -> replies with the active window's class and title (for troubleshooting)
 *
 * Fair play: this is the only input the app ever gives the game, one copy per hotkey press,
 * exactly what the player could press themselves.
 *
 * Build (MinGW): x86_64-w64-mingw32-gcc -O2 -municode -o keyhelper.exe keyhelper.c
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>

static int isGameWindow(HWND w) {
	if (!w) return 0;
	wchar_t cls[256] = { 0 }, title[256] = { 0 };
	GetClassNameW(w, cls, 255);
	GetWindowTextW(w, title, 255);
	if (wcscmp(cls, L"POEWindowClass") == 0) return 1;
	if (wcsncmp(title, L"Path of Exile", 13) == 0) return 1;
	return 0;
}

static void key(INPUT *in, WORD vk, int up) {
	memset(in, 0, sizeof(*in));
	in->type = INPUT_KEYBOARD;
	in->ki.wVk = vk;
	in->ki.wScan = (WORD)MapVirtualKeyW(vk, MAPVK_VK_TO_VSC);
	in->ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
}

static void sendCopy(int advanced) {
	INPUT in[6];
	int n = 0;
	key(&in[n++], VK_CONTROL, 0);
	if (advanced) key(&in[n++], VK_MENU, 0);
	key(&in[n++], 'C', 0);
	key(&in[n++], 'C', 1);
	if (advanced) key(&in[n++], VK_MENU, 1);
	key(&in[n++], VK_CONTROL, 1);
	SendInput(n, in, sizeof(INPUT));
}

static void say(const char *s) {
	fputs(s, stdout);
	fputc('\n', stdout);
	fflush(stdout);
}

int wmain(void) {
	char line[64];
	say("ready");
	while (fgets(line, sizeof line, stdin)) {
		line[strcspn(line, "\r\n")] = 0;
		if (strcmp(line, "copy") == 0 || strcmp(line, "copyadv") == 0) {
			if (!isGameWindow(GetForegroundWindow())) { say("notgame"); continue; }
			sendCopy(strcmp(line, "copyadv") == 0);
			say("ok");
		} else if (strcmp(line, "fg") == 0) {
			wchar_t cls[256] = { 0 }, title[256] = { 0 };
			char buf[1200];
			HWND w = GetForegroundWindow();
			GetClassNameW(w, cls, 255);
			GetWindowTextW(w, title, 255);
			char c8[512], t8[512];
			WideCharToMultiByte(CP_UTF8, 0, cls, -1, c8, sizeof c8, NULL, NULL);
			WideCharToMultiByte(CP_UTF8, 0, title, -1, t8, sizeof t8, NULL, NULL);
			snprintf(buf, sizeof buf, "%s|%s", c8, t8);
			say(buf);
		} else if (strcmp(line, "quit") == 0) {
			break;
		} else {
			say("error");
		}
	}
	return 0;
}
