// HYPE Chat Guard - SA-MP 0.3.7-R1
// Chat moderno v16: historico persistente, scroll moderno e texto supersampled 2x.
// O chat nativo fica permanentemente sem renderizacao; apenas o buffer/eventos sao usados.
// Ativo somente para o servidor HYPE configurado abaixo.

typedef unsigned char BYTE;
typedef unsigned short WORD;
typedef unsigned long DWORD;
typedef unsigned long ULONG;
typedef unsigned int UINT;
typedef int BOOL;
typedef void* PVOID;
typedef PVOID HANDLE;
typedef const void* PCVOID;
typedef DWORD (__stdcall *LPTHREAD_START_ROUTINE)(PVOID);
typedef HANDLE (__stdcall *PFN_CreateThread)(PVOID, unsigned long, LPTHREAD_START_ROUTINE, PVOID, DWORD, DWORD*);
typedef void (__stdcall *PFN_Sleep)(DWORD);
typedef DWORD (__stdcall *PFN_GetTickCount)(void);
typedef BOOL (__stdcall *PFN_VirtualProtect)(PVOID, unsigned long, DWORD, DWORD*);
typedef short (__stdcall *PFN_GetAsyncKeyState)(int);

#define TRUE 1
#define FALSE 0
#define DLL_PROCESS_DETACH 0
#define DLL_PROCESS_ATTACH 1
#define PAGE_EXECUTE_READWRITE 0x40UL

int _fltused = 0;

static volatile BOOL g_running = TRUE;
static PFN_Sleep g_sleep = 0;
static PFN_GetTickCount g_getTickCount = 0;
static PFN_VirtualProtect g_virtualProtect = 0;
static PFN_GetAsyncKeyState g_getAsyncKeyState = 0;
static BYTE* g_sampBase = 0;
static volatile BOOL g_hudReady = FALSE;

typedef void (__thiscall *PFN_CInputOpen)(PVOID);
static BYTE g_inputOpenTrampoline[16];
static PFN_CInputOpen g_inputOpenOriginal = 0;
static volatile DWORD g_inputOpenTick = 0u;

// Captura cada CChat::AddEntry no instante em que chega. Isso permite um
// historico realmente independente dos 100 slots/scrollbar do SA-MP.
typedef void (__thiscall *PFN_CChatAddEntry)(PVOID, int, const char*, const char*, DWORD, DWORD);
static BYTE g_chatAddTrampoline[16];
static PFN_CChatAddEntry g_chatAddOriginal = 0;

typedef void (__thiscall *PFN_CChatResetControls)(PVOID, PVOID);
static BYTE g_chatResetTrampoline[16];
static PFN_CChatResetControls g_chatResetOriginal = 0;

// V9: nao dependemos mais do CDXUTEditBox para receber teclado.
// O CInput::MsgProc e interceptado e mantemos nosso proprio buffer ANSI.
typedef int (__thiscall *PFN_CInputMsgProc)(PVOID, int, int, int);
typedef void (__thiscall *PFN_CInputProcessInput)(PVOID);
typedef void (__thiscall *PFN_CInputClose)(PVOID);
typedef void (__thiscall *PFN_CInputAddRecall)(PVOID, const char*);
typedef void (__thiscall *PFN_CInputSend)(PVOID, const char*);
typedef void (__cdecl *PFN_CInputCommandProc)(const char*);
typedef PFN_CInputCommandProc (__thiscall *PFN_CInputGetCommandHandler)(PVOID, const char*);
typedef void (__thiscall *PFN_EditBoxSetText)(PVOID, const char*, BOOL);
static BYTE g_inputMsgTrampoline[16];
static PFN_CInputMsgProc g_inputMsgOriginal = 0;
static char g_customInput[129];
static unsigned int g_customInputLen = 0u;
static volatile BOOL g_submitRequested = FALSE;

// V15: historico persistente + layout compacto estilo web/HTML (sem CEF).
// Nada some por tempo/fade: as mensagens so saem da area visivel quando entram
// novas linhas, e podem ser recuperadas pelo scroll moderno.
#define HYPE_HISTORY_MAX 2048u
#define HYPE_HISTORY_VIEW_ROWS 7u
typedef struct _HYPE_HISTORY_ENTRY {
    char prefix[29];
    char text[145];
    DWORD textColor;
    DWORD prefixColor;
    DWORD type;
    DWORD serial;
    BOOL used;
} HYPE_HISTORY_ENTRY;
static HYPE_HISTORY_ENTRY g_history[HYPE_HISTORY_MAX];
static unsigned int g_historyWrite = 0u;
static unsigned int g_historyCount = 0u;
static DWORD g_historySerial = 0u;
// 0 = fim/mais recente. Quanto maior, mais antigo.
static volatile unsigned int g_historyScroll = 0u;
static volatile BOOL g_scrollDragging = FALSE;
static volatile float g_scrollTrackX = 0.0f;
static volatile float g_scrollTrackY = 0.0f;
static volatile float g_scrollTrackW = 0.0f;
static volatile float g_scrollTrackH = 0.0f;
static volatile float g_scrollThumbY = 0.0f;
static volatile float g_scrollThumbH = 0.0f;

#define HYPE_WM_KEYDOWN 0x0100
#define HYPE_WM_CHAR         0x0102
#define HYPE_WM_MOUSEMOVE    0x0200
#define HYPE_WM_LBUTTONDOWN  0x0201
#define HYPE_WM_LBUTTONUP    0x0202
#define HYPE_WM_MOUSEWHEEL   0x020Au
#define HYPE_VK_ESCAPE       0x1B
#define HYPE_VK_RETURN       0x0D
#define HYPE_VK_BACK         0x08
#define HYPE_VK_PRIOR        0x21
#define HYPE_VK_NEXT         0x22
#define HYPE_VK_HOME         0x24
#define HYPE_VK_END          0x23

static void hype_submit_custom_input(PVOID input);

// Sincronizacao real com a GM. A GM envia mensagens invisiveis de controle
// no inicio e no fim do login; o modulo consome essas mensagens direto do
// buffer do chat e nunca depende de um tempo fixo do computador do jogador.
#define HYPE_HUD_LOCK_MARKER  "#HCRP:HUD:LOCK:93A17#"
#define HYPE_HUD_READY_MARKER "#HCRP:HUD:READY:93A17#"

#define HYPE_CHAT_ENTRY_BASE        0x132u
#define HYPE_CHAT_ENTRY_SIZE        0x0FCu
#define HYPE_CHAT_ENTRY_TEXT_OFFSET 0x020u
#define HYPE_CHAT_ENTRY_TYPE_OFFSET 0x0F0u
#define HYPE_CHAT_ENTRY_COUNT       100u
#define HYPE_CHAT_ENTRY_TEXT_MAX    144u

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
    return *a == 0 && *b == 0;
}

static BOOL wide_ascii_eq_ci(const unsigned short* w, const char* a) {
    if (!w || !a) return FALSE;
    while (*w && *a) {
        char wc = (char)(*w & 0xFF);
        if (lower_ascii(wc) != lower_ascii(*a)) return FALSE;
        ++w; ++a;
    }
    return *w == 0 && *a == 0;
}

static PVOID find_module_ascii(const char* moduleName) {
    BYTE* peb = (BYTE*)get_peb();
    if (!peb) return 0;
    BYTE* ldr = *(BYTE**)(peb + 0x0C);
    if (!ldr) return 0;
    BYTE* head = ldr + 0x14; // InMemoryOrderModuleList
    BYTE* link = *(BYTE**)head;
    unsigned int guard = 0;
    while (link && link != head && guard++ < 128) {
        BYTE* entry = link - 0x08; // LDR_DATA_TABLE_ENTRY::InMemoryOrderLinks
        PVOID base = *(PVOID*)(entry + 0x18);
        unsigned short* baseName = *(unsigned short**)(entry + 0x30);
        if (base && baseName && wide_ascii_eq_ci(baseName, moduleName)) return base;
        link = *(BYTE**)link;
    }
    return 0;
}

static DWORD rva32(BYTE* p, DWORD off) { return *(DWORD*)(p + off); }
static WORD rva16(BYTE* p, DWORD off) { return *(WORD*)(p + off); }

static PVOID resolve_export_inner(PVOID moduleBase, const char* procName, int depth);

static PVOID resolve_forwarder(const char* fwd, int depth) {
    if (!fwd || depth > 4) return 0;
    char mod[48];
    char proc[96];
    unsigned int i = 0, j = 0;
    while (fwd[i] && fwd[i] != '.' && i < sizeof(mod) - 5) {
        mod[i] = fwd[i];
        ++i;
    }
    if (fwd[i] != '.') return 0;
    mod[i] = 0;
    ++i;
    while (fwd[i] && j < sizeof(proc) - 1) proc[j++] = fwd[i++];
    proc[j] = 0;
    if (!proc[0] || proc[0] == '#') return 0;

    // O nome nos forwarders costuma vir como KERNELBASE.Func sem .dll.
    unsigned int mlen = 0;
    while (mod[mlen]) ++mlen;
    BOOL hasDot = FALSE;
    for (unsigned int k = 0; k < mlen; ++k) if (mod[k] == '.') hasDot = TRUE;
    if (!hasDot && mlen + 4 < sizeof(mod)) {
        mod[mlen++] = '.'; mod[mlen++] = 'd'; mod[mlen++] = 'l'; mod[mlen++] = 'l'; mod[mlen] = 0;
    }
    PVOID base = find_module_ascii(mod);
    if (!base) return 0;
    return resolve_export_inner(base, proc, depth + 1);
}

static PVOID resolve_export_inner(PVOID moduleBase, const char* procName, int depth) {
    if (!moduleBase || !procName || depth > 4) return 0;
    BYTE* base = (BYTE*)moduleBase;
    if (*(WORD*)base != 0x5A4D) return 0; // MZ
    DWORD lfanew = *(DWORD*)(base + 0x3C);
    BYTE* nt = base + lfanew;
    if (*(DWORD*)nt != 0x00004550) return 0; // PE\0\0
    // IMAGE_DIRECTORY_ENTRY_EXPORT no PE32: NT + 0x78.
    DWORD expRva = *(DWORD*)(nt + 0x78);
    DWORD expSize = *(DWORD*)(nt + 0x7C);
    if (!expRva || !expSize) return 0;
    BYTE* exp = base + expRva;
    DWORD nNames = *(DWORD*)(exp + 0x18);
    DWORD funcsRva = *(DWORD*)(exp + 0x1C);
    DWORD namesRva = *(DWORD*)(exp + 0x20);
    DWORD ordsRva = *(DWORD*)(exp + 0x24);
    DWORD* names = (DWORD*)(base + namesRva);
    WORD* ords = (WORD*)(base + ordsRva);
    DWORD* funcs = (DWORD*)(base + funcsRva);
    for (DWORD i = 0; i < nNames; ++i) {
        const char* name = (const char*)(base + names[i]);
        if (ascii_eq(name, procName)) {
            DWORD frva = funcs[ords[i]];
            if (frva >= expRva && frva < expRva + expSize) {
                return resolve_forwarder((const char*)(base + frva), depth);
            }
            return (PVOID)(base + frva);
        }
    }
    return 0;
}

