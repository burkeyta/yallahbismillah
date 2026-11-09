/*
 * pobhost: runs a Lua script inside Path of Building's own LuaJIT.
 *
 * Path of Building ships a LuaJIT build (lua51.dll) that understands syntax newer than stock
 * LuaJIT (x += 1, a?.b). This tiny host loads that DLL from its own folder and runs a script,
 * so PoB's calculation code can run headless.
 *
 *   pobhost.exe <script.lua> [args...]       (working directory: PoB's src folder)
 *
 * Build (MinGW): x86_64-w64-mingw32-gcc -O2 -municode -o pobhost.exe pobhost.c
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

typedef struct lua_State lua_State;
typedef lua_State *(*fn_newstate)(void);
typedef void (*fn_openlibs)(lua_State *);
typedef int (*fn_loadfile)(lua_State *, const char *);
typedef int (*fn_pcall)(lua_State *, int, int, int);
typedef const char *(*fn_tolstring)(lua_State *, int, size_t *);
typedef void (*fn_createtable)(lua_State *, int, int);
typedef void (*fn_pushstring)(lua_State *, const char *);
typedef void (*fn_rawseti)(lua_State *, int, int);
typedef void (*fn_setfield)(lua_State *, int, const char *);

#define LUA_GLOBALSINDEX (-10002)

static void die(const char *msg) {
	fprintf(stderr, "pobhost: %s\n", msg);
	fflush(stderr);
	exit(1);
}

/* UTF-16 -> UTF-8 (Lua strings are bytes; PoB treats them as UTF-8) */
static char *utf8(const wchar_t *w) {
	int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, NULL, 0, NULL, NULL);
	char *s = (char *)malloc(n > 0 ? n : 1);
	if (!s) die("out of memory");
	if (n <= 0) { s[0] = 0; return s; }
	WideCharToMultiByte(CP_UTF8, 0, w, -1, s, n, NULL, NULL);
	return s;
}

int wmain(int argc, wchar_t **argv) {
	if (argc < 2) die("usage: pobhost <script.lua> [args...]");

	wchar_t dir[MAX_PATH];
	DWORD len = GetModuleFileNameW(NULL, dir, MAX_PATH);
	if (len == 0 || len >= MAX_PATH) die("cannot find own folder");
	wchar_t *slash = wcsrchr(dir, L'\\');
	if (slash) *slash = 0;
	SetDllDirectoryW(dir); /* lua-utf8.dll etc. find lua51.dll here */

	wchar_t dll[MAX_PATH + 16];
	_snwprintf(dll, MAX_PATH + 16, L"%ls\\lua51.dll", dir);
	HMODULE h = LoadLibraryW(dll);
	if (!h) die("cannot load lua51.dll next to pobhost.exe");

#define GET(type, name) type name = (type)(void *)GetProcAddress(h, #name); if (!name) die("lua51.dll lacks " #name)
	GET(fn_newstate, luaL_newstate);
	GET(fn_openlibs, luaL_openlibs);
	GET(fn_loadfile, luaL_loadfile);
	GET(fn_pcall, lua_pcall);
	GET(fn_tolstring, lua_tolstring);
	GET(fn_createtable, lua_createtable);
	GET(fn_pushstring, lua_pushstring);
	GET(fn_rawseti, lua_rawseti);
	GET(fn_setfield, lua_setfield);
#undef GET

	lua_State *L = luaL_newstate();
	if (!L) die("cannot create Lua state");
	luaL_openlibs(L);

	/* arg table like the standalone interpreter: arg[0] = script, arg[1..] = the rest */
	lua_createtable(L, argc, 0);
	for (int i = 1; i < argc; i++) {
		char *a = utf8(argv[i]);
		lua_pushstring(L, a);
		lua_rawseti(L, -2, i - 1);
		free(a);
	}
	lua_setfield(L, LUA_GLOBALSINDEX, "arg");

	/* The script path is passed relative to the working directory: Lua opens files with
	   ANSI paths, which would break on user names outside the system code page. */
	char *script = utf8(argv[1]);
	if (luaL_loadfile(L, script) != 0 || lua_pcall(L, 0, 0, 0) != 0) {
		const char *err = lua_tolstring(L, -1, NULL);
		fprintf(stderr, "pobhost: %s\n", err ? err : "(unknown error)");
		fflush(stderr);
		return 1;
	}
	free(script);
	return 0;
}
