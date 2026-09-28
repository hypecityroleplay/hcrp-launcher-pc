// HYPE Launcher - injetor integrado (Win32 / x86)
// Abre o GTA suspenso, carrega samp.dll e o modulo HYPE Chat embutido,
// e remove o modulo temporario quando o GTA fecha.
// O HYPE Chat nao e instalado na pasta do GTA.

#include "hype_chat_payload.h"

typedef unsigned char BYTE;
typedef unsigned short WORD;
typedef unsigned long DWORD;
typedef unsigned long SIZE_T;
typedef unsigned int UINT;
typedef int BOOL;
typedef void* PVOID;
typedef void* HANDLE;
typedef void* HMODULE;
typedef char* LPSTR;
typedef const char* LPCSTR;
typedef DWORD* LPDWORD;
typedef SIZE_T* PSIZE_T;
typedef DWORD (__stdcall *LPTHREAD_START_ROUTINE)(PVOID);

#define TRUE 1
#define FALSE 0
#define NULL 0
#define MAX_PATH 260
#define CREATE_SUSPENDED 0x00000004UL
#define MEM_COMMIT 0x00001000UL
#define MEM_RESERVE 0x00002000UL
#define MEM_RELEASE 0x00008000UL
#define PAGE_READWRITE 0x04UL
#define INFINITE 0xFFFFFFFFUL
#define GENERIC_WRITE 0x40000000UL
#define FILE_SHARE_READ 0x00000001UL
#define CREATE_ALWAYS 2UL
#define FILE_ATTRIBUTE_TEMPORARY 0x00000100UL
#define INVALID_HANDLE_VALUE ((HANDLE)(long)-1)
#define MB_OK 0x00000000UL
#define MB_ICONERROR 0x00000010UL

#pragma pack(push, 1)
typedef struct _STARTUPINFOA_MIN {
    DWORD cb;
    LPSTR lpReserved;
    LPSTR lpDesktop;
    LPSTR lpTitle;
    DWORD dwX;
    DWORD dwY;
    DWORD dwXSize;
    DWORD dwYSize;
    DWORD dwXCountChars;
    DWORD dwYCountChars;
    DWORD dwFillAttribute;
    DWORD dwFlags;
    WORD wShowWindow;
    WORD cbReserved2;
    BYTE* lpReserved2;
    HANDLE hStdInput;
    HANDLE hStdOutput;
    HANDLE hStdError;
} STARTUPINFOA_MIN;

typedef struct _PROCESS_INFORMATION_MIN {
    HANDLE hProcess;
    HANDLE hThread;
    DWORD dwProcessId;
    DWORD dwThreadId;
} PROCESS_INFORMATION_MIN;
#pragma pack(pop)

typedef BOOL (__stdcall *PFN_CreateProcessA)(LPCSTR, LPSTR, PVOID, PVOID, BOOL, DWORD, PVOID, LPCSTR, STARTUPINFOA_MIN*, PROCESS_INFORMATION_MIN*);
typedef PVOID (__stdcall *PFN_VirtualAllocEx)(HANDLE, PVOID, SIZE_T, DWORD, DWORD);
typedef BOOL (__stdcall *PFN_WriteProcessMemory)(HANDLE, PVOID, const void*, SIZE_T, PSIZE_T);
typedef BOOL (__stdcall *PFN_VirtualFreeEx)(HANDLE, PVOID, SIZE_T, DWORD);
typedef HANDLE (__stdcall *PFN_CreateRemoteThread)(HANDLE, PVOID, SIZE_T, LPTHREAD_START_ROUTINE, PVOID, DWORD, LPDWORD);
typedef DWORD (__stdcall *PFN_WaitForSingleObject)(HANDLE, DWORD);
typedef BOOL (__stdcall *PFN_CloseHandle)(HANDLE);
typedef DWORD (__stdcall *PFN_ResumeThread)(HANDLE);
typedef BOOL (__stdcall *PFN_TerminateProcess)(HANDLE, UINT);
typedef void (__stdcall *PFN_Sleep)(DWORD);
typedef DWORD (__stdcall *PFN_GetTempPathA)(DWORD, LPSTR);
typedef HANDLE (__stdcall *PFN_CreateFileA)(LPCSTR, DWORD, DWORD, PVOID, DWORD, DWORD, HANDLE);
typedef BOOL (__stdcall *PFN_WriteFile)(HANDLE, const void*, DWORD, LPDWORD, PVOID);
typedef BOOL (__stdcall *PFN_DeleteFileA)(LPCSTR);
typedef DWORD (__stdcall *PFN_GetCurrentProcessId)(void);
typedef DWORD (__stdcall *PFN_GetTickCount)(void);
typedef LPSTR (__stdcall *PFN_GetCommandLineA)(void);
typedef HMODULE (__stdcall *PFN_LoadLibraryA)(LPCSTR);
typedef int (__stdcall *PFN_MessageBoxA)(PVOID, LPCSTR, LPCSTR, UINT);
typedef void (__stdcall *PFN_ExitProcess)(UINT);