static PVOID resolve_export(PVOID moduleBase, const char* procName) {
    return resolve_export_inner(moduleBase, procName, 0);
}

static BOOL wide_contains_ascii_ci(const unsigned short* w, unsigned int wchars, const char* a) {
    if (!w || !a || !*a) return FALSE;
    unsigned int alen = 0;
    while (a[alen]) ++alen;
    if (alen > wchars) return FALSE;
    for (unsigned int i = 0; i + alen <= wchars; ++i) {
        unsigned int j = 0;
        for (; j < alen; ++j) {
            char wc = (char)(w[i + j] & 0xFF);
            if (lower_ascii(wc) != lower_ascii(a[j])) break;
        }
        if (j == alen) return TRUE;
    }
    return FALSE;
}

static BOOL is_hype_launch(void) {
    BYTE* peb = (BYTE*)get_peb();
    if (!peb) return FALSE;
    BYTE* pp = *(BYTE**)(peb + 0x10); // ProcessParameters
    if (!pp) return FALSE;
    WORD cmdLenBytes = *(WORD*)(pp + 0x40);
    unsigned short* cmd = *(unsigned short**)(pp + 0x44);
    if (!cmd || !cmdLenBytes) return FALSE;
    unsigned int n = cmdLenBytes / 2;

    // Launcher atual usa o proxy local. Mantemos tambem o IP publico como fallback.
    BOOL localHost = wide_contains_ascii_ci(cmd, n, "-h 127.0.0.1") || wide_contains_ascii_ci(cmd, n, "-h127.0.0.1");
    BOOL localPort = wide_contains_ascii_ci(cmd, n, "-p 7777") || wide_contains_ascii_ci(cmd, n, "-p7777");
    BOOL publicHost = wide_contains_ascii_ci(cmd, n, "-h 177.54.146.232") || wide_contains_ascii_ci(cmd, n, "-h177.54.146.232");
    BOOL publicPort = wide_contains_ascii_ci(cmd, n, "-p 7772") || wide_contains_ascii_ci(cmd, n, "-p7772");
    return (localHost && localPort) || (publicHost && publicPort);
}

static BOOL verify_samp_r1(BYTE* samp) {
    if (!samp || *(WORD*)samp != 0x5A4D) return FALSE;
    DWORD lfanew = *(DWORD*)(samp + 0x3C);
    BYTE* nt = samp + lfanew;
    if (*(DWORD*)nt != 0x00004550) return FALSE;
    DWORD stamp = *(DWORD*)(nt + 0x08);
    // samp.dll enviado pelo usuario: 2015-05-01 03:35:22 UTC.
    if (stamp != 0x5542F47A) return FALSE;
    // Assinaturas conhecidas de CChat::GetMode e CInput::Open no 0.3.7-R1.
    BYTE* getMode = samp + 0x5D7A0;
    if (!(getMode[0] == 0x8B && getMode[1] == 0x41 && getMode[2] == 0x08 && getMode[3] == 0xC3)) return FALSE;
    BYTE* inputOpen = samp + 0x657E0;
    if (!(inputOpen[0] == 0x83 && inputOpen[1] == 0xEC && inputOpen[2] == 0x10 && inputOpen[3] == 0x56)) return FALSE;

    // No handler de teclas do SA-MP R1, VK_F7 (0x76) aponta para o case
    // que chama CChat::SwitchMode. O byte 8 identifica exatamente esse case.
    BYTE* f7Case = samp + 0x5DA7D;
    if (!(*f7Case == 8u || *f7Case == 11u)) return FALSE;
    return TRUE;
}

static BOOL block_f7_native(BYTE* samp) {
    DWORD oldProtect = 0;
    DWORD ignored = 0;
    BYTE* f7Case;
    if (!samp || !g_virtualProtect) return FALSE;
    f7Case = samp + 0x5DA7D;
    if (*f7Case == 11u) return TRUE;
    if (*f7Case != 8u) return FALSE;
    if (!g_virtualProtect(f7Case, 1, PAGE_EXECUTE_READWRITE, &oldProtect)) return FALSE;
    *f7Case = 11u; // default/no-op: F7 deixa de chegar ao SwitchMode do chat.
    g_virtualProtect(f7Case, 1, oldProtect, &ignored);
    return TRUE;
}

// V5: corta todas as rotas de renderizacao do chat nativo. O buffer CChat
// continua vivo, entao SendClientMessage, chat local e comandos seguem normais.
// Antes so CChat::Draw era cortado; Render/RenderToSurface ainda podiam deixar
// texto nativo sobreviver em alguns frames/configuracoes e embolar com o moderno.
static BOOL patch_ret_at(BYTE* address) {
    DWORD oldProtect = 0;
    DWORD ignored = 0;
    if (!address || !g_virtualProtect) return FALSE;
    if (*address == 0xC3u) return TRUE;
    if (*address == 0x00u || *address == 0xCCu) return FALSE;
    if (!g_virtualProtect(address, 1, PAGE_EXECUTE_READWRITE, &oldProtect)) return FALSE;
    *address = 0xC3u;
    g_virtualProtect(address, 1, oldProtect, &ignored);
    return TRUE;
}

static BOOL disable_native_chat_draw(BYTE* samp) {
    BOOL okRender;
    BOOL okDraw;
    BOOL okSurface;
    if (!samp) return FALSE;
    okRender  = patch_ret_at(samp + 0x63D70u); // CChat::Render
    okDraw    = patch_ret_at(samp + 0x64230u); // CChat::Draw
    okSurface = patch_ret_at(samp + 0x64300u); // CChat::RenderToSurface
    return okRender && okDraw && okSurface;
}

typedef void (__cdecl *PFN_CHudDraw)(void);

// ---------------------------------------------------------------------------
// HYPE Chat Moderno v5
// Substitui o desenho do chat SA-MP: o buffer e o input continuam nativos,
// mas texto, fundo e caixa de digitacao sao desenhados por este modulo.
// ---------------------------------------------------------------------------
typedef struct _HYPE_RECT {
    float left;
    float top;
    float right;
    float bottom;
} HYPE_RECT;

typedef struct _HYPE_RGBA {
    BYTE r;
    BYTE g;
    BYTE b;
    BYTE a;
} HYPE_RGBA;

typedef struct _HYPE_CRECT {
    long left;
    long top;
    long right;
    long bottom;
} HYPE_CRECT;

typedef struct _HYPE_POINT {
    long x;
    long y;
} HYPE_POINT;

typedef void (__cdecl *PFN_DrawRect2D)(const HYPE_RECT*, const HYPE_RGBA*);
typedef void (__thiscall *PFN_CFontsDrawText)(PVOID, PVOID, const char*, HYPE_CRECT, DWORD, BOOL);
typedef void (__thiscall *PFN_CFontsGetTextScreenSize)(PVOID, PVOID, const char*, int);
typedef const char* (__thiscall *PFN_EditBoxGetText)(PVOID);
typedef long (__stdcall *PFN_SpriteBegin)(PVOID, DWORD);
typedef long (__stdcall *PFN_SpriteEnd)(PVOID);
typedef long (__stdcall *PFN_SpriteSetTransform)(PVOID, const void*);

// D3DX9 font proprio. V16 renderiza a fonte em 2x e reduz pelo sprite,
// simulando supersampling para um acabamento mais proximo de UI/web.
typedef long (__stdcall *PFN_D3DXCreateFontA)(PVOID, int, UINT, UINT, UINT, BOOL, DWORD, DWORD, DWORD, DWORD, const char*, PVOID*);
typedef int (__stdcall *PFN_D3DXFontDrawTextA)(PVOID, PVOID, const char*, int, HYPE_CRECT*, DWORD, DWORD);
typedef ULONG (__stdcall *PFN_ComRelease)(PVOID);
static PVOID g_modernFont = 0;
static int g_modernFontHeight = 0; // altura LOGICA na tela
static int g_modernFontRasterHeight = 0; // altura real do atlas (2x)
static PVOID g_modernFontDevice = 0;
static BOOL g_modernTextSupersampled = FALSE;
#define HYPE_TEXT_SS 2.0f

#define HYPE_CHAT_FONT_RENDERER_OFFSET 0x63A2u
#define HYPE_CHAT_TEXT_SPRITE_OFFSET   0x63A6u
#define HYPE_CHAT_DEVICE_OFFSET        0x63AEu
#define HYPE_CHAT_SCROLL_POS_OFFSET    0x63E2u
#define HYPE_CHAT_CHAR_HEIGHT_OFFSET   0x63E6u
#define HYPE_CHAT_PREFIX_OFFSET        0x004u
#define HYPE_CHAT_TEXT_COLOR_OFFSET    0x0F4u
#define HYPE_CHAT_PREFIX_COLOR_OFFSET  0x0F8u
#define HYPE_SPRITE_ALPHABLEND         0x00000010u
// Confirmado no samp.dll enviado: CChat::Draw R1 usa ID3DXSprite::Begin(0x10).
// 0x02 = DONOTMODIFY_RENDERSTATE e fazia os glifos virarem blocos brancos.
#define HYPE_DXUT_VISIBLE_OFFSET       0x04u
#define HYPE_CHAT_SCROLLBAR_OFFSET      0x11Eu
#define HYPE_DT_CALCRECT               0x00000400u
#define HYPE_DT_SINGLELINE             0x00000020u
#define HYPE_DT_NOCLIP                 0x00000100u
#define HYPE_FW_NORMAL                 400u
#define HYPE_DEFAULT_CHARSET           1u
#define HYPE_OUT_DEFAULT_PRECIS        0u
#define HYPE_CLEARTYPE_NATURAL_QUALITY 6u
#define HYPE_DEFAULT_PITCH             0u

static float clamp_float(float value, float minValue, float maxValue) {
    if (value < minValue) return minValue;
    if (value > maxValue) return maxValue;
    return value;
}

static DWORD clamp_u32(DWORD value, DWORD minValue, DWORD maxValue) {
    if (value < minValue) return minValue;
    if (value > maxValue) return maxValue;
    return value;
}

static unsigned int hype_strlen_limit(const char* s, unsigned int limit) {
    unsigned int n = 0;
    if (!s) return 0;
    while (n < limit && s[n]) ++n;
    return n;
}

static BOOL hype_is_hex(char c) {
    return ((c >= '0' && c <= '9') ||
            (c >= 'a' && c <= 'f') ||
            (c >= 'A' && c <= 'F'));
}

