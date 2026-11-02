// main.js - Rustlox frontend

const _tauri = window.__TAURI__ || { core: { invoke: async () => null }, event: { listen: async () => ({ unlisten: () => {} }) } };
const { invoke } = _tauri.core;
const { listen } = _tauri.event;

// State
let currentView = "home";
let currentSort = null;
let currentGame = null; // GameCard open in the modal
let searchDebounce = null;
let statusTimer = null;
let cacheState = [];

const $id = (i) => document.getElementById(i);

// ============ helpers ============

function fmt(n) {
    if (n === undefined || n === null) return "--";
    const a = Math.abs(n);
    const d = (x) => (Math.round(x * 10) / 10).toString().replace(/\.0$/, "");
    const s = n < 0 ? "-" : "";
    if (a >= 1e9) return s + d(a / 1e9) + "B";
    if (a >= 1e6) return s + d(a / 1e6) + "M";
    if (a >= 1e3) return s + d(a / 1e3) + "K";
    return s + a;
}

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function note(msg, cls) {
    return el("div", cls || "empty-note", msg);
}

// ============ navigation ============

function switchView(name) {
    currentView = name;
    document.querySelectorAll(".nav-item").forEach((n) =>
        n.classList.toggle("active", n.dataset.view === name)
    );
    document.querySelectorAll(".view").forEach((v) =>
        v.classList.toggle("active", v.id === `view-${name}`)
    );
    if (name === "games" && !$id("sort-tabs").children.length) loadDiscover();
    if (name === "settings" && !cacheState.length) initCache(null);
}

function setupNav() {
    document.querySelectorAll(".nav-item").forEach((n) =>
        n.addEventListener("click", () => switchView(n.dataset.view))
    );
    document.querySelectorAll("[data-view].see-all").forEach((n) =>
        n.addEventListener("click", () => switchView(n.dataset.view))
    );
}

// ============ game cards ============

function gameCard(g) {
    const c = el("div", "game-card");
    c.innerHTML = `
        <div class="game-thumb-wrap">
            <img class="game-thumb" alt="" loading="lazy">
            ${g.playing > 0 ? `<div class="g-playing"><span class="g-live-dot"></span>${fmt(g.playing)}</div>` : ""}
        </div>
        <div class="game-meta">
            <div class="g-name"></div>
            <div class="g-creator"></div>
            <div class="g-foot"><span class="g-visits"></span><span class="g-like"></span></div>
        </div>`;
    c.querySelector(".g-name").textContent = g.name || "Untitled";
    c.querySelector(".g-creator").textContent = g.creator || "\u2713 verified creator";
    c.querySelector(".g-visits").textContent = fmt(g.visits) + " visits";
    c.querySelector(".g-like").textContent =
        (g.likes + g.dislikes > 0
            ? Math.round((g.likes / (g.likes + g.dislikes)) * 100) + "%"
            : "--") + " \u2665";
    const img = c.querySelector("img");
    if (g.thumbnail_url) {
        img.src = g.thumbnail_url;
    }
    c.addEventListener("click", () => openGame(g));
    return c;
}

function renderGrid(container, games) {
    container.innerHTML = "";
    if (!games.length) {
        container.appendChild(note("Nothing surfaced here yet - try another row."));
        return;
    }
    for (const g of games) container.appendChild(gameCard(g));
}

function skeleton(container, n) {
    container.innerHTML = "";
    for (let i = 0; i < (n || 8); i++) container.appendChild(el("div", "game-card loading-skeleton"));
}

// ============ home / dashboard ============