static PFN_CreateProcessA pCreateProcessA;
static PFN_VirtualAllocEx pVirtualAllocEx;
static PFN_WriteProcessMemory pWriteProcessMemory;
static PFN_VirtualFreeEx pVirtualFreeEx;
static PFN_CreateRemoteThread pCreateRemoteThread;
static PFN_WaitForSingleObject pWaitForSingleObject;
static PFN_CloseHandle pCloseHandle;
static PFN_ResumeThread pResumeThread;
static PFN_TerminateProcess pTerminateProcess;
static PFN_Sleep pSleep;
static PFN_GetTempPathA pGetTempPathA;
static PFN_CreateFileA pCreateFileA;
static PFN_WriteFile pWriteFile;
static PFN_DeleteFileA pDeleteFileA;
static PFN_GetCurrentProcessId pGetCurrentProcessId;
static PFN_GetTickCount pGetTickCount;
static PFN_GetCommandLineA pGetCommandLineA;
static PFN_LoadLibraryA pLoadLibraryA;
static PFN_ExitProcess pExitProcess;

static char g_cmdCopy[8192];
static char g_gtaExe[1024];
static char g_sampDll[1024];
static char g_launchCmd[4096];
static char g_tempDir[MAX_PATH + 4];
static char g_chatDllPath[MAX_PATH + 96];
static char* g_argv[16];

static void* get_peb(void) {
    void* p;
    __asm__("movl %%fs:0x30, %0" : "=r"(p));
    return p;
}

static char lower_ascii(char c) {
    if (c >= 'A' && c <= 'Z') return (char)(c + ('a' - 'A'));
    return c;
}

static BOOL ascii_eq(const char* a, const char* b) {
    if (!a || !b) return FALSE;
    while (*a && *b) {
        if (lower_ascii(*a) != lower_ascii(*b)) return FALSE;
        ++a; ++b;
    }
    return (*a == 0 && *b == 0) ? TRUE : FALSE;
}

static BOOL wide_ascii_eq_ci(const unsigned short* w, const char* a) {
    if (!w || !a) return FALSE;
    while (*w && *a) {
        char wc = (char)(*w & 0xFF);
        if (lower_ascii(wc) != lower_ascii(*a)) return FALSE;
        ++w; ++a;
    }
    return (*w == 0 && *a == 0) ? TRUE : FALSE;
}

static PVOID find_module_ascii(const char* moduleName) {
    BYTE* peb = (BYTE*)get_peb();
    if (!peb) return 0;
    BYTE* ldr = *(BYTE**)(peb + 0x0C);
    if (!ldr) return 0;
    BYTE* head = ldr + 0x14;
    BYTE* link = *(BYTE**)head;
    unsigned int guard = 0;
    while (link && link != head && guard++ < 128) {
        BYTE* entry = link - 0x08;
        PVOID base = *(PVOID*)(entry + 0x18);
        unsigned short* baseName = *(unsigned short**)(entry + 0x30);
        if (base && baseName && wide_ascii_eq_ci(baseName, moduleName)) return base;
        link = *(BYTE**)link;
    }
    return 0;
}

static PVOID resolve_export_inner(PVOID moduleBase, const char* procName, int depth);