static BYTE hype_hex_value(char c) {
    if (c >= '0' && c <= '9') return (BYTE)(c - '0');
    if (c >= 'a' && c <= 'f') return (BYTE)(10 + c - 'a');
    if (c >= 'A' && c <= 'F') return (BYTE)(10 + c - 'A');
    return 0;
}

static BOOL hype_parse_color_tag(const char* s, DWORD* colorOut) {
    DWORD rgb = 0;
    unsigned int i;
    if (!s || !colorOut || s[0] != '{' || s[7] != '}') return FALSE;
    for (i = 1; i <= 6; ++i) {
        if (!hype_is_hex(s[i])) return FALSE;
        rgb = (rgb << 4) | hype_hex_value(s[i]);
    }
    *colorOut = 0xFF000000u | rgb;
    return TRUE;
}

static DWORD hype_opaque_color(DWORD color) {
    if ((color & 0xFF000000u) == 0u) color |= 0xFF000000u;
    return color;
}

static DWORD hype_color_alpha(DWORD color, BYTE alpha) {
    color = hype_opaque_color(color);
    return (color & 0x00FFFFFFu) | ((DWORD)alpha << 24);
}

static BYTE hype_scale_alpha(BYTE baseAlpha, BYTE fadeAlpha) {
    return (BYTE)(((DWORD)baseAlpha * (DWORD)fadeAlpha) / 255u);
}

static void hype_draw_rect(float left, float top, float right, float bottom,
                           BYTE r, BYTE g, BYTE b, BYTE a) {
    HYPE_RECT rect;
    HYPE_RGBA color;
    PFN_DrawRect2D drawRect = (PFN_DrawRect2D)0x00727B60;

    if (right <= left || bottom <= top || !drawRect || a == 0u) return;
    rect.left = left;
    rect.top = top;
    rect.right = right;
    rect.bottom = bottom;
    color.r = r;
    color.g = g;
    color.b = b;
    color.a = a;
    drawRect(&rect, &color);
}

static void hype_draw_round_rect(float x, float y, float w, float h, float radius,
                                 BYTE r, BYTE g, BYTE b, BYTE a) {
    float r1;
    if (w <= 2.0f || h <= 2.0f || a == 0u) return;
    radius = clamp_float(radius, 2.0f, 12.0f);
    r1 = radius;

    hype_draw_rect(x, y + r1, x + w, y + h - r1, r, g, b, a);
    hype_draw_rect(x + r1, y, x + w - r1, y + 2.0f, r, g, b, a);
    hype_draw_rect(x + r1 * 0.55f, y + 2.0f, x + w - r1 * 0.55f, y + 4.0f, r, g, b, a);
    hype_draw_rect(x + 2.0f, y + 4.0f, x + w - 2.0f, y + r1, r, g, b, a);
    hype_draw_rect(x + 2.0f, y + h - r1, x + w - 2.0f, y + h - 4.0f, r, g, b, a);
    hype_draw_rect(x + r1 * 0.55f, y + h - 4.0f, x + w - r1 * 0.55f, y + h - 2.0f, r, g, b, a);
    hype_draw_rect(x + r1, y + h - 2.0f, x + w - r1, y + h, r, g, b, a);
}

static BOOL hype_chat_has_messages(BYTE* chat) {
    unsigned int i;
    if (!chat) return FALSE;
    for (i = 0; i < HYPE_CHAT_ENTRY_COUNT; ++i) {
        BYTE* entry = chat + HYPE_CHAT_ENTRY_BASE + (i * HYPE_CHAT_ENTRY_SIZE);
        char* prefix = (char*)(entry + HYPE_CHAT_PREFIX_OFFSET);
        char* text = (char*)(entry + HYPE_CHAT_ENTRY_TEXT_OFFSET);
        DWORD type = *(volatile DWORD*)(entry + HYPE_CHAT_ENTRY_TYPE_OFFSET);
        if (type != 0u && ((text && text[0]) || (prefix && prefix[0]))) return TRUE;
    }
    return FALSE;
}

static float hype_measure_text(PVOID fonts, const char* text) {
    HYPE_POINT point;
    PFN_CFontsGetTextScreenSize getSize;
    if (!g_sampBase || !fonts || !text || !text[0]) return 0.0f;
    point.x = 0;
    point.y = 0;
    getSize = (PFN_CFontsGetTextScreenSize)(g_sampBase + 0x66B20u);
    getSize(fonts, &point, text, 0);
    if (point.x < 0 || point.x > 4000) return 0.0f;
    return (float)point.x;
}

static float hype_draw_text_plain_alpha(PVOID fonts, PVOID sprite, const char* text,
                                        float x, float y, float right, float bottom,
                                        DWORD color, BYTE alpha) {
    HYPE_CRECT rect;
    PFN_CFontsDrawText drawText;
    if (!g_sampBase || !fonts || !sprite || !text || !text[0] || alpha == 0u) return x;
    rect.left = (long)x;
    rect.top = (long)y;
    rect.right = (long)right;
    rect.bottom = (long)bottom;
    drawText = (PFN_CFontsDrawText)(g_sampBase + 0x66C80u);
    drawText(fonts, sprite, text, rect, hype_color_alpha(color, alpha), FALSE);
    return x + hype_measure_text(fonts, text);
}

static float hype_draw_text_plain(PVOID fonts, PVOID sprite, const char* text,
                                  float x, float y, float right, float bottom,
                                  DWORD color) {
    return hype_draw_text_plain_alpha(fonts, sprite, text, x, y, right, bottom, color, 255u);
}

// Desenha {RRGGBB} sem mostrar os codigos no chat. Assim as mensagens da GM
// preservam as mesmas cores, mas usam o layout moderno.
static float hype_draw_text_colored_alpha(PVOID fonts, PVOID sprite, const char* text,
                                          float x, float y, float right, float bottom,
                                          DWORD baseColor, BYTE alpha) {
    char segment[160];
    unsigned int segLen = 0;
    unsigned int i = 0;
    DWORD color = hype_opaque_color(baseColor);
    if (!text || alpha == 0u) return x;

    while (text[i] && i < 512u) {
        DWORD tagged;
        if (text[i] == '{' && hype_strlen_limit(text + i, 8u) >= 8u &&
            hype_parse_color_tag(text + i, &tagged)) {
            if (segLen) {
                segment[segLen] = 0;
                x = hype_draw_text_plain_alpha(fonts, sprite, segment, x, y, right, bottom, color, alpha);
                segLen = 0;
            }
            color = tagged;
            i += 8u;
            continue;
        }
        if (segLen + 1u < sizeof(segment)) segment[segLen++] = text[i];
        ++i;
    }
    if (segLen) {
        segment[segLen] = 0;
        x = hype_draw_text_plain_alpha(fonts, sprite, segment, x, y, right, bottom, color, alpha);
    }
    return x;
}

static float hype_draw_text_colored(PVOID fonts, PVOID sprite, const char* text,
                                    float x, float y, float right, float bottom,
                                    DWORD baseColor) {
    return hype_draw_text_colored_alpha(fonts, sprite, text, x, y, right, bottom, baseColor, 255u);
}

static float hype_measure_text_colored(PVOID fonts, const char* text) {
    char segment[160];
    unsigned int segLen = 0;
    unsigned int i = 0;
    float width = 0.0f;
    if (!text) return 0.0f;

    while (text[i] && i < 512u) {
        DWORD tagged;
        if (text[i] == '{' && hype_strlen_limit(text + i, 8u) >= 8u &&
            hype_parse_color_tag(text + i, &tagged)) {
            if (segLen) {
                segment[segLen] = 0;
                width += hype_measure_text(fonts, segment);
                segLen = 0;
            }
            i += 8u;
            continue;
        }
        if (segLen + 1u < sizeof(segment)) segment[segLen++] = text[i];
        ++i;
    }
    if (segLen) {
        segment[segLen] = 0;
        width += hype_measure_text(fonts, segment);
    }
    return width;
}

// ---------------------------------------------------------------------------
// Fonte moderna D3DX. Mantemos o renderer antigo apenas como fallback.
// ---------------------------------------------------------------------------
static void hype_release_modern_font(void) {
    if (g_modernFont) {
        PVOID* vtbl = *(PVOID**)g_modernFont;
        if (vtbl && vtbl[2]) {
            PFN_ComRelease release = (PFN_ComRelease)vtbl[2];
            release(g_modernFont);
        }
    }
    g_modernFont = 0;
    g_modernFontHeight = 0;
    g_modernFontRasterHeight = 0;
    g_modernFontDevice = 0;
    g_modernTextSupersampled = FALSE;
}

static BOOL hype_ensure_modern_font(BYTE* chat, int screenHeight) {
    PVOID d3dx;
    PFN_D3DXCreateFontA createFont;
    PVOID device;
    PVOID font = 0;
    int height;
    int rasterHeight;
    long hr;

    if (!chat) return FALSE;
    device = *(PVOID*)(chat + HYPE_CHAT_DEVICE_OFFSET);
    if (!device) {
        // GTA SA 1.0: ponteiro global do IDirect3DDevice9. Serve como fallback
        // caso o CChat ainda esteja em uma fase intermediaria de inicializacao.
        device = *(PVOID*)0x00C97C28;
    }
    if (!device) return FALSE;

    // Mantem o tamanho visual da V15, mas rasteriza cada glifo no dobro da
    // resolucao. O sprite reduz para 50%, suavizando serrilhado/pixelizacao.
    height = screenHeight / 54;
    if (height < 14) height = 14;
    if (height > 22) height = 22;
    rasterHeight = height * 2;

    if (g_modernFont && g_modernFontDevice == device &&
        g_modernFontHeight == height && g_modernFontRasterHeight == rasterHeight)
        return TRUE;

    hype_release_modern_font();

    d3dx = find_module_ascii("d3dx9_25.dll");
    if (!d3dx) return FALSE;
    createFont = (PFN_D3DXCreateFontA)resolve_export(d3dx, "D3DXCreateFontA");
    if (!createFont) return FALSE;

    hr = createFont(device, rasterHeight, 0u, HYPE_FW_NORMAL, 1u, FALSE,
                    HYPE_DEFAULT_CHARSET, HYPE_OUT_DEFAULT_PRECIS,
                    HYPE_CLEARTYPE_NATURAL_QUALITY, HYPE_DEFAULT_PITCH,
                    "Segoe UI", &font);
    if (hr < 0 || !font) {
        font = 0;
        hr = createFont(device, rasterHeight, 0u, HYPE_FW_NORMAL, 1u, FALSE,
                        HYPE_DEFAULT_CHARSET, HYPE_OUT_DEFAULT_PRECIS,
                        HYPE_CLEARTYPE_NATURAL_QUALITY, HYPE_DEFAULT_PITCH,
                        "Tahoma", &font);
    }
    if (hr < 0 || !font) return FALSE;

    g_modernFont = font;
    g_modernFontDevice = device;
    g_modernFontHeight = height;
    g_modernFontRasterHeight = rasterHeight;
    g_modernTextSupersampled = TRUE;
    return TRUE;
}