async function loadHome() {
    const trend = $id("home-trending");
    const now = $id("home-playing");
    skeleton(trend, 8);
    skeleton(now, 8);

    const dash = invoke("get_dashboard").catch(() => null);
    const trending = invoke("get_sort_games", { sortId: "top-trending" }).catch(() => null);
    const playing = invoke("get_sort_games", { sortId: "top-playing-now" }).catch(() => null);

    const [d, t, p] = await Promise.race([
        Promise.all([dash, trending, playing]),
        new Promise((r) => setTimeout(() => r([null, null, null]), 25000)),
    ]);

    if (t) renderGrid(trend, t.games); else failGrid(trend, "Top Trending failed to load - hit refresh.");
    if (p) renderGrid(now, p.games); else failGrid(now, "Playing Now failed to load - hit refresh.");

    const feat = $id("home-featured");
    if (feat && t && t.games && t.games.length) {
        const g = t.games[0];
        feat.classList.remove("hidden");
        feat.innerHTML = `
            <div class="feat-bg" style="background-image:url('${g.thumbnail_url || ""}')"></div>
            <div class="feat-scrim"></div>
            <div class="feat-body">
                <div class="feat-tag">Featured</div>
                <h2 class="feat-title"></h2>
                <div class="feat-meta"></div>
                <button class="feat-play">Play</button>
            </div>`;
        feat.querySelector(".feat-title").textContent = g.name || "Untitled";
        feat.querySelector(".feat-meta").textContent =
            (g.creator || "verified creator") + "  ·  " + fmt(g.playing) + " playing";
        const playBtn = feat.querySelector(".feat-play");
        playBtn.addEventListener("click", (e) => { e.stopPropagation(); openGame(g); });
        feat.addEventListener("click", () => openGame(g));
    } else if (feat) {
        feat.classList.add("hidden");
    }

    if (d) {
        $id("stat-players").textContent = d.live_players;
        $id("stat-players-sub").textContent = `across ${d.sorts_loaded} live rows`;
        $id("stat-topgame").textContent = d.largest_game || "--";
        $id("stat-topgame-sub").textContent =
            d.largest_players > 0 ? fmt(d.largest_players) + " in the crowd right now" : "waiting on the crowd";
        $id("stat-sorts").textContent = d.sorts_loaded;
        const pct = d.largest_players > 0
            ? Math.round((d.largest_players / parseCount(d.live_players)) * 100)
            : 0;
        $id("stat-ring-val").textContent = Math.min(pct, 100) + "%";
        const ring = $id("stat-ring");
        ring.style.strokeDashoffset = 251.2 * (1 - Math.min(pct, 100) / 100);
        ring.style.stroke = pct > 25 ? "#5eead4" : "#fbbf24";
    }
}

function parseCount(s) {
    const m = /^([\d.]+)([KMB]?)$/.exec(s || "");
    if (!m) return 0;
    const mult = { "": 1, K: 1e3, M: 1e6, B: 1e9 }[m[2]];
    return parseFloat(m[1]) * mult;
}

function failGrid(container, msg) {
    container.innerHTML = "";
    container.appendChild(note(msg, "error-note"));
}

// ============ discover ============

const SORT_OVERRIDE = [
    { id: "top-trending", display_name: "Top Trending" },
    { id: "top-playing-now", display_name: "Playing Now" },
    { id: "up-and-coming", display_name: "Up and Coming" },
];

async function loadDiscover() {
    const tabs = $id("sort-tabs");
    const grid = $id("games-grid");
    skeleton(grid, 11);
    tabs.innerHTML = "";

    const rows = (await invoke("get_sorts").catch(() => [])).concat(SORT_OVERRIDE);
    const seen = new Set();
    const tabsList = rows.filter((r) => r.id && !seen.has(r.id) && seen.add(r.id));

    for (const t of tabsList) {
        const b = el("button", "sort-tab", t.display_name || t.id);
        b.dataset.sort = t.id;
        b.addEventListener("click", () => selectSort(t.id, b));
        tabs.appendChild(b);
    }
    currentSort = null;
    selectSort(tabsList[0].id, tabs.firstElementChild);
}

async function selectSort(id, btn) {
    if (!id) return;
    currentSort = id;
    document.querySelectorAll(".sort-tab").forEach((b) => b.classList.toggle("active", b.dataset.sort === id));
    const grid = $id("games-grid");
    skeleton(grid, 11);
    try {
        const page = await invoke("get_sort_games", { sortId: id });
        renderGrid(grid, page.games);
    } catch (e) {
        failGrid(grid, "Category failed: " + e);
    }
}

// ============ search ============