static PVOID resolve_forwarder(const char* fwd, int depth) {
    char mod[64];
    char proc[128];
    unsigned int i = 0, j = 0, mlen = 0;
    BOOL hasDot = FALSE;
    PVOID base;

    if (!fwd || depth > 5) return 0;
    while (fwd[i] && fwd[i] != '.' && i < sizeof(mod) - 5) { mod[i] = fwd[i]; ++i; }
    if (fwd[i] != '.') return 0;
    mod[i] = 0;
    ++i;
    while (fwd[i] && j < sizeof(proc) - 1) proc[j++] = fwd[i++];
    proc[j] = 0;
    if (!proc[0] || proc[0] == '#') return 0;

    while (mod[mlen]) { if (mod[mlen] == '.') hasDot = TRUE; ++mlen; }
    if (!hasDot && mlen + 4 < sizeof(mod)) {
        mod[mlen++]='.'; mod[mlen++]='d'; mod[mlen++]='l'; mod[mlen++]='l'; mod[mlen]=0;
    }
    base = find_module_ascii(mod);
    if (!base) return 0;
    return resolve_export_inner(base, proc, depth + 1);
}

static PVOID resolve_export_inner(PVOID moduleBase, const char* procName, int depth) {
    BYTE* base;
    DWORD lfanew, expRva, expSize, nNames, funcsRva, namesRva, ordsRva, i, frva;
    BYTE* nt;
    BYTE* exp;
    DWORD* names;
    WORD* ords;
    DWORD* funcs;

    if (!moduleBase || !procName || depth > 5) return 0;
    base = (BYTE*)moduleBase;
    if (*(WORD*)base != 0x5A4D) return 0;
    lfanew = *(DWORD*)(base + 0x3C);
    nt = base + lfanew;
    if (*(DWORD*)nt != 0x00004550) return 0;
    expRva = *(DWORD*)(nt + 0x78);
    expSize = *(DWORD*)(nt + 0x7C);
    if (!expRva || !expSize) return 0;
    exp = base + expRva;
    nNames = *(DWORD*)(exp + 0x18);
    funcsRva = *(DWORD*)(exp + 0x1C);
    namesRva = *(DWORD*)(exp + 0x20);
    ordsRva = *(DWORD*)(exp + 0x24);
    names = (DWORD*)(base + namesRva);
    ords = (WORD*)(base + ordsRva);
    funcs = (DWORD*)(base + funcsRva);
    for (i = 0; i < nNames; ++i) {
        const char* name = (const char*)(base + names[i]);
        if (ascii_eq(name, procName)) {
            frva = funcs[ords[i]];
            if (frva >= expRva && frva < expRva + expSize) return resolve_forwarder((const char*)(base + frva), depth);
            return (PVOID)(base + frva);
        }
    }
    return 0;
}

static PVOID resolve_export(PVOID moduleBase, const char* procName) {
    return resolve_export_inner(moduleBase, procName, 0);
}

static unsigned int str_len(const char* s) {
    unsigned int n = 0;
    if (!s) return 0;
    while (s[n]) ++n;
    return n;
}

static void mem_zero(void* p, unsigned int n) {
    BYTE* b = (BYTE*)p;
    while (n--) *b++ = 0;
}

static BOOL str_copy(char* dst, unsigned int cap, const char* src) {
    unsigned int i = 0;
    if (!dst || !cap || !src) return FALSE;
    while (src[i]) {
        if (i + 1 >= cap) { dst[0] = 0; return FALSE; }
        dst[i] = src[i]; ++i;
    }
    dst[i] = 0;
    return TRUE;
}

static BOOL str_append(char* dst, unsigned int cap, const char* src) {
    unsigned int d = str_len(dst), i = 0;
    if (d >= cap) return FALSE;
    while (src && src[i]) {
        if (d + i + 1 >= cap) return FALSE;
        dst[d + i] = src[i]; ++i;
    }
    dst[d + i] = 0;
    return TRUE;
}