static int hype_modern_font_draw(PVOID sprite, const char* text, HYPE_CRECT* rect,
                                 DWORD format, DWORD color) {
    PVOID* vtbl;
    PFN_D3DXFontDrawTextA drawText;
    if (!g_modernFont || !text || !rect) return 0;
    vtbl = *(PVOID**)g_modernFont;
    if (!vtbl || !vtbl[14]) return 0;
    drawText = (PFN_D3DXFontDrawTextA)vtbl[14];
    return drawText(g_modernFont, sprite, text, -1, rect, format, color);
}

static float hype_modern_measure_plain(PVOID fallbackFonts, const char* text) {
    HYPE_CRECT rect;
    int r;
    if (!text || !text[0]) return 0.0f;
    if (!g_modernFont) return hype_measure_text(fallbackFonts, text);
    rect.left = 0;
    rect.top = 0;
    rect.right = 4096;
    rect.bottom = 256;
    r = hype_modern_font_draw(0, text, &rect, HYPE_DT_CALCRECT | HYPE_DT_SINGLELINE, 0xFFFFFFFFu);
    if (r < 0 || rect.right < rect.left || rect.right > 8000)
        return hype_measure_text(fallbackFonts, text);
    if (g_modernTextSupersampled)
        return (float)(rect.right - rect.left) / HYPE_TEXT_SS;
    return (float)(rect.right - rect.left);
}

static float hype_modern_draw_plain(PVOID fallbackFonts, PVOID sprite, const char* text,
                                    float x, float y, float right, float bottom,
                                    DWORD color, BYTE alpha) {
    HYPE_CRECT rect;
    if (!text || !text[0] || alpha == 0u) return x;
    if (!g_modernFont) {
        return hype_draw_text_plain_alpha(fallbackFonts, sprite, text, x, y, right, bottom,
                                          color, alpha);
    }
    if (g_modernTextSupersampled) {
        rect.left = (long)(x * HYPE_TEXT_SS);
        rect.top = (long)(y * HYPE_TEXT_SS);
        rect.right = (long)(right * HYPE_TEXT_SS);
        rect.bottom = (long)(bottom * HYPE_TEXT_SS);
    } else {
        rect.left = (long)x;
        rect.top = (long)y;
        rect.right = (long)right;
        rect.bottom = (long)bottom;
    }

    // Sombra leve de 0,5 px (1 px no raster 2x), parecida com texto CSS sobre
    // fundo translucido. Ajuda a leitura sem criar contorno grosso/pixelado.
    if (g_modernTextSupersampled && alpha > 80u) {
        HYPE_CRECT shadow = rect;
        shadow.left += 1; shadow.right += 1;
        shadow.top += 1; shadow.bottom += 1;
        hype_modern_font_draw(sprite, text, &shadow, HYPE_DT_SINGLELINE,
                              hype_color_alpha(0xFF000000u, (BYTE)(alpha / 3u)));
    }
    hype_modern_font_draw(sprite, text, &rect, HYPE_DT_SINGLELINE,
                          hype_color_alpha(color, alpha));
    return x + hype_modern_measure_plain(fallbackFonts, text);
}

static float hype_modern_draw_colored(PVOID fallbackFonts, PVOID sprite, const char* text,
                                      float x, float y, float right, float bottom,
                                      DWORD baseColor, BYTE alpha) {
    char segment[160];
    unsigned int segLen = 0u;
    unsigned int i = 0u;
    DWORD color = hype_opaque_color(baseColor);
    if (!text || alpha == 0u) return x;

    while (text[i] && i < 512u) {
        DWORD tagged;
        if (text[i] == '{' && hype_strlen_limit(text + i, 8u) >= 8u &&
            hype_parse_color_tag(text + i, &tagged)) {
            if (segLen) {
                segment[segLen] = 0;
                x = hype_modern_draw_plain(fallbackFonts, sprite, segment, x, y, right, bottom,
                                           color, alpha);
                segLen = 0u;
            }
            color = tagged;
            i += 8u;
            continue;
        }
        if (segLen + 1u < sizeof(segment)) segment[segLen++] = text[i];
        ++i;
    }
    if (segLen) {
        segment[segLen] = 0;
        x = hype_modern_draw_plain(fallbackFonts, sprite, segment, x, y, right, bottom,
                                   color, alpha);
    }
    return x;
}

static float hype_modern_measure_colored(PVOID fallbackFonts, const char* text) {
    char segment[160];
    unsigned int segLen = 0u;
    unsigned int i = 0u;
    float width = 0.0f;
    if (!text) return 0.0f;
    while (text[i] && i < 512u) {
        DWORD tagged;
        if (text[i] == '{' && hype_strlen_limit(text + i, 8u) >= 8u &&
            hype_parse_color_tag(text + i, &tagged)) {
            if (segLen) {
                segment[segLen] = 0;
                width += hype_modern_measure_plain(fallbackFonts, segment);
                segLen = 0u;
            }
            i += 8u;
            continue;
        }
        if (segLen + 1u < sizeof(segment)) segment[segLen++] = text[i];
        ++i;
    }
    if (segLen) {
        segment[segLen] = 0;
        width += hype_modern_measure_plain(fallbackFonts, segment);
    }
    return width;
}

typedef struct _HYPE_MATRIX4 {
    float m[4][4];
} HYPE_MATRIX4;

static void hype_matrix_identity(HYPE_MATRIX4* matrix) {
    unsigned int r, c;
    if (!matrix) return;
    for (r = 0u; r < 4u; ++r)
        for (c = 0u; c < 4u; ++c)
            matrix->m[r][c] = (r == c) ? 1.0f : 0.0f;
}

static BOOL hype_sprite_set_scale(PVOID sprite, float scale) {
    PVOID* vtbl;
    PFN_SpriteSetTransform setTransform;
    HYPE_MATRIX4 matrix;
    if (!sprite) return FALSE;
    vtbl = *(PVOID**)sprite;
    if (!vtbl || !vtbl[5]) return FALSE;
    hype_matrix_identity(&matrix);
    matrix.m[0][0] = scale;
    matrix.m[1][1] = scale;
    setTransform = (PFN_SpriteSetTransform)vtbl[5];
    return setTransform(sprite, &matrix) >= 0;
}

static BOOL hype_sprite_begin(PVOID sprite) {
    PVOID* vtbl;
    PFN_SpriteBegin begin;
    if (!sprite) return FALSE;
    vtbl = *(PVOID**)sprite;
    if (!vtbl || !vtbl[8]) return FALSE;
    begin = (PFN_SpriteBegin)vtbl[8];
    return begin(sprite, HYPE_SPRITE_ALPHABLEND) >= 0;
}

static void hype_sprite_end(PVOID sprite) {
    PVOID* vtbl;
    PFN_SpriteEnd end;
    if (!sprite) return;
    vtbl = *(PVOID**)sprite;
    if (!vtbl || !vtbl[11]) return;
    end = (PFN_SpriteEnd)vtbl[11];
    end(sprite);
}

static const char* hype_get_live_input(BYTE* input) {
    // V8: enquanto o chat esta aberto, a fonte de verdade e o buffer capturado
    // pelo hook de CInput::MsgProc. Isso independe da visibilidade do DXUT.
    if (input && *(volatile DWORD*)(input + 0x14E0u)) return g_customInput;

    // Fallback apenas para seguranca quando o input estiver fechado.
    if (g_sampBase && input) {
        BYTE* editBox = *(BYTE**)(input + 0x08u);
        if (editBox) {
            PFN_EditBoxGetText getText = (PFN_EditBoxGetText)(g_sampBase + 0x81030u);
            const char* text = getText(editBox);
            if (text) return text;
        }
    }
    return "";
}

// ---------------------------------------------------------------------------
// V15 - historico persistente do chat novo.
// ---------------------------------------------------------------------------
static void hype_copy_text(char* dst, unsigned int cap, const char* src) {
    unsigned int i = 0u;
    if (!dst || cap == 0u) return;
    if (!src) { dst[0] = 0; return; }
    while (src[i] && i + 1u < cap) { dst[i] = src[i]; ++i; }
    dst[i] = 0;
}

static BOOL hype_text_contains(const char* text, const char* needle) {
    unsigned int i, j, n = 0u;
    if (!text || !needle || !needle[0]) return FALSE;
    while (needle[n]) ++n;
    for (i = 0u; text[i]; ++i) {
        for (j = 0u; j < n && text[i + j] == needle[j]; ++j) { }
        if (j == n) return TRUE;
    }
    return FALSE;
}

static BOOL hype_is_control_message(const char* text) {
    if (!text) return FALSE;
    if (hype_text_contains(text, HYPE_HUD_LOCK_MARKER)) return TRUE;
    if (hype_text_contains(text, HYPE_HUD_READY_MARKER)) return TRUE;
    return FALSE;
}

static unsigned int hype_history_max_scroll(void) {
    if (g_historyCount <= HYPE_HISTORY_VIEW_ROWS) return 0u;
    return g_historyCount - HYPE_HISTORY_VIEW_ROWS;
}

static void hype_history_clamp_scroll(void) {
    unsigned int maxScroll = hype_history_max_scroll();
    if (g_historyScroll > maxScroll) g_historyScroll = maxScroll;
}

static void hype_history_scroll_by(int delta) {
    unsigned int maxScroll = hype_history_max_scroll();
    int value = (int)g_historyScroll + delta;
    if (value < 0) value = 0;
    if ((unsigned int)value > maxScroll) value = (int)maxScroll;
    g_historyScroll = (unsigned int)value;
}

static HYPE_HISTORY_ENTRY* hype_history_at(unsigned int logicalIndex) {
    unsigned int first;
    unsigned int idx;
    if (logicalIndex >= g_historyCount || g_historyCount == 0u) return 0;
    first = (g_historyWrite + HYPE_HISTORY_MAX - g_historyCount) % HYPE_HISTORY_MAX;
    idx = (first + logicalIndex) % HYPE_HISTORY_MAX;
    return &g_history[idx];
}