function setupSearch() {
    const input = $id("search-input");
    const hints = ["obby", "anime", "horror", "simulator", "racing"];
    for (const h of hints) {
        const b = el("button", "sort-tab", h);
        b.addEventListener("click", () => {
            input.value = h;
            runSearch(h);
        });
        $id("search-hint-pills").appendChild(b);
    }

    input.addEventListener("input", () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            if (input.value.trim().length >= 2 && currentView !== "search") switchView("search");
            runSearch(input.value.trim());
        }, 450);
    });
}

async function runSearch(q) {
    if (!q) return;
    const grid = $id("search-grid");
    skeleton(grid, 9);
    try {
        const page = await invoke("search_games", { query: q });
        renderGrid(grid, page.games);
    } catch (e) {
        failGrid(grid, "Search failed: " + e);
    }
}

// ============ game modal ============

function setupModal() {
    $id("modal-close").addEventListener("click", closeModal);
    $id("game-modal").querySelector(".modal-backdrop").addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => e.key === "Escape" && closeModal());
    $id("play-btn").addEventListener("click", () => {
        if (currentGame) launchGame(currentGame);
    });
}

function openGame(g) {
    currentGame = g;
    $id("modal-thumbnail").src = g.thumbnail_url || "";
    $id("modal-title").textContent = g.name;
    $id("modal-creator").textContent = g.creator ? "by " + g.creator : "";
    $id("modal-description").textContent = g.description || "No description provided.";
    $id("modal-playing").textContent = fmt(g.playing);
    $id("modal-visits").textContent = fmt(g.visits);
    $id("modal-favorites").textContent = fmt(g.likes);
    const ratio = g.likes + g.dislikes > 0 ? Math.round((g.likes / (g.likes + g.dislikes)) * 100) + "%" : "--";
    $id("modal-ratio").textContent = ratio;
    $id("game-modal").classList.remove("hidden");
}

function closeModal() {
    $id("game-modal").classList.add("hidden");
}

// ============ embedded play ============

let lastLaunchedName = "";

function showOverlay(title, sub) {
    $id("launch-title").textContent = title;
    $id("launch-sub").textContent = sub;
    $id("launch-overlay").classList.remove("hidden");
}

function hideOverlay() {
    $id("launch-overlay").classList.add("hidden");
}

async function launchGame(g) {
    closeModal();
    lastLaunchedName = g.name;
    showOverlay("Rustloxing the crowd...", "minting a join ticket");
    $id("pb-name").textContent = "Connecting...";
    $id("pb-sub").textContent = "running inside Rustlox";
    $id("play-bar").classList.remove("hidden", "pb-dead");

    const r = await invoke("launch_game", { placeId: g.place_id, gameName: g.name }).catch((e) => ({
        ok: false, stage: "error", message: String(e),
    }));

    if (!r.ok) {
        hideOverlay();
        $id("play-bar").classList.add("pb-dead");
        $id("pb-name").textContent = r.stage === "auth" ? "Account not linkable" : "Launch failed";
        $id("pb-sub").textContent = r.message;
        $id("pb-undock").textContent = "Dismiss";
        return;
    }
    $id("pb-undock").textContent = "Pop Out";
    document.body.classList.add("playing");
    await invoke("set_layout", { sidebarPx: 224, topbarPx: 0 });
}

async function pollStatus() {
    try {
        const st = await invoke("game_status");
        if (st.embedded && st.alive) {
            $id("pb-dot").classList.add("live");
            $id("pb-name").textContent = st.name || "Playing";
            $id("pb-sub").textContent = `running inside Rustlox · pid ${st.pid}`;
        } else if (!st.embedded) {
            document.body.classList.remove("playing");
            await invoke("set_layout", { sidebarPx: 224, topbarPx: 56 });
        }
    } catch (e) { /* transient */ }
}