static void append_u32_dec(char* dst, unsigned int cap, DWORD value) {
    char tmp[16];
    unsigned int n = 0;
    if (value == 0) { str_append(dst, cap, "0"); return; }
    while (value && n < sizeof(tmp)) { tmp[n++] = (char)('0' + (value % 10)); value /= 10; }
    while (n) { char one[2]; one[0] = tmp[--n]; one[1] = 0; str_append(dst, cap, one); }
}

static int parse_cmdline(char* s, char** argv, int maxArgv) {
    int argc = 0;
    char* p = s;
    while (*p && argc < maxArgv) {
        char* out;
        BOOL quoted = FALSE;
        while (*p == ' ' || *p == '\t') ++p;
        if (!*p) break;
        out = p;
        argv[argc++] = out;
        while (*p) {
            if (*p == '"') {
                quoted = !quoted;
                ++p;
                continue;
            }
            if (!quoted && (*p == ' ' || *p == '\t')) {
                ++p;
                break;
            }
            *out++ = *p++;
        }
        *out = 0;
        while (*p == ' ' || *p == '\t') ++p;
    }
    return argc;
}

static void show_error(const char* msg) {
    PVOID u32;
    PFN_MessageBoxA box;
    if (!pLoadLibraryA) return;
    u32 = (PVOID)pLoadLibraryA("user32.dll");
    if (!u32) return;
    box = (PFN_MessageBoxA)resolve_export(u32, "MessageBoxA");
    if (box) box(0, msg, "HYPE Launcher", MB_OK | MB_ICONERROR);
}

static BOOL init_apis(void) {
    PVOID k32 = find_module_ascii("kernel32.dll");
    if (!k32) return FALSE;
#define RESOLVE(name, type) do { p##name = (type)resolve_export(k32, #name); if (!p##name) return FALSE; } while (0)
    RESOLVE(CreateProcessA, PFN_CreateProcessA);
    RESOLVE(VirtualAllocEx, PFN_VirtualAllocEx);
    RESOLVE(WriteProcessMemory, PFN_WriteProcessMemory);
    RESOLVE(VirtualFreeEx, PFN_VirtualFreeEx);
    RESOLVE(CreateRemoteThread, PFN_CreateRemoteThread);
    RESOLVE(WaitForSingleObject, PFN_WaitForSingleObject);
    RESOLVE(CloseHandle, PFN_CloseHandle);
    RESOLVE(ResumeThread, PFN_ResumeThread);
    RESOLVE(TerminateProcess, PFN_TerminateProcess);
    RESOLVE(Sleep, PFN_Sleep);
    RESOLVE(GetTempPathA, PFN_GetTempPathA);
    RESOLVE(CreateFileA, PFN_CreateFileA);
    RESOLVE(WriteFile, PFN_WriteFile);
    RESOLVE(DeleteFileA, PFN_DeleteFileA);
    RESOLVE(GetCurrentProcessId, PFN_GetCurrentProcessId);
    RESOLVE(GetTickCount, PFN_GetTickCount);
    RESOLVE(GetCommandLineA, PFN_GetCommandLineA);
    RESOLVE(LoadLibraryA, PFN_LoadLibraryA);
    RESOLVE(ExitProcess, PFN_ExitProcess);
#undef RESOLVE
    return TRUE;
}