static void hype_history_push(int type, const char* text, const char* prefix,
                              DWORD textColor, DWORD prefixColor) {
    HYPE_HISTORY_ENTRY* e;
    unsigned int wasScrolled = g_historyScroll;

    if ((!text || !text[0]) && (!prefix || !prefix[0])) return;
    if (hype_is_control_message(text)) return;

    e = &g_history[g_historyWrite];
    hype_copy_text(e->prefix, sizeof(e->prefix), prefix ? prefix : "");
    hype_copy_text(e->text, sizeof(e->text), text ? text : "");
    e->textColor = textColor ? textColor : 0xFFFFFFFFu;
    e->prefixColor = prefixColor ? prefixColor : 0xFF00BFFFu;
    e->type = (DWORD)type;
    e->serial = ++g_historySerial;
    e->used = TRUE;

    g_historyWrite = (g_historyWrite + 1u) % HYPE_HISTORY_MAX;
    if (g_historyCount < HYPE_HISTORY_MAX) ++g_historyCount;

    // Se o jogador esta lendo mensagens antigas, uma nova linha nao deve puxar
    // a tela para baixo. Aumentamos o offset para manter exatamente a leitura.
    if (wasScrolled > 0u && g_historyScroll < hype_history_max_scroll())
        ++g_historyScroll;
    hype_history_clamp_scroll();
}

static void hype_seed_history_from_chat(BYTE* chat) {
    int i;
    if (!chat || g_historyCount != 0u) return;
    // No CChat R1 o slot 0 e o mais recente. Inserimos de tras para frente para
    // construir nosso historico em ordem cronologica: antigo -> novo.
    for (i = (int)HYPE_CHAT_ENTRY_COUNT - 1; i >= 0; --i) {
        BYTE* entry = chat + HYPE_CHAT_ENTRY_BASE + ((unsigned int)i * HYPE_CHAT_ENTRY_SIZE);
        DWORD type = *(volatile DWORD*)(entry + HYPE_CHAT_ENTRY_TYPE_OFFSET);
        char* prefix = (char*)(entry + HYPE_CHAT_PREFIX_OFFSET);
        char* text = (char*)(entry + HYPE_CHAT_ENTRY_TEXT_OFFSET);
        DWORD textColor = *(volatile DWORD*)(entry + HYPE_CHAT_TEXT_COLOR_OFFSET);
        DWORD prefixColor = *(volatile DWORD*)(entry + HYPE_CHAT_PREFIX_COLOR_OFFSET);
        if (type == 0u || ((!prefix || !prefix[0]) && (!text || !text[0]))) continue;
        hype_history_push((int)type, text, prefix, textColor, prefixColor);
    }
}

static void __fastcall hype_chat_add_hook(PVOID self, PVOID ignoredEdx, int type,
                                          const char* text, const char* prefix,
                                          DWORD textColor, DWORD prefixColor) {
    (void)ignoredEdx;
    hype_history_push(type, text, prefix, textColor, prefixColor);
    if (g_chatAddOriginal)
        g_chatAddOriginal(self, type, text, prefix, textColor, prefixColor);
}

static void hype_draw_modern_chat(void) {
    BYTE* chat;
    BYTE* input;
    PVOID fallbackFonts;
    PVOID sprite;
    DWORD inputEnabled = 0u;
    int screenWidth;
    int screenHeight;
    float sx;
    float sy;
    float x;
    float y;
    float maxW;
    float rowH;
    float gap;
    float radius;
    float laneW = 0.0f;
    float drawY;
    float textPadX;
    float textYInset;
    unsigned int rows = HYPE_HISTORY_VIEW_ROWS;
    unsigned int count;
    unsigned int maxScroll;
    unsigned int newestLogical = 0u;
    unsigned int firstLogical = 0u;
    unsigned int visibleCount = 0u;
    unsigned int slot;
    HYPE_HISTORY_ENTRY* visible[HYPE_HISTORY_VIEW_ROWS];
    float visibleWidth[HYPE_HISTORY_VIEW_ROWS];

    if (!g_sampBase) return;

    chat = *(BYTE**)(g_sampBase + 0x21A0E4u);
    input = *(BYTE**)(g_sampBase + 0x21A0E8u);
    if (!chat) return;

    screenWidth = *(volatile int*)0x00C17044;
    screenHeight = *(volatile int*)0x00C17048;
    if (screenWidth < 640 || screenWidth > 7680 || screenHeight < 480 || screenHeight > 4320) return;

    sx = (float)screenWidth / 1366.0f;
    sy = (float)screenHeight / 768.0f;
    if (input) inputEnabled = *(volatile DWORD*)(input + 0x14E0u);

    fallbackFonts = *(PVOID*)(chat + HYPE_CHAT_FONT_RENDERER_OFFSET);
    sprite = *(PVOID*)(chat + HYPE_CHAT_TEXT_SPRITE_OFFSET);
    if (!fallbackFonts || !sprite) return;

    hype_ensure_modern_font(chat, screenHeight);
    hype_history_clamp_scroll();

    // V15: dimensoes compactas como o chat antigo, mas com visual moderno.
    // Em 1366x768 a area volta a ocupar aproximadamente 500 px de largura
    // e apenas 7 mensagens por vez, evitando o painel gigante da V14.
    x = 36.0f * sx;
    y = 18.0f * sy;
    maxW = clamp_float((float)screenWidth * 0.365f, 350.0f * sx, 500.0f * sx);
    rowH = clamp_float(25.0f * sy, 23.0f, 31.0f * sy);
    gap = clamp_float(3.0f * sy, 2.0f, 5.0f * sy);
    radius = clamp_float(7.0f * ((sx + sy) * 0.5f), 5.0f, 9.0f);
    textPadX = 11.0f * sx;
    textYInset = clamp_float((rowH - (float)(g_modernFontHeight ? g_modernFontHeight : 16)) * 0.5f - 1.0f,
                             4.0f * sy, 9.0f * sy);

    count = g_historyCount;
    maxScroll = hype_history_max_scroll();
    if (g_historyScroll > maxScroll) g_historyScroll = maxScroll;

    if (count > 0u) {
        newestLogical = count - 1u - g_historyScroll;
        if (newestLogical + 1u > rows)
            firstLogical = newestLogical + 1u - rows;
        else
            firstLogical = 0u;
        visibleCount = newestLogical - firstLogical + 1u;
        if (visibleCount > rows) visibleCount = rows;
    }

    for (slot = 0u; slot < visibleCount; ++slot) {
        HYPE_HISTORY_ENTRY* e = hype_history_at(firstLogical + slot);
        float contentW = 0.0f;
        float bubbleW;
        visible[slot] = e;
        if (!e) { visibleWidth[slot] = 0.0f; continue; }
        if (e->prefix[0]) contentW += hype_modern_measure_colored(fallbackFonts, e->prefix);
        if (e->prefix[0] && e->text[0]) contentW += 6.0f * sx;
        if (e->text[0]) contentW += hype_modern_measure_colored(fallbackFonts, e->text);
        bubbleW = clamp_float(contentW + (22.0f * sx), 104.0f * sx, maxW);
        visibleWidth[slot] = bubbleW;
        if (bubbleW > laneW) laneW = bubbleW;
    }

    if (laneW < 300.0f * sx) laneW = 300.0f * sx;
    if (laneW > maxW) laneW = maxW;

    drawY = y;
    for (slot = 0u; slot < visibleCount; ++slot) {
        float bw = visibleWidth[slot];
        if (bw <= 0.0f) continue;
        // Visual "HTML/glass": sombra curta, borda discreta e cartao interno.
        // Sao camadas DirectX, sem CEF, mas com a mesma leitura visual de um card web.
        hype_draw_round_rect(x + (1.0f * sx), drawY + (2.0f * sy), bw, rowH, radius,
                             0, 0, 0, 72u);
        hype_draw_round_rect(x, drawY, bw, rowH, radius,
                             44, 58, 75, 150u);
        hype_draw_round_rect(x + (1.0f * sx), drawY + (1.0f * sy),
                             bw - (2.0f * sx), rowH - (2.0f * sy),
                             radius - 1.0f, 9, 15, 24, 225u);
        // acento azul bem fino, como detalhe de UI moderna.
        hype_draw_round_rect(x + (5.0f * sx), drawY + (rowH * 0.30f),
                             2.0f * sx, rowH * 0.40f, 1.5f,
                             0, 174, 255, 235u);
        drawY += rowH + gap;
    }

    // Scrollbar do NOVO chat no lado esquerdo, como pedido.
    // Continua independente da barra nativa do SA-MP.
    g_scrollTrackW = clamp_float(3.0f * sx, 2.0f, 4.0f);
    g_scrollTrackX = x - (10.0f * sx);
    g_scrollTrackY = y;
    g_scrollTrackH = ((float)rows * (rowH + gap)) - gap;
    if (count > rows) {
        float travel;
        float ratio;
        float thumbH = g_scrollTrackH * ((float)rows / (float)count);
        if (thumbH < 22.0f * sy) thumbH = 22.0f * sy;
        if (thumbH > g_scrollTrackH) thumbH = g_scrollTrackH;
        travel = g_scrollTrackH - thumbH;
        ratio = maxScroll ? ((float)g_historyScroll / (float)maxScroll) : 0.0f;
        g_scrollThumbH = thumbH;
        g_scrollThumbY = g_scrollTrackY + travel * (1.0f - ratio);
        hype_draw_round_rect(g_scrollTrackX, g_scrollTrackY, g_scrollTrackW,
                             g_scrollTrackH, 2.0f, 90, 105, 125,
                             inputEnabled ? 55u : 28u);
        hype_draw_round_rect(g_scrollTrackX, g_scrollThumbY, g_scrollTrackW,
                             g_scrollThumbH, 2.0f, 0, 174, 255,
                             inputEnabled ? 235u : 155u);
    } else {
        g_scrollThumbY = 0.0f;
        g_scrollThumbH = 0.0f;
    }

    // Input moderno. Ele nao depende visualmente do EditBox original.
    if (inputEnabled) {
        float inputY = drawY + (visibleCount ? (3.0f * sy) : 0.0f);
        float inputH = clamp_float(31.0f * sy, 29.0f, 37.0f * sy);
        hype_draw_round_rect(x + (1.0f * sx), inputY + (2.0f * sy), laneW, inputH, radius,
                             0, 0, 0, 82u);
        hype_draw_round_rect(x, inputY, laneW, inputH, radius,
                             48, 64, 82, 165u);
        hype_draw_round_rect(x + (1.0f * sx), inputY + (1.0f * sy),
                             laneW - (2.0f * sx), inputH - (2.0f * sy), radius - 1.0f,
                             7, 13, 22, 238u);
        hype_draw_round_rect(x + (5.0f * sx), inputY + (inputH * 0.29f),
                             2.0f * sx, inputH * 0.42f, 1.5f,
                             0, 174, 255, 255u);
    }

    if (hype_sprite_begin(sprite)) {
        if (g_modernFont && g_modernTextSupersampled)
            hype_sprite_set_scale(sprite, 1.0f / HYPE_TEXT_SS);
        drawY = y;
        for (slot = 0u; slot < visibleCount; ++slot) {
            HYPE_HISTORY_ENTRY* e = visible[slot];
            float tx;
            float ty;
            float right;
            float bottom;
            if (!e) continue;
            tx = x + textPadX;
            ty = drawY + textYInset;
            right = x + visibleWidth[slot] - (10.0f * sx);
            bottom = drawY + rowH;

            if (e->prefix[0]) {
                tx = hype_modern_draw_colored(fallbackFonts, sprite, e->prefix,
                                              tx, ty, right, bottom,
                                              e->prefixColor, 255u);
                if (e->text[0]) tx += 6.0f * sx;
            }
            if (e->text[0]) {
                hype_modern_draw_colored(fallbackFonts, sprite, e->text,
                                         tx, ty, right, bottom,
                                         e->textColor, 255u);
            }
            drawY += rowH + gap;
        }

        if (inputEnabled) {
            const char* liveText = hype_get_live_input(input);
            float inputY = drawY + (visibleCount ? (3.0f * sy) : 0.0f);
            float inputH = clamp_float(31.0f * sy, 29.0f, 37.0f * sy);
            float textY = inputY + clamp_float((inputH - (float)(g_modernFontHeight ? g_modernFontHeight : 16)) * 0.5f - 1.0f,
                                               5.0f * sy, 10.0f * sy);
            float textX = x + textPadX;
            float right = x + laneW - (12.0f * sx);
            float cursorX;
            DWORD now = g_getTickCount ? g_getTickCount() : 0u;

            textX = hype_modern_draw_plain(fallbackFonts, sprite, ">", textX, textY, right,
                                           inputY + inputH, 0xFF00AAFFu, 255u);
            textX += 7.0f * sx;

            if (liveText && liveText[0]) {
                cursorX = hype_modern_draw_colored(fallbackFonts, sprite, liveText,
                                                   textX, textY, right, inputY + inputH,
                                                   0xFFFFFFFFu, 255u);
            } else {
                hype_modern_draw_plain(fallbackFonts, sprite, "Digite uma mensagem...",
                                       textX, textY, right, inputY + inputH,
                                       0xFF8491A3u, 210u);
                cursorX = textX;
            }

            if (((now / 500u) & 1u) == 0u && cursorX + (5.0f * sx) < right) {
                hype_modern_draw_plain(fallbackFonts, sprite, "|", cursorX + (2.0f * sx), textY,
                                       right, inputY + inputH, 0xFF00AAFFu, 255u);
            }
        }
        if (g_modernFont && g_modernTextSupersampled)
            hype_sprite_set_scale(sprite, 1.0f);
        hype_sprite_end(sprite);
    }
}