async function setupPlayEvents() {
    await listen("game-embedded", async () => {
        hideOverlay();
        $id("pb-dot").classList.add("live");
        $id("pb-name").textContent = "Player docked";
        $id("pb-sub").textContent = "running inside Rustlox";
        document.body.classList.add("playing");
        clearInterval(statusTimer);
        statusTimer = setInterval(pollStatus, 3000);
        if (lastLaunchedName) {
            invoke("connect_discord").then(() =>
                invoke("update_presence", {
                    info: {
                        state: "In a game",
                        details: "Rustlox · " + lastLaunchedName,
                        large_image: "https://cdn.roblox.com/",
                        large_text: lastLaunchedName,
                        small_image: null,
                        small_text: null,
                    },
                }).catch(() => {})
            ).catch(() => {});
        }
    });
    await listen("embed-failed", async (e) => {
        hideOverlay();
        $id("play-bar").classList.add("pb-dead");
        $id("pb-name").textContent = "Could not dock";
        $id("pb-sub").textContent = e.payload || "no Roblox window appeared";
    });

    $id("pb-undock").addEventListener("click", async () => {
        if ($id("play-bar").classList.contains("pb-dead")) {
            $id("play-bar").classList.add("hidden");
            return;
        }
        await invoke("detach_game").catch(() => {});
        $id("play-bar").classList.add("hidden");
        document.body.classList.remove("playing");
        await invoke("set_layout", { sidebarPx: 224, topbarPx: 56 });
        clearInterval(statusTimer);
    });
}

// ============ mods ============

async function loadMods() {
    const mods = await invoke("get_mods").catch(() => []);
    const grid = $id("mods-grid");
    grid.innerHTML = "";
    if (!mods.length) {
        grid.appendChild(note("No mods configured yet."));
        return;
    }
    for (const m of mods) {
        const card = el("div", "mod-card");
        card.innerHTML = `
            <div class="mod-head">
                <div><div class="mod-name"></div><div class="mod-cat"></div></div>
                <label class="switch"><input type="checkbox"><span class="knob"></span></label>
            </div>
            <div class="mod-desc"></div>
            <div class="mod-foot"><span class="mod-file"></span></div>`;
        card.querySelector(".mod-name").textContent = m.name;
        card.querySelector(".mod-cat").textContent = m.category;
        card.querySelector(".mod-desc").textContent = m.description;
        card.querySelector(".mod-file").textContent = m.file_path || "built-in";
        const sw = card.querySelector("input");
        sw.checked = !!m.enabled;
        sw.addEventListener("change", async () => {
            await invoke("toggle_mod", { modId: m.id, enabled: sw.checked });
        });
        grid.appendChild(card);
    }
}

$id("mod-add-file").addEventListener("click", async () => {
    const btn = $id("mod-add-file");
    btn.textContent = "Picking...";
    try {
        const dest = await invoke("pick_mod_file");
        if (dest && dest !== "cancelled") await loadMods();
        btn.textContent = "Mod added";
    } catch (e) {
        btn.textContent = e === "cancelled" ? "Add mod file..." : "Error: " + e;
        if (e === "cancelled") { /* silent */ } else {
            setTimeout(() => (btn.textContent = "Mod added"), 0);
        }
    }
    setTimeout(() => (btn.textContent = "Add mod file..."), 1800);
});

// ============ settings ============

function paintRange(input) {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty("--pct", pct + "%");
}

function setupSettings() {
    ["fps-cap", "graphics-quality"].forEach((id) => {
        const i = $id(id);
        i.addEventListener("input", () => {
            paintRange(i);
            $id(id + "-val").textContent = i.value;
        });
        paintRange(i);
    });

    $id("save-settings").addEventListener("click", saveSettings);
    $id("save-cookie").addEventListener("click", saveCookie);
    $id("clear-cookie").addEventListener("click", clearCookie);
    $id("connect-discord").addEventListener("click", async () => {
        $id("connect-discord").textContent = "Connecting...";
        const r = await invoke("connect_discord").catch((e) => String(e));
        $id("connect-discord").textContent = typeof r === "string" ? r : "Connected";
    });
    $id("apply-fflags").addEventListener("click", async () => {
        const btn = $id("apply-fflags");
        btn.disabled = true;
        btn.textContent = "Applying...";
        try {
            await invoke("save_fastflags", { flags: ffState });
            await invoke("apply_fastflags", { flags: ffState });
            btn.textContent = "Applied";
            setTimeout(() => (btn.textContent = "Apply FastFlags"), 2200);
        } catch (e) {
            btn.textContent = "Error: " + e;
            setTimeout(() => (btn.textContent = "Apply FastFlags"), 3000);
        }
        btn.disabled = false;
    });
}