static BOOL write_chat_dll_to_temp(void) {
    DWORD written = 0;
    HANDLE f;
    DWORD pid, tick;
    if (!pGetTempPathA(MAX_PATH, g_tempDir)) return FALSE;
    if (!str_copy(g_chatDllPath, sizeof(g_chatDllPath), g_tempDir)) return FALSE;
    if (!str_append(g_chatDllPath, sizeof(g_chatDllPath), "HYPELauncherRuntime\\")) return FALSE;

    // A pasta ja costuma existir porque o launcher materializa o injetor nela.
    // Para evitar dependencia de CreateDirectoryA, usamos diretamente o TEMP caso nao exista.
    // O launcher garante HYPELauncherRuntime nas builds integradas.
    pid = pGetCurrentProcessId();
    tick = pGetTickCount();
    str_append(g_chatDllPath, sizeof(g_chatDllPath), "hype-chat-");
    append_u32_dec(g_chatDllPath, sizeof(g_chatDllPath), pid);
    str_append(g_chatDllPath, sizeof(g_chatDllPath), "-");
    append_u32_dec(g_chatDllPath, sizeof(g_chatDllPath), tick);
    str_append(g_chatDllPath, sizeof(g_chatDllPath), ".dll");

    f = pCreateFileA(g_chatDllPath, GENERIC_WRITE, FILE_SHARE_READ, 0, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, 0);
    if (f == INVALID_HANDLE_VALUE) {
        // fallback: grava direto no TEMP
        str_copy(g_chatDllPath, sizeof(g_chatDllPath), g_tempDir);
        str_append(g_chatDllPath, sizeof(g_chatDllPath), "hype-chat-");
        append_u32_dec(g_chatDllPath, sizeof(g_chatDllPath), pid);
        str_append(g_chatDllPath, sizeof(g_chatDllPath), "-");
        append_u32_dec(g_chatDllPath, sizeof(g_chatDllPath), tick);
        str_append(g_chatDllPath, sizeof(g_chatDllPath), ".dll");
        f = pCreateFileA(g_chatDllPath, GENERIC_WRITE, FILE_SHARE_READ, 0, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, 0);
        if (f == INVALID_HANDLE_VALUE) return FALSE;
    }

    if (!pWriteFile(f, g_hype_chat_dll, g_hype_chat_dll_size, &written, 0) || written != g_hype_chat_dll_size) {
        pCloseHandle(f);
        pDeleteFileA(g_chatDllPath);
        return FALSE;
    }
    pCloseHandle(f);
    return TRUE;
}