static BOOL ascii_buffer_contains(const char* buffer, unsigned int bufferLen, const char* needle) {
    unsigned int needleLen = 0;
    unsigned int i;
    if (!buffer || !needle || !*needle) return FALSE;
    while (needle[needleLen]) ++needleLen;
    if (needleLen > bufferLen) return FALSE;

    for (i = 0; i + needleLen <= bufferLen; ++i) {
        unsigned int j;
        if (!buffer[i]) return FALSE;
        for (j = 0; j < needleLen; ++j) {
            if (!buffer[i + j] || buffer[i + j] != needle[j]) break;
        }
        if (j == needleLen) return TRUE;
    }
    return FALSE;
}

static void clear_hud_sync_entry(BYTE* entry) {
    if (!entry) return;
    entry[4] = 0; // prefix
    entry[HYPE_CHAT_ENTRY_TEXT_OFFSET] = 0;
    *(volatile DWORD*)(entry + HYPE_CHAT_ENTRY_TYPE_OFFSET) = 0u;
    *(volatile DWORD*)(entry + HYPE_CHAT_ENTRY_TYPE_OFFSET + 4u) = 0u;
    *(volatile DWORD*)(entry + HYPE_CHAT_ENTRY_TYPE_OFFSET + 8u) = 0u;
}

static void sync_hud_state_from_chat(BYTE* chat) {
    unsigned int i;
    BOOL sawLock = FALSE;
    BOOL sawReady = FALSE;
    if (!chat) return;

    for (i = 0; i < HYPE_CHAT_ENTRY_COUNT; ++i) {
        BYTE* entry = chat + HYPE_CHAT_ENTRY_BASE + (i * HYPE_CHAT_ENTRY_SIZE);
        char* text = (char*)(entry + HYPE_CHAT_ENTRY_TEXT_OFFSET);

        if (ascii_buffer_contains(text, HYPE_CHAT_ENTRY_TEXT_MAX, HYPE_HUD_LOCK_MARKER)) {
            sawLock = TRUE;
            clear_hud_sync_entry(entry);
            continue;
        }
        if (ascii_buffer_contains(text, HYPE_CHAT_ENTRY_TEXT_MAX, HYPE_HUD_READY_MARKER)) {
            sawReady = TRUE;
            clear_hud_sync_entry(entry);
        }
    }

    // Se por algum motivo os dois sinais forem vistos no mesmo ciclo, READY vence:
    // ele sempre representa o estado mais avancado do mesmo processo de login.
    if (sawLock) g_hudReady = FALSE;
    if (sawReady) g_hudReady = TRUE;
}

static void __cdecl hype_hud_draw_guard(void) {
    // Antes do sinal READY da GM, escondemos de forma deterministica HUD e radar.
    // Depois do READY, voltamos a forcar os dois ligados no instante exato do
    // desenho, evitando o pisca-pisca causado por mods que disputam essas flags.
    if (!g_hudReady) {
        *(volatile BYTE*)0x00BA6769 = 0u; // FrontEndMenuManager.m_bHudOn
        *(volatile BYTE*)0x00BAA45D = 0u; // CHud::m_Wants_To_Draw_Hud
        *(volatile BYTE*)0x00BAA3FB = 1u; // CHud::bScriptDontDisplayRadar
    } else {
        *(volatile BYTE*)0x00BA6769 = 1u;
        *(volatile BYTE*)0x00BAA45D = 1u;
        *(volatile BYTE*)0x00BAA3FB = 0u;
    }

    // V14: Enter conclui o input local no thread de render e adiciona ao historico persistente.
    if (g_submitRequested && g_sampBase) {
        BYTE* input = *(BYTE**)(g_sampBase + 0x21A0E8u);
        g_submitRequested = FALSE;
        if (input) hype_submit_custom_input(input);
    }

    ((PFN_CHudDraw)0x0058FAE0)();

    // Chat moderno depois do HUD. O CChat nativo fica em OFF no worker, entao
    // esta camada desenha tanto o painel quanto as mensagens e o input.
    hype_draw_modern_chat();
}

static BOOL patch_hud_draw_calls(void) {
    BYTE* gta = (BYTE*)find_module_ascii("gta_sa.exe");
    BYTE* nt;
    BYTE* sections;
    WORD sectionCount;
    WORD optSize;
    DWORD patched = 0;

    if (!gta || !g_virtualProtect || *(WORD*)gta != 0x5A4D) return FALSE;
    nt = gta + *(DWORD*)(gta + 0x3C);
    if (*(DWORD*)nt != 0x00004550) return FALSE;

    sectionCount = *(WORD*)(nt + 0x06);
    optSize = *(WORD*)(nt + 0x14);
    sections = nt + 0x18 + optSize;

    for (WORD si = 0; si < sectionCount; ++si) {
        BYTE* sh = sections + ((DWORD)si * 40u);
        DWORD virtualSize = *(DWORD*)(sh + 0x08);
        DWORD virtualAddress = *(DWORD*)(sh + 0x0C);
        DWORD rawSize = *(DWORD*)(sh + 0x10);
        DWORD characteristics = *(DWORD*)(sh + 0x24);
        DWORD span = virtualSize > rawSize ? virtualSize : rawSize;
        BYTE* begin;

        if (!(characteristics & 0x20000000u) || span < 5u) continue; // IMAGE_SCN_MEM_EXECUTE
        begin = gta + virtualAddress;

        for (DWORD i = 0; i + 5u <= span; ++i) {
            BYTE* call = begin + i;
            if (call[0] != 0xE8) continue;

            {
                long oldRel = *(long*)(call + 1);
                BYTE* oldTarget = call + 5 + oldRel;
                BYTE* expected = gta + (0x0058FAE0u - 0x00400000u);
                if (oldTarget == expected) {
                    long newRel = (long)((BYTE*)&hype_hud_draw_guard - (call + 5));
                    DWORD oldProtect = 0, ignored = 0;
                    if (g_virtualProtect(call + 1, 4, PAGE_EXECUTE_READWRITE, &oldProtect)) {
                        *(long*)(call + 1) = newRel;
                        g_virtualProtect(call + 1, 4, oldProtect, &ignored);
                        ++patched;
                    }
                }
            }
        }
    }

    return patched > 0u;
}


// ---------------------------------------------------------------------------
// V11 - a scrollbar nativa fica invisivel, mas o EditBox permanece
// logicamente visivel/ativo para o proprio SA-MP. Em vez de Visible=false,
// deslocamos o controle para fora da tela. Isso preserva GetText/ProcessInput
// e elimina qualquer dependencia do DXUT para desenhar o campo antigo.
// ---------------------------------------------------------------------------
typedef void (__thiscall *PFN_DXUTControlSetBool)(PVOID, BOOL);
typedef void (__thiscall *PFN_DXUTControlUpdateRects)(PVOID);

static void hype_set_control_visible(PVOID control, BOOL visible) {
    PVOID* vtable;
    PFN_DXUTControlSetBool setVisible;
    if (!control) return;
    vtable = *(PVOID**)control;
    if (!vtable || !vtable[0x38u / sizeof(PVOID)]) return;
    setVisible = (PFN_DXUTControlSetBool)vtable[0x38u / sizeof(PVOID)];
    setVisible(control, visible);
}

static void hype_hide_native_chat_controls(BYTE* chat, BYTE* input) {
    if (chat) {
        BYTE* scrollbar = *(BYTE**)(chat + HYPE_CHAT_SCROLLBAR_OFFSET);
        if (scrollbar) {
            // CDXUTControl R1: bool m_bVisible fica imediatamente depois do vptr.
            // A versao antiga tentava chamar um indice de vtable incorreto, por isso
            // a barra nativa conseguia reaparecer. Agora zeramos a flag real e ainda
            // jogamos o controle para fora da tela como segunda camada de seguranca.
            *(volatile BYTE*)(scrollbar + 0x04u) = 0u;
            *(volatile long*)(scrollbar + 0x08u) = -16000;
            *(volatile long*)(scrollbar + 0x0Cu) = -16000;
        }
    }

    if (input && *(volatile DWORD*)(input + 0x14E0u)) {
        BYTE* editBox = *(BYTE**)(input + 0x08u);
        if (editBox) {
            // O teclado agora e capturado pelo nosso hook antes do DXUT, entao o
            // EditBox original pode ficar REALMENTE invisivel sem perder digitacao.
            *(volatile BYTE*)(editBox + 0x04u) = 0u;
            *(volatile long*)(editBox + 0x08u) = -16000;
            *(volatile long*)(editBox + 0x0Cu) = -16000;
        }
    }
}