async function loadSettings() {
    const s = await invoke("get_settings").catch(null || {});
    if (!s) return;
    $id("fps-cap").value = s.fps_cap || 0;
    $id("graphics-quality").value = s.graphics_quality ?? 5;
    const res = `${s.resolution_width}x${s.resolution_height}`;
    $id("resolution").value = [...$id("resolution").options].some((o) => o.value === res) ? res : "1920x1080";
    $id("fullscreen").checked = !!s.fullscreen;
    $id("vsync").checked = !!s.vsync;
    $id("discord-rpc").checked = !!s.discord_rpc;
    ["fps-cap", "graphics-quality"].forEach((id) => {
        paintRange($id(id));
        $id(id + "-val").textContent = $id(id).value;
    });
}

async function saveSettings() {
    const btn = $id("save-settings");
    const [resW, resH] = $id("resolution").value.split("x").map(Number);
    const s = {
        graphics_quality: +$id("graphics-quality").value,
        fps_cap: +$id("fps-cap").value,
        resolution_width: resW,
        resolution_height: resH,
        fullscreen: $id("fullscreen").checked,
        vsync: $id("vsync").checked,
        render_distance: 5,
        texture_quality: 5,
        shadow_quality: 3,
        lighting_quality: 3,
        ui_scale: 1.0,
        discord_rpc: $id("discord-rpc").checked,
        auto_update: true,
    };
    await invoke("save_settings", { settings: s }).catch((e) => note(String(e)));
    btn.textContent = "Saved";
    setTimeout(() => (btn.textContent = "Save Settings"), 1600);
}

// ============ fastflags ============

let ffState = [];

const PRESETS = {
    performance: [
        { name: "DFIntTaskSchedulerTargetFps", value: "240" },
        { name: "FFlagDebugGraphicsPreferD3D11", value: "True" },
        { name: "DFIntRuntimeConcurrency", value: "8" },
        { name: "FFlagEnableGraphicsAsyncCompute", value: "True" },
        { name: "FIntDebugForceMSAASamples", value: "0" },
        { name: "DFIntTextureQualityOverrideV2", value: "3" },
    ],
    quality: [
        { name: "FIntDebugForceMSAASamples", value: "4" },
        { name: "DFIntDebugFRMQualityLevelOverride", value: "21" },
        { name: "FIntRenderShadowIntensity", value: "1" },
        { name: "DFFlagDebugPauseVoxelizer", value: "False" },
    ],
    "null-flags": [
        { name: "FFlagEnableInGameMenuChrome", value: "False" },
        { name: "DFFlagTextureQualityOverrideEnabled", value: "False" },
        { name: "FFlagDisablePostFx", value: "True" },
        { name: "DFFlagDebugRenderForceTechnologyVoxel", value: "True" },
    ],
};

async function loadFastflags() {
    const r = await invoke("get_fastflags").catch(() => []);
    ffState = Array.isArray(r) ? r : [];
    renderFastflags();
}

function renderFastflags() {
    const list = $id("fastflags-list");
    list.innerHTML = "";
    if (!ffState || !ffState.length) list.appendChild(note("No FastFlags configured."));
    for (const [idx, f] of (ffState || []).entries()) {
        const row = el("div", "ff-row");
        const sw = el("label", "switch");
        const inp = document.createElement("input");
        inp.type = "checkbox";
        inp.checked = f.enabled;
        const knob = el("span", "knob");
        sw.append(inp, knob);
        sw.addEventListener("click", async (e) => {
            e.preventDefault();
            f.enabled = !f.enabled;
            inp.checked = f.enabled;
            await saveFastflags();
        });
        const name = el("span", "ff-name", f.name);
        const val = document.createElement("input");
        val.value = f.value;
        val.addEventListener("change", async () => {
            f.value = val.value;
            await saveFastflags();
        });
        const desc = el("span", "ff-desc", f.description || "");
        row.append(sw, name, val, desc);
        list.appendChild(row);
    }
}

function collectFlags() {
    return ffState;
}

async function saveFastflags() {
    await invoke("save_fastflags", { flags: ffState }).catch((e) => note(String(e)));
}

// ============ account cookie ============