static BOOL inject_library(HANDLE process, const char* dllPath) {
    SIZE_T pathLen = (SIZE_T)str_len(dllPath) + 1;
    PVOID remote = pVirtualAllocEx(process, 0, pathLen, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    HANDLE th;
    if (!remote) return FALSE;
    if (!pWriteProcessMemory(process, remote, dllPath, pathLen, 0)) {
        pVirtualFreeEx(process, remote, 0, MEM_RELEASE);
        return FALSE;
    }
    th = pCreateRemoteThread(process, 0, 0, (LPTHREAD_START_ROUTINE)pLoadLibraryA, remote, 0, 0);
    if (!th) {
        pVirtualFreeEx(process, remote, 0, MEM_RELEASE);
        return FALSE;
    }
    pWaitForSingleObject(th, INFINITE);
    pCloseHandle(th);
    pVirtualFreeEx(process, remote, 0, MEM_RELEASE);
    return TRUE;
}

static BOOL build_gta_paths_and_cmd(const char* gtaPath, const char* nick, const char* ip, const char* port, const char* pass) {
    if (!str_copy(g_gtaExe, sizeof(g_gtaExe), gtaPath)) return FALSE;
    if (str_len(g_gtaExe) && g_gtaExe[str_len(g_gtaExe)-1] != '\\') str_append(g_gtaExe, sizeof(g_gtaExe), "\\");
    str_append(g_gtaExe, sizeof(g_gtaExe), "gta_sa.exe");

    if (!str_copy(g_sampDll, sizeof(g_sampDll), gtaPath)) return FALSE;
    if (str_len(g_sampDll) && g_sampDll[str_len(g_sampDll)-1] != '\\') str_append(g_sampDll, sizeof(g_sampDll), "\\");
    str_append(g_sampDll, sizeof(g_sampDll), "samp.dll");

    g_launchCmd[0] = 0;
    str_append(g_launchCmd, sizeof(g_launchCmd), "\"");
    str_append(g_launchCmd, sizeof(g_launchCmd), g_gtaExe);
    str_append(g_launchCmd, sizeof(g_launchCmd), "\" -c -n ");
    str_append(g_launchCmd, sizeof(g_launchCmd), nick);
    str_append(g_launchCmd, sizeof(g_launchCmd), " -h ");
    str_append(g_launchCmd, sizeof(g_launchCmd), ip);
    str_append(g_launchCmd, sizeof(g_launchCmd), " -p ");
    str_append(g_launchCmd, sizeof(g_launchCmd), port);
    if (pass && *pass) {
        str_append(g_launchCmd, sizeof(g_launchCmd), " -z ");
        str_append(g_launchCmd, sizeof(g_launchCmd), pass);
    }
    return TRUE;
}

static void write_token_file(const char* token) {
    char path[MAX_PATH + 32];
    HANDLE f;
    DWORD written = 0;
    if (!token || !*token || !pGetTempPathA(MAX_PATH, path)) return;
    str_append(path, sizeof(path), "HCRP_auth.dat");
    f = pCreateFileA(path, GENERIC_WRITE, FILE_SHARE_READ, 0, CREATE_ALWAYS, 0, 0);
    if (f == INVALID_HANDLE_VALUE) return;
    pWriteFile(f, token, (DWORD)str_len(token), &written, 0);
    pCloseHandle(f);
}

void start(void) {
    LPSTR raw;
    int argc;
    STARTUPINFOA_MIN si;
    PROCESS_INFORMATION_MIN pi;
    const char *gtaPath, *nickname, *serverIp, *serverPort, *token, *password;

    if (!init_apis()) return;

    raw = pGetCommandLineA();
    if (!raw || !str_copy(g_cmdCopy, sizeof(g_cmdCopy), raw)) {
        show_error("Falha ao ler a linha de comando.");
        pExitProcess(1);
        return;
    }
    argc = parse_cmdline(g_cmdCopy, g_argv, 16);
    if (argc < 5) {
        show_error("Uso: injetor_HCRP.exe \\\"caminho_gta\\\" \\\"nick\\\" \\\"ip\\\" \\\"porta\\\" [token] [senha]");
        pExitProcess(1);
        return;
    }

    gtaPath = g_argv[1];
    nickname = g_argv[2];
    serverIp = g_argv[3];
    serverPort = g_argv[4];
    token = (argc >= 6) ? g_argv[5] : "";
    password = (argc >= 7) ? g_argv[6] : "";

    write_token_file(token);

    if (!build_gta_paths_and_cmd(gtaPath, nickname, serverIp, serverPort, password)) {
        show_error("Caminho ou parametros muito longos.");
        pExitProcess(1);
        return;
    }

    if (!write_chat_dll_to_temp()) {
        show_error("Falha ao preparar o modulo HYPE Chat temporario.");
        pExitProcess(1);
        return;
    }

    mem_zero(&si, sizeof(si));
    mem_zero(&pi, sizeof(pi));
    si.cb = sizeof(si);

    if (!pCreateProcessA(0, g_launchCmd, 0, 0, FALSE, CREATE_SUSPENDED, 0, gtaPath, &si, &pi)) {
        pDeleteFileA(g_chatDllPath);
        show_error("Falha ao criar processo do GTA.");
        pExitProcess(1);
        return;
    }

    // Primeiro carrega o SA-MP original da pasta do GTA.
    if (!inject_library(pi.hProcess, g_sampDll)) {
        pTerminateProcess(pi.hProcess, 1);
        pCloseHandle(pi.hThread);
        pCloseHandle(pi.hProcess);
        pDeleteFileA(g_chatDllPath);
        show_error("Falha ao carregar samp.dll.");
        pExitProcess(1);
        return;
    }

    // Depois carrega o HYPE Chat temporario. Ele verifica o servidor pelo proprio comando do SA-MP.
    if (!inject_library(pi.hProcess, g_chatDllPath)) {
        pTerminateProcess(pi.hProcess, 1);
        pCloseHandle(pi.hThread);
        pCloseHandle(pi.hProcess);
        pDeleteFileA(g_chatDllPath);
        show_error("Falha ao carregar HYPE Chat.");
        pExitProcess(1);
        return;
    }

    pSleep(800);
    pResumeThread(pi.hThread);
    pCloseHandle(pi.hThread);

    // Mantem o injetor vivo so para apagar o DLL temporario quando o GTA fechar.
    pWaitForSingleObject(pi.hProcess, INFINITE);
    pCloseHandle(pi.hProcess);
    pDeleteFileA(g_chatDllPath);

    pExitProcess(0);
}