static void __fastcall hype_chat_reset_controls_hook(PVOID self, PVOID ignoredEdx, PVOID gameUi) {
    (void)ignoredEdx;
    if (g_chatResetOriginal) g_chatResetOriginal(self, gameUi);
    // O SA-MP acabou de recriar a scrollbar: escondemos antes do proximo frame.
    hype_hide_native_chat_controls((BYTE*)self, 0);
}

static BOOL install_chat_reset_controls_hook(BYTE* samp) {
    BYTE* target;
    DWORD oldProtect = 0u, ignored = 0u;
    long relBack, relHook;
    unsigned int i;

    if (!samp || !g_virtualProtect) return FALSE;
    if (g_chatResetOriginal) return TRUE;
    target = samp + 0x63CD0u; // CChat::ResetDialogControls R1

    // mov eax, fs:[0] = 64 A1 00 00 00 00 (6 bytes)
    if (!(target[0] == 0x64u && target[1] == 0xA1u &&
          target[2] == 0x00u && target[3] == 0x00u &&
          target[4] == 0x00u && target[5] == 0x00u)) return FALSE;

    for (i = 0u; i < 6u; ++i) g_chatResetTrampoline[i] = target[i];
    g_chatResetTrampoline[6] = 0xE9u;
    relBack = (long)((target + 6u) - (g_chatResetTrampoline + 11u));
    *(long*)(g_chatResetTrampoline + 7u) = relBack;

    if (!g_virtualProtect(g_chatResetTrampoline, sizeof(g_chatResetTrampoline),
                          PAGE_EXECUTE_READWRITE, &oldProtect)) return FALSE;
    g_chatResetOriginal = (PFN_CChatResetControls)g_chatResetTrampoline;

    if (!g_virtualProtect(target, 6u, PAGE_EXECUTE_READWRITE, &oldProtect)) {
        g_chatResetOriginal = 0;
        return FALSE;
    }
    target[0] = 0xE9u;
    relHook = (long)((BYTE*)&hype_chat_reset_controls_hook - (target + 5u));
    *(long*)(target + 1u) = relHook;
    target[5] = 0x90u;
    g_virtualProtect(target, 6u, oldProtect, &ignored);
    return TRUE;
}

static void hype_clear_custom_input(PVOID input) {
    BYTE* editBox;
    PFN_EditBoxSetText setText;
    g_customInputLen = 0u;
    g_customInput[0] = 0;
    if (!g_sampBase || !input) return;
    editBox = *(BYTE**)((BYTE*)input + 0x08u);
    if (!editBox) return;
    setText = (PFN_EditBoxSetText)(g_sampBase + 0x80F60u);
    setText(editBox, "", FALSE);
}

static void hype_sync_custom_input_to_editbox(PVOID input) {
    BYTE* editBox;
    PFN_EditBoxSetText setText;
    if (!g_sampBase || !input) return;
    editBox = *(BYTE**)((BYTE*)input + 0x08u);
    if (!editBox) return;
    setText = (PFN_EditBoxSetText)(g_sampBase + 0x80F60u);
    setText(editBox, g_customInput, FALSE);
}

// V14: finalizacao local do input. O visual/historico ja e definitivo;
// a ponte de rede/GM sera ligada depois sem tocar novamente no renderer.
static void hype_submit_custom_input(PVOID input) {
    BYTE* in = (BYTE*)input;
    PFN_CInputClose closeInput;
    BYTE* editBox;
    PFN_EditBoxSetText setText;

    if (!g_sampBase || !in) return;
    if (!*(volatile DWORD*)(in + 0x14E0u)) return;

    if (g_customInputLen > 0u) {
        // Eco local entra no MESMO historico das mensagens recebidas.
        hype_history_push(4, g_customInput, "", 0xFFFFFFFFu, 0xFF00AAFFu);
        g_historyScroll = 0u;
    }

    editBox = *(BYTE**)(in + 0x08u);
    if (editBox) {
        setText = (PFN_EditBoxSetText)(g_sampBase + 0x80F60u);
        setText(editBox, "", FALSE);
    }

    closeInput = (PFN_CInputClose)(g_sampBase + 0x658E0u);
    closeInput(input);

    g_customInputLen = 0u;
    g_customInput[0] = 0;
    g_scrollDragging = FALSE;
}

static void hype_scroll_from_mouse_y(int mouseY) {
    unsigned int maxScroll = hype_history_max_scroll();
    float travel;
    float pos;
    float ratio;
    if (!maxScroll || g_scrollTrackH <= 0.0f || g_scrollThumbH <= 0.0f) return;
    travel = g_scrollTrackH - g_scrollThumbH;
    if (travel <= 0.0f) { g_historyScroll = 0u; return; }
    pos = (float)mouseY - g_scrollTrackY - (g_scrollThumbH * 0.5f);
    if (pos < 0.0f) pos = 0.0f;
    if (pos > travel) pos = travel;
    // topo = mensagens mais antigas; fundo = mensagens novas.
    ratio = 1.0f - (pos / travel);
    if (ratio < 0.0f) ratio = 0.0f;
    if (ratio > 1.0f) ratio = 1.0f;
    g_historyScroll = (unsigned int)(ratio * (float)maxScroll + 0.5f);
    hype_history_clamp_scroll();
}

// CInput::MsgProc vira somente a fonte de teclado/mouse para o NOVO chat.
// O EditBox nativo continua fora da tela e nunca e usado visualmente.
static int __fastcall hype_input_msg_hook(PVOID self, PVOID ignoredEdx,
                                          int uMsg, int wParam, int lParam) {
    BYTE* in = (BYTE*)self;
    (void)ignoredEdx;

    if (in && *(volatile DWORD*)(in + 0x14E0u)) {
        if (uMsg == HYPE_WM_CHAR) {
            unsigned int ch = (unsigned int)wParam & 0xFFFFu;

            if (ch == HYPE_VK_RETURN) {
                g_submitRequested = TRUE;
                return 1;
            }

            if (ch == HYPE_VK_BACK) {
                if (g_customInputLen > 0u) {
                    --g_customInputLen;
                    g_customInput[g_customInputLen] = 0;
                    hype_sync_custom_input_to_editbox(self);
                }
                return 1;
            }

            if (ch >= 32u && ch != 127u && g_customInputLen < 128u) {
                g_customInput[g_customInputLen++] = (char)(ch & 0xFFu);
                g_customInput[g_customInputLen] = 0;
                hype_sync_custom_input_to_editbox(self);
                return 1;
            }
            return 1;
        }

        if (uMsg == HYPE_WM_KEYDOWN) {
            if (wParam == HYPE_VK_RETURN) {
                g_submitRequested = TRUE;
                return 1;
            }
            if (wParam == HYPE_VK_PRIOR) {
                hype_history_scroll_by((int)HYPE_HISTORY_VIEW_ROWS - 1);
                return 1;
            }
            if (wParam == HYPE_VK_NEXT) {
                hype_history_scroll_by(-((int)HYPE_HISTORY_VIEW_ROWS - 1));
                return 1;
            }
            if (wParam == HYPE_VK_HOME) {
                g_historyScroll = hype_history_max_scroll();
                return 1;
            }
            if (wParam == HYPE_VK_END) {
                g_historyScroll = 0u;
                return 1;
            }
            if (wParam == HYPE_VK_ESCAPE) {
                if (g_sampBase) {
                    PFN_CInputClose closeInput =
                        (PFN_CInputClose)(g_sampBase + 0x658E0u);
                    closeInput(self);
                }
                g_customInputLen = 0u;
                g_customInput[0] = 0;
                g_historyScroll = 0u;
                g_scrollDragging = FALSE;
                return 1;
            }
        }

        if (uMsg == HYPE_WM_MOUSEWHEEL) {
            short delta = (short)(((unsigned int)wParam >> 16) & 0xFFFFu);
            if (delta > 0) hype_history_scroll_by(3);
            else if (delta < 0) hype_history_scroll_by(-3);
            return 1;
        }

        if (uMsg == HYPE_WM_LBUTTONDOWN) {
            int mx = (short)((unsigned int)lParam & 0xFFFFu);
            int my = (short)(((unsigned int)lParam >> 16) & 0xFFFFu);
            float hitPad = 8.0f;
            if (g_historyCount > HYPE_HISTORY_VIEW_ROWS &&
                (float)mx >= g_scrollTrackX - hitPad &&
                (float)mx <= g_scrollTrackX + g_scrollTrackW + hitPad &&
                (float)my >= g_scrollTrackY &&
                (float)my <= g_scrollTrackY + g_scrollTrackH) {
                g_scrollDragging = TRUE;
                hype_scroll_from_mouse_y(my);
                return 1;
            }
        }

        if (uMsg == HYPE_WM_MOUSEMOVE && g_scrollDragging) {
            int my = (short)(((unsigned int)lParam >> 16) & 0xFFFFu);
            hype_scroll_from_mouse_y(my);
            return 1;
        }

        if (uMsg == HYPE_WM_LBUTTONUP && g_scrollDragging) {
            g_scrollDragging = FALSE;
            return 1;
        }
    }

    if (g_inputMsgOriginal) return g_inputMsgOriginal(self, uMsg, wParam, lParam);
    return 0;
}

static BOOL install_input_msg_hook(BYTE* samp) {
    BYTE* target;
    DWORD oldProtect = 0, ignored = 0;
    long relBack, relHook;
    unsigned int i;

    if (!samp || !g_virtualProtect) return FALSE;
    if (g_inputMsgOriginal) return TRUE;

    target = samp + 0x65B30u; // CInput::MsgProc R1

    // mov eax,[ecx+14E0] = 6 bytes inteiros.
    if (!(target[0] == 0x8Bu && target[1] == 0x81u &&
          target[2] == 0xE0u && target[3] == 0x14u &&
          target[4] == 0x00u && target[5] == 0x00u)) return FALSE;

    for (i = 0u; i < 6u; ++i) g_inputMsgTrampoline[i] = target[i];
    g_inputMsgTrampoline[6] = 0xE9u;
    relBack = (long)((target + 6u) - (g_inputMsgTrampoline + 11u));
    *(long*)(g_inputMsgTrampoline + 7u) = relBack;

    if (!g_virtualProtect(g_inputMsgTrampoline, sizeof(g_inputMsgTrampoline),
                          PAGE_EXECUTE_READWRITE, &oldProtect)) return FALSE;
    g_inputMsgOriginal = (PFN_CInputMsgProc)g_inputMsgTrampoline;

    if (!g_virtualProtect(target, 6u, PAGE_EXECUTE_READWRITE, &oldProtect)) {
        g_inputMsgOriginal = 0;
        return FALSE;
    }
    target[0] = 0xE9u;
    relHook = (long)((BYTE*)&hype_input_msg_hook - (target + 5u));
    *(long*)(target + 1u) = relHook;
    target[5] = 0x90u;
    g_virtualProtect(target, 6u, oldProtect, &ignored);
    return TRUE;
}