async function loadCookieStatus() {
    const st = await invoke("get_cookie_status").catch(() => ({ linked: false, username: null }));
    const badge = $id("user-badge");
    const name = $id("user-name");
    const status = $id("cookie-status");
    if (st.linked) {
        badge.classList.add("linked");
        name.textContent = st.username || "Linked";
        status.textContent = st.username
            ? `linked as ${st.username}`
            : "cookie stored, but username lookup failed";
        status.classList.add("ok");
    } else {
        badge.classList.remove("linked");
        name.textContent = "Not linked";
        status.textContent = "account not linked";
        status.classList.remove("ok");
    }
}

async function saveCookie() {
    const val = $id("cookie-input").value.trim();
    if (!val) return;
    const ok = await invoke("save_cookie", { cookie: val }).catch((e) => String(e));
    $id("cookie-input").value = "";
    if (ok === undefined) loadCookieStatus();
    else $id("cookie-status").textContent = String(ok);
}

async function clearCookie() {
    await invoke("clear_cookie").catch(() => {});
    loadCookieStatus();
}

// ============ cache ============

async function initCache(clearSel) {
    if (clearSel) {
        // clear names provided
        await invoke("clear_cache", { targets: clearSel }).catch((e) => String(e));
    }
    let info;
    try {
        info = await invoke("get_cache_info");
    } catch (e) {
        $id("cache-list").innerHTML = "";
        $id("cache-list").appendChild(note("Cache scan failed: " + e, "error-note"));
        return;
    }
    cacheState = info.entries || [];
    const list = $id("cache-list");
    list.innerHTML = "";
    for (const c of cacheState) {
        const row = el("div", "cache-row");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.disabled = !c.can_clear;
        cb.dataset.name = c.name;
        const wrap = el("div");
        wrap.append(el("div", "c-name", c.name), el("div", "c-path", c.path));
        const size = el("div", "c-size", c.size_mb.toFixed(1) + " MB");
        row.append(cb, wrap, size);
        list.appendChild(row);
    }
    $id("clear-cache-btn").textContent = `Clear selected (${info.total_size_mb ? info.total_size_mb.toFixed(0) + " MB total" : "0 MB"})`;
}

async function clearSelectedCache() {
    const selected = [...document.querySelectorAll("#cache-list input:checked")].map((i) => i.dataset.name);
    if (!selected.length) return;
    const btn = $id("clear-cache-btn");
    btn.disabled = true;
    btn.textContent = "Clearing...";
    await initCache(selected);
    btn.disabled = false;
}

// ============ system info ============

async function loadSystemInfo() {
    const si = await invoke("get_system_info").catch(() => null);
    const box = $id("system-info");
    box.innerHTML = "";
    if (si) {
        box.innerHTML = `<b>${si.hostname}</b> · ${si.os_name} ${si.os_version}<br>
        CPU ${si.cpu_usage.toFixed(0)}% · RAM ${(si.used_memory / 1073741824).toFixed(1)} / ${(si.total_memory / 1073741824).toFixed(1)} GB (${si.memory_usage_percent.toFixed(0)}%)`;
    }
    const pi = await invoke("get_roblox_process_info").catch(() => null);
    const pbox = $id("roblox-process");
    pbox.innerHTML = "";
    if (pi) {
        pbox.innerHTML = `<b>Roblox process</b> · pid ${pi.pid} · ${pi.name}<br>CPU ${pi.cpu_usage.toFixed(1)}% · ${pi.memory_usage_mb.toFixed(0)} MB RAM · status ${pi.status}`;
    } else {
        pbox.innerHTML = "<b>Roblox not running</b><br>the client appears when a game docks";
    }
}

// ============ refresh ============

function setupRefresh() {
    $id("refresh-btn").addEventListener("click", () => {
        const btn = $id("refresh-btn");
        btn.classList.add("spin");
        setTimeout(() => btn.classList.remove("spin"), 900);
        if (currentView === "home") loadHome();
        else if (currentView === "games") loadDiscover();
        else if (currentView === "search") runSearch($id("search-input").value.trim());
        else if (currentView === "settings") {
            loadSettings();
            loadFastflags();
            loadCookieStatus();
            loadSystemInfo();
            initCache(null);
        }
    });
}

// ============ command palette (Ctrl+K) ============

let cmdSelected = -1;
let cmdResults = [];
let cmdDebounce = null;

function setupCommandPalette() {
    const palette = $id("cmd-palette");
    const input = $id("cmd-input");
    const results = $id("cmd-results");

    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "k") {
            e.preventDefault();
            toggleCmdPalette();
        }
        if (e.key === "Escape" && !palette.classList.contains("hidden")) {
            closeCmdPalette();
        }
    });

    palette.querySelector(".cmd-backdrop").addEventListener("click", closeCmdPalette);

    input.addEventListener("input", () => {
        clearTimeout(cmdDebounce);
        const q = input.value.trim();
        if (q.length < 2) {
            cmdResults = [];
            renderCmdResults();
            return;
        }
        cmdDebounce = setTimeout(() => runCmdSearch(q), 250);
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            cmdSelected = Math.min(cmdSelected + 1, cmdResults.length - 1);
            renderCmdResults();
            scrollCmdSelected();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            cmdSelected = Math.max(cmdSelected - 1, 0);
            renderCmdResults();
            scrollCmdSelected();
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (cmdSelected >= 0 && cmdResults[cmdSelected]) {
                openGame(cmdResults[cmdSelected]);
                closeCmdPalette();
            }
        }
    });
}

function toggleCmdPalette() {
    const palette = $id("cmd-palette");
    if (palette.classList.contains("hidden")) {
        openCmdPalette();
    } else {
        closeCmdPalette();
    }
}

function openCmdPalette() {
    const palette = $id("cmd-palette");
    const input = $id("cmd-input");
    palette.classList.remove("hidden");
    input.value = "";
    cmdResults = [];
    cmdSelected = -1;
    renderCmdResults();
    setTimeout(() => input.focus(), 50);
    invoke("get_sort_games", { sortId: "top-trending" }).then((page) => {
        if (page && page.games && page.games.length) {
            cmdResults = page.games.slice(0, 8);
            renderCmdResults();
        }
    }).catch(() => {});
}

function closeCmdPalette() {
    $id("cmd-palette").classList.add("hidden");
    $id("cmd-input").value = "";
    cmdResults = [];
    cmdSelected = -1;
}

async function runCmdSearch(q) {
    try {
        const page = await invoke("search_games", { query: q });
        cmdResults = (page.games || []).slice(0, 10);
        cmdSelected = cmdResults.length > 0 ? 0 : -1;
        renderCmdResults();
    } catch (e) {
        cmdResults = [];
        renderCmdResults();
    }
}

function renderCmdResults() {
    const container = $id("cmd-results");
    container.innerHTML = "";
    if (!cmdResults.length) {
        container.innerHTML = '<div class="cmd-empty">No games found. Try a different search.</div>';
        return;
    }
    cmdResults.forEach((g, i) => {
        const item = el("div", "cmd-item" + (i === cmdSelected ? " active" : ""));
        item.innerHTML = `
            <img class="cmd-item-thumb" alt="" src="${g.thumbnail_url || ""}">
            <div class="cmd-item-info">
                <div class="cmd-item-name"></div>
                <div class="cmd-item-meta"></div>
            </div>
            ${g.playing > 0 ? `<span class="cmd-item-playing">${fmt(g.playing)}</span>` : ""}
        `;
        item.querySelector(".cmd-item-name").textContent = g.name || "Untitled";
        item.querySelector(".cmd-item-meta").textContent = g.creator || "verified creator";
        item.addEventListener("click", () => {
            openGame(g);
            closeCmdPalette();
        });
        item.addEventListener("mouseenter", () => {
            cmdSelected = i;
            renderCmdResults();
        });
        container.appendChild(item);
    });
}

function scrollCmdSelected() {
    const container = $id("cmd-results");
    const active = container.querySelector(".cmd-item.active");
    if (active) active.scrollIntoView({ block: "nearest" });
}

// ============ boot ============

document.addEventListener("DOMContentLoaded", async () => {
    setupNav();
    setupSearch();
    setupModal();
    setupRefresh();
    setupPlayEvents();
    setupSettings();
    setupCommandPalette();
    await loadHome();
    await loadSettings();
    await loadFastflags();
    await loadMods();
    await loadCookieStatus();
    await loadSystemInfo();
    await initCache(null);
    setInterval(pollStatus, 6000);
});