// Intercepta CChat::AddEntry (0.3.7-R1) e copia cada mensagem para o
// historico persistente ANTES de o SA-MP deslocar/limitar seus 100 slots.
static BOOL install_chat_add_hook(BYTE* samp) {
    BYTE* target;
    DWORD oldProtect = 0u, ignored = 0u;
    long relBack, relHook;
    unsigned int i;

    if (!samp || !g_virtualProtect) return FALSE;
    if (g_chatAddOriginal) return TRUE;
    target = samp + 0x64010u;

    // 55 56 8B E9 57 = push ebp / push esi / mov ebp,ecx / push edi
    if (!(target[0] == 0x55u && target[1] == 0x56u &&
          target[2] == 0x8Bu && target[3] == 0xE9u && target[4] == 0x57u))
        return FALSE;

    for (i = 0u; i < 5u; ++i) g_chatAddTrampoline[i] = target[i];
    g_chatAddTrampoline[5] = 0xE9u;
    relBack = (long)((target + 5u) - (g_chatAddTrampoline + 10u));
    *(long*)(g_chatAddTrampoline + 6u) = relBack;

    if (!g_virtualProtect(g_chatAddTrampoline, sizeof(g_chatAddTrampoline),
                          PAGE_EXECUTE_READWRITE, &oldProtect)) return FALSE;
    g_chatAddOriginal = (PFN_CChatAddEntry)g_chatAddTrampoline;

    if (!g_virtualProtect(target, 5u, PAGE_EXECUTE_READWRITE, &oldProtect)) {
        g_chatAddOriginal = 0;
        return FALSE;
    }
    target[0] = 0xE9u;
    relHook = (long)((BYTE*)&hype_chat_add_hook - (target + 5u));
    *(long*)(target + 1u) = relHook;
    g_virtualProtect(target, 5u, oldProtect, &ignored);
    return TRUE;
}

// Atualiza o WindowBottom antes de CInput::Open. Assim, mesmo antes de o
// controle nativo ser escondido, ele ja nasce no mesmo bloco vertical do chat
// moderno em vez de aparecer por um frame la em cima e depois pular.
static void hype_update_native_input_anchor(BYTE* chat) {
    int screenHeight;
    float sy;
    DWORD pageSize;
    DWORD charHeight;
    float rowH;
    float gap;
    DWORD modernBottom;
    volatile DWORD* chatBottom;

    if (!chat) return;
    screenHeight = *(volatile int*)0x00C17048;
    if (screenHeight < 480 || screenHeight > 4320) return;

    sy = (float)screenHeight / 768.0f;
    pageSize = clamp_u32(*(volatile DWORD*)(chat + 0x00u), 5u, 20u);
    charHeight = *(volatile DWORD*)(chat + HYPE_CHAT_CHAR_HEIGHT_OFFSET);
    if (charHeight < 10u || charHeight > 40u) charHeight = (DWORD)(16.0f * sy);

    rowH = clamp_float((float)charHeight + (9.0f * sy), 25.0f * sy, 34.0f * sy);
    gap = clamp_float(4.0f * sy, 3.0f, 7.0f * sy);
    modernBottom = (DWORD)((16.0f * sy) + ((float)pageSize * (rowH + gap)) + (5.0f * sy));
    if (modernBottom < 40u) modernBottom = 40u;
    if (modernBottom >= (DWORD)screenHeight) modernBottom = (DWORD)(screenHeight - 40);

    chatBottom = (volatile DWORD*)(chat + 0x12Eu);
    *chatBottom = modernBottom;
}

// Interceptamos CInput::Open para limpar o nosso buffer e esconder o editbox
// nativo na mesma chamada, antes de o frame seguinte ser apresentado.
static void __fastcall hype_input_open_hook(PVOID self, PVOID ignoredEdx) {
    BYTE* chat = 0;
    (void)ignoredEdx;

    if (g_sampBase) chat = *(BYTE**)(g_sampBase + 0x21A0E4u);
    hype_update_native_input_anchor(chat);

    if (g_getTickCount) g_inputOpenTick = g_getTickCount();
    if (g_inputOpenOriginal) g_inputOpenOriginal(self);

    // Toda abertura começa no fim/mais recente. A partir dai o jogador sobe
    // pelo mouse wheel, PageUp/PageDown ou arrastando a barra moderna.
    g_historyScroll = 0u;
    g_scrollDragging = FALSE;
    hype_clear_custom_input(self);
    hype_hide_native_chat_controls(chat, (BYTE*)self);
}

static BOOL install_input_open_hook(BYTE* samp) {
    BYTE* target;
    DWORD oldProtect = 0;
    DWORD ignored = 0;
    long relBack;
    long relHook;
    unsigned int i;

    if (!samp || !g_virtualProtect) return FALSE;
    if (g_inputOpenOriginal) return TRUE;

    target = samp + 0x657E0u; // CInput::Open R1

    // 83 EC 10 | 56 | 8B F1 = sub esp,10 / push esi / mov esi,ecx.
    // Sao 6 bytes inteiros, entao e seguro usa-los no trampoline.
    if (!(target[0] == 0x83u && target[1] == 0xECu && target[2] == 0x10u &&
          target[3] == 0x56u && target[4] == 0x8Bu && target[5] == 0xF1u)) {
        return FALSE;
    }

    for (i = 0u; i < 6u; ++i) g_inputOpenTrampoline[i] = target[i];
    g_inputOpenTrampoline[6] = 0xE9u;
    relBack = (long)((target + 6u) - (g_inputOpenTrampoline + 11u));
    *(long*)(g_inputOpenTrampoline + 7u) = relBack;

    // O trampoline precisa continuar executavel durante toda a sessao.
    if (!g_virtualProtect(g_inputOpenTrampoline, sizeof(g_inputOpenTrampoline),
                          PAGE_EXECUTE_READWRITE, &oldProtect)) return FALSE;
    g_inputOpenOriginal = (PFN_CInputOpen)g_inputOpenTrampoline;

    if (!g_virtualProtect(target, 6u, PAGE_EXECUTE_READWRITE, &oldProtect)) {
        g_inputOpenOriginal = 0;
        return FALSE;
    }
    target[0] = 0xE9u;
    relHook = (long)((BYTE*)&hype_input_open_hook - (target + 5u));
    *(long*)(target + 1u) = relHook;
    target[5] = 0x90u;
    g_virtualProtect(target, 6u, oldProtect, &ignored);
    return TRUE;
}

static DWORD __stdcall worker(PVOID unused) {
    (void)unused;
    if (!is_hype_launch()) return 0; // Em qualquer outro servidor: completamente passivo.

    BYTE* samp = 0;
    while (g_running && !samp) {
        samp = (BYTE*)find_module_ascii("samp.dll");
        if (!samp && g_sleep) g_sleep(100);
    }
    if (!g_running || !samp || !verify_samp_r1(samp)) return 0;
    g_sampBase = samp;
    g_hudReady = FALSE;

    // Bloqueio real do F7 no dispatcher nativo do SA-MP. O chat continua sendo
    // controlado apenas pelo estado do input (T/F6 abre, Enter/Esc fecha).
    block_f7_native(samp);

    // V14: captura CChat::AddEntry para o nosso historico antes de desligar
    // completamente a camada visual do chat original.
    {
        BYTE* initialChat = *(BYTE**)(samp + 0x21A0E4u);
        if (initialChat) hype_seed_history_from_chat(initialChat);
    }
    install_chat_add_hook(samp);

    // Proibicao visual do chat principal: Draw, Render e RenderToSurface ficam
    // permanentemente em RET. O buffer/RPC continua vivo so como fonte de dados.
    disable_native_chat_draw(samp);
    install_chat_reset_controls_hook(samp);

    // Intercepta a abertura do input; o EditBox nativo fica invisivel e fora da tela.
    // reposiciona-lo fora da tela ainda na mesma chamada, sem flash visual.
    install_input_open_hook(samp);

    // V14: CInput::MsgProc fornece teclado + mouse ao nosso chat.
    // Texto, historico e scroll sao totalmente nossos; a rede entra na proxima etapa.
    install_input_msg_hook(samp);

    // HUD/radar: em vez de ficar gravando flags a cada 5 ms, interceptamos as
    // chamadas para CHud::Draw e restauramos o estado no instante do desenho.
    // Assim o GFixer nao consegue criar a alternancia visivel entre frames.
    patch_hud_draw_calls();

    volatile PVOID* chatRef = (volatile PVOID*)(samp + 0x21A0E4);
    volatile PVOID* inputRef = (volatile PVOID*)(samp + 0x21A0E8);

    while (g_running) {
        BYTE* chat = (BYTE*)(*chatRef);
        // A GM e a unica fonte de verdade para o estado do login.
        // LOCK chega quando a tela de login inicia; READY chega somente no fim
        // de HCRP_EndLoginFreeze. Nao existe mais contador local de segundos.
        sync_hud_state_from_chat(chat);
        if (chat && g_historyCount == 0u) hype_seed_history_from_chat(chat);
        BYTE* input = (BYTE*)(*inputRef);
        if (chat && input) {
            volatile DWORD* chatMode = (volatile DWORD*)(chat + 0x08u);

            // O buffer continua ativo, mas o modo visual nativo permanece OFF.
            if (*chatMode != 0u) *chatMode = 0u;

            // Fail-safe por frame: scrollbar some e o editbox fica fora da tela,
            // mas continua vivo/focado para o ProcessInput original.
            hype_update_native_input_anchor(chat);
            hype_hide_native_chat_controls(chat, input);

        }

        if (g_sleep) g_sleep(5);
    }
    return 0;
}

__declspec(dllexport) BOOL __stdcall DllMain(PVOID hinst, DWORD reason, PVOID reserved) {
    (void)hinst; (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {
        g_running = TRUE;
        PVOID k32 = find_module_ascii("kernel32.dll");
        if (!k32) return TRUE;
        PFN_CreateThread createThread = (PFN_CreateThread)resolve_export(k32, "CreateThread");
        g_sleep = (PFN_Sleep)resolve_export(k32, "Sleep");
        g_getTickCount = (PFN_GetTickCount)resolve_export(k32, "GetTickCount");
        g_virtualProtect = (PFN_VirtualProtect)resolve_export(k32, "VirtualProtect");
        {
            PVOID user32 = find_module_ascii("user32.dll");
            if (user32) g_getAsyncKeyState =
                (PFN_GetAsyncKeyState)resolve_export(user32, "GetAsyncKeyState");
        }
        if (createThread && g_sleep && g_virtualProtect) {
            createThread(0, 0, worker, 0, 0, 0);
        }
    } else if (reason == DLL_PROCESS_DETACH) {
        g_running = FALSE;
    }
    return TRUE;
}
