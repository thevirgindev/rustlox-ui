// main.js - Rustlox frontend

const _tauri = window.__TAURI__ || { core: { invoke: async () => null }, event: { listen: async () => ({ unlisten: () => {} }) } };
const { invoke } = _tauri.core;
const { listen } = _tauri.event;
const tauriWin = _tauri.window?.getCurrentWindow?.() ?? null;

let frameless = false;
function layoutPx(playing) {
    return { sidebarPx: playing ? 56 : 224, topbarPx: (playing ? 0 : 56) + (frameless ? 32 : 0) };
}
function setLayout(playing) { return invoke("set_layout", layoutPx(playing)); }

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

const VIEW_TITLES = { home: "Home", games: "Discover", library: "Library", mods: "Mods", settings: "Settings" };

function switchView(name) {
    currentView = name;
    const title = $id("view-title");
    if (title) title.textContent = VIEW_TITLES[name] || "";
    $id("view-container").scrollTop = 0; // views share one scroller
    document.querySelectorAll(".nav-item").forEach((n) =>
        n.classList.toggle("active", n.dataset.view === name)
    );
    document.querySelectorAll(".view").forEach((v) =>
        v.classList.toggle("active", v.id === `view-${name}`)
    );
    if (name === "games") loadDiscover();
    if (name === "library") {
        loadLibrary();
        setTimeout(syncLibrarySlider, 30);
    }
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

// ============ roblox cards & friends ============

function makeAvatarSvg(name, bg) {
    const initial = (name || "U").charAt(0).toUpperCase();
    const safeName = encodeURIComponent(name.replace(/[^a-zA-Z0-9]/g, ""));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="58" height="58" viewBox="0 0 58 58">
        <defs>
            <linearGradient id="av_${safeName}" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="${bg || "#6366f1"}" />
                <stop offset="100%" stop-color="#111827" />
            </linearGradient>
        </defs>
        <circle cx="29" cy="29" r="28" fill="url(#av_${safeName})"/>
        <circle cx="29" cy="22" r="10" fill="#ffffff" opacity="0.9"/>
        <path d="M15 48c0-7.7 6.3-14 14-14s14 6.3 14 14" fill="#ffffff" opacity="0.85"/>
        <text x="29" y="26" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="11" font-weight="900" fill="${bg || "#111827"}" text-anchor="middle">${initial}</text>
    </svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

async function renderFriendsBar() {
    const container = $id("friends-list-container");
    if (!container) return;
    try {
        const friends = await invoke("get_friends").catch(() => []);
        container.innerHTML = "";
        friends.forEach((f) => {
            const item = el("div", "friend-item");
            item.setAttribute("role", "button");
            item.tabIndex = 0;
            item.title = `${f.name} • ${f.status === "online" ? `Playing ${f.game || "Roblox"}` : "Offline"}`;
            item.innerHTML = `
                <div class="friend-avatar-wrap">
                    <img class="friend-avatar-svg" src="${makeAvatarSvg(f.name, f.avatarColor)}" alt="${escapeHtml(f.name)}">
                    ${f.status === "online" ? '<span class="friend-online-dot"></span>' : ""}
                </div>
                <span class="friend-name">${escapeHtml(f.name)}</span>
            `;
            item.addEventListener("click", () => {
                showToast(`${f.name} is online playing ${f.game || "Roblox"}!`);
            });
            container.appendChild(item);
        });
    } catch (e) { /* ignore */ }

    const addBtn = $id("btn-add-friends");
    if (addBtn && !addBtn.dataset.bound) {
        addBtn.dataset.bound = "1";
        addBtn.addEventListener("click", () => {
            showToast("Friend requests: 1 pending request from @ninnie");
        });
    }
}

function robloxCardLandscape(g) {
    const c = el("div", "roblox-card roblox-card-landscape");
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    const gameTitle = g.name || g.title || "Experience";
    const likesTotal = (g.likes || 0) + (g.dislikes || 0);
    const ratingPct = likesTotal > 0
        ? Math.round((g.likes / likesTotal) * 100)
        : (88 + (Math.abs(g.place_id || 1) % 11));
    const isAd = g.is_ad || (g.place_id === 910006 || g.place_id === 910011);

    c.innerHTML = `
        <div class="roblox-card-thumb-wrap landscape">
            <img class="roblox-card-thumb" alt="" loading="lazy" src="${g.thumbnail_url || ""}">
        </div>
        <div class="roblox-card-body">
            <div class="roblox-card-title" title="${escapeHtml(gameTitle)}">${escapeHtml(gameTitle)}</div>
            <div class="roblox-card-stats">
                ${isAd ? '<span class="roblox-ad-label">Ad</span><span class="roblox-dot-sep">•</span>' : ""}
                <span class="roblox-stat-rating">
                    <svg viewBox="0 0 24 24" class="stat-icon-thumbs" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                    ${ratingPct}% Rating
                </span>
            </div>
        </div>
    `;

    c.addEventListener("click", () => openGame(g));
    c.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openGame(g);
        }
    });

    return c;
}

function robloxCardSquare(g) {
    const c = el("div", "roblox-card roblox-card-square");
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    const gameTitle = g.name || g.title || "Experience";
    const likesTotal = (g.likes || 0) + (g.dislikes || 0);
    const ratingPct = likesTotal > 0
        ? Math.round((g.likes / likesTotal) * 100)
        : (86 + (Math.abs(g.place_id || 1) % 12));
    const playingCount = g.playing > 0 ? fmt(g.playing) : "1.2K";

    c.innerHTML = `
        <div class="roblox-card-thumb-wrap square">
            <img class="roblox-card-thumb" alt="" loading="lazy" src="${g.thumbnail_url || ""}">
        </div>
        <div class="roblox-card-body">
            <div class="roblox-card-title" title="${escapeHtml(gameTitle)}">${escapeHtml(gameTitle)}</div>
            <div class="roblox-card-stats">
                <span class="roblox-stat-rating">
                    <svg viewBox="0 0 24 24" class="stat-icon-thumbs" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                    ${ratingPct}%
                </span>
                <span class="roblox-stat-playing">
                    <svg viewBox="0 0 24 24" class="stat-icon-person" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    ${playingCount}
                </span>
            </div>
        </div>
    `;

    c.addEventListener("click", () => openGame(g));
    c.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openGame(g);
        }
    });

    return c;
}

function gameCard(g) {
    return robloxCardLandscape(g);
}

function failGrid(container, msg) {
    if (!container) return;
    container.innerHTML = "";
    container.appendChild(note(msg, "error-note"));
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderRobloxLandscape(container, games) {
    if (!container) return;
    container.innerHTML = "";
    if (!games || !games.length) {
        container.appendChild(note("Nothing surfaced here yet - try another row."));
        return;
    }
    games.forEach((g) => container.appendChild(robloxCardLandscape(g)));
}

function renderRobloxSquare(container, games) {
    if (!container) return;
    container.innerHTML = "";
    if (!games || !games.length) {
        container.appendChild(note("Nothing surfaced here yet - try another row."));
        return;
    }
    games.forEach((g) => container.appendChild(robloxCardSquare(g)));
}

function skeletonRobloxGrid(container, n, isLandscape) {
    if (!container) return;
    container.innerHTML = "";
    for (let i = 0; i < (n || 6); i++) {
        const c = el("div", "roblox-card loading-skeleton");
        c.innerHTML = `
            <div class="roblox-card-thumb-wrap ${isLandscape ? "landscape" : "square"}"></div>
            <div class="roblox-card-body">
                <div class="sk-line" style="width: 85%; height: 14px; margin-bottom: 4px;"></div>
                <div class="sk-line short" style="width: 45%; height: 11px;"></div>
            </div>
        `;
        container.appendChild(c);
    }
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
    for (let i = 0; i < (n || 8); i++) {
        const c = el("div", "roblox-card loading-skeleton");
        c.innerHTML = `
            <div class="roblox-card-thumb-wrap landscape"></div>
            <div class="roblox-card-body">
                <div class="sk-line" style="width: 80%;"></div>
                <div class="sk-line short" style="width: 40%;"></div>
            </div>`;
        container.appendChild(c);
    }
}

// Simple toast notification helper
function showToast(msg) {
    let t = $id("rustlox-toast");
    if (!t) {
        t = el("div", "rustlox-toast");
        t.id = "rustlox-toast";
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("visible");
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => t.classList.remove("visible"), 2600);
}

// ============ home / dashboard ============

async function loadHome() {
    renderFriendsBar();
    const trend = $id("home-trending");
    const now = $id("home-playing");
    skeletonRobloxGrid(trend, 12, true);
    skeletonRobloxGrid(now, 8, false);
    const heroEl = $id("home-featured");
    if (heroEl) {
        heroEl.className = "featured loading";
        heroEl.innerHTML = "";
    }

    const dash = invoke("get_dashboard").catch(() => null);
    const trending = invoke("get_sort_games", { sortId: "top-trending" }).catch(() => null);
    const playing = invoke("get_sort_games", { sortId: "top-playing-now" }).catch(() => null);

    const [d, t, p] = await Promise.race([
        Promise.all([dash, trending, playing]),
        new Promise((r) => setTimeout(() => r([null, null, null]), 25000)),
    ]);

    if (t) renderRobloxLandscape(trend, t.games); else failGrid(trend, "Recommended failed to load - hit refresh.");
    if (p) renderRobloxSquare(now, p.games); else failGrid(now, "Continue failed to load - hit refresh.");

    const feat = $id("home-featured");
    if (feat && t && t.games && t.games.length) {
        buildHero(feat, t.games.slice(0, 6));
    } else if (feat) {
        feat.classList.add("hidden");
    }

    if (d) {
        const sp = $id("stat-players"); if (sp) sp.textContent = d.live_players;
        const sps = $id("stat-players-sub"); if (sps) sps.textContent = `across ${d.sorts_loaded} live rows`;
        const stg = $id("stat-topgame"); if (stg) stg.textContent = d.largest_game || "--";
        const stgs = $id("stat-topgame-sub"); if (stgs) stgs.textContent =
            d.largest_players > 0 ? fmt(d.largest_players) + " in the crowd right now" : "waiting on the crowd";
        const ss = $id("stat-sorts"); if (ss) ss.textContent = d.sorts_loaded;
        const ring = $id("stat-ring"); if (ring) {
            const pct = d.largest_players > 0
                ? Math.round((d.largest_players / parseCount(d.live_players)) * 100)
                : 0;
            const rv = $id("stat-ring-val"); if (rv) rv.textContent = Math.min(pct, 100) + "%";
            ring.style.strokeDashoffset = 251.2 * (1 - Math.min(pct, 100) / 100);
            ring.style.stroke = pct > 25 ? "#5eead4" : "#fbbf24";
        }
    }
}

// ============ featured hero ============

// Pull a vivid tint out of the art so the button and selected row follow the game,
// like the store does. Needs CORS on the image; on failure we stay on the default blue.
const tintCache = new Map();

function sampleTint(url) {
    return new Promise((resolve) => {
        if (!url) return resolve(null);
        if (tintCache.has(url)) return resolve(tintCache.get(url));
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => {
            let out = null;
            try {
                const c = document.createElement("canvas");
                c.width = c.height = 16;
                const x = c.getContext("2d", { willReadFrequently: true });
                x.drawImage(im, 0, 0, 16, 16);
                const d = x.getImageData(0, 0, 16, 16).data;
                let r = 0, g = 0, b = 0, w = 0;
                for (let i = 0; i < d.length; i += 4) {
                    const mx = Math.max(d[i], d[i + 1], d[i + 2]);
                    const mn = Math.min(d[i], d[i + 1], d[i + 2]);
                    const sat = mx ? (mx - mn) / mx : 0;
                    const wt = sat * sat * (mx / 255) + 0.001;
                    r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
                }
                r /= w; g /= w; b /= w;
                const mx = Math.max(r, g, b);
                const sat = mx ? (mx - Math.min(r, g, b)) / mx : 0;
                if (sat >= 0.35 && mx > 0) {
                    const k = 235 / mx;
                    out = [r, g, b].map((v) => Math.min(255, Math.round(v * k)));
                }
            } catch (e) { /* tainted canvas */ }
            tintCache.set(url, out);
            resolve(out);
        };
        im.onerror = () => resolve(null);
        im.src = url;
    });
}

function buildHero(feat, games) {
    let idx = 0;
    let autoTimer = null;
    feat.className = "featured";
    feat.innerHTML = `
        <div class="hero-main">
            <img class="hero-art" alt="">
            <div class="hero-shade"></div>
            <div class="hero-copy">
                <h2 class="hero-title"></h2>
                <div class="hero-label">Trending now</div>
                <p class="hero-tagline"></p>
                <div class="hero-meta"></div>
                <button class="hero-cta">Play</button>
            </div>
            <div class="hero-arrows">
                <button class="hero-arrow-btn" id="hero-prev" title="Previous experience" aria-label="Previous experience">
                    <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <button class="hero-arrow-btn" id="hero-next" title="Next experience" aria-label="Next experience">
                    <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </div>
        </div>`;

    const main = feat.querySelector(".hero-main");
    const art = feat.querySelector(".hero-art");
    const title = feat.querySelector(".hero-title");
    const tagline = feat.querySelector(".hero-tagline");
    const meta = feat.querySelector(".hero-meta");
    const prevBtn = feat.querySelector("#hero-prev");
    const nextBtn = feat.querySelector("#hero-next");

    function select(i) {
        if (!games || !games.length) return;
        idx = (i + games.length) % games.length;
        const g = games[idx];
        if (!g) return;
        art.style.animation = "none";
        void art.offsetWidth;
        art.style.animation = "";
        art.src = g.thumbnail_url || "";
        title.textContent = g.name || "Untitled";
        tagline.textContent = (g.description || "").trim() || ("Join thousands of players in " + (g.name || "this experience") + " on Roblox.");
        meta.textContent = g.playing > 0 ? fmt(g.playing) + " playing" : "";
        sampleTint(g.thumbnail_url).then((rgb) => {
            if (rgb) {
                const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
                feat.style.setProperty("--tint", `rgb(${rgb.join(",")})`);
                feat.style.setProperty("--tint-ink", lum > 0.6 ? "#111" : "#fff");
            } else {
                feat.style.removeProperty("--tint");
                feat.style.removeProperty("--tint-ink");
            }
        });
    }

    function resetTimer() {
        clearInterval(autoTimer);
        autoTimer = setInterval(() => select(idx + 1), 7000);
    }

    if (prevBtn) {
        prevBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            select(idx - 1);
            resetTimer();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            select(idx + 1);
            resetTimer();
        });
    }

    feat.addEventListener("mouseenter", () => clearInterval(autoTimer));
    feat.addEventListener("mouseleave", resetTimer);

    main.addEventListener("click", (e) => {
        if (e.target.closest(".hero-arrows")) return;
        if (games[idx]) openGame(games[idx]);
    });

    feat.querySelector(".hero-cta").addEventListener("click", (e) => {
        e.stopPropagation();
        if (games[idx]) openGame(games[idx]);
    });

    select(0);
    resetTimer();
}

// ============ row arrows (home shelves) ============

function setupRows() {
    document.querySelectorAll(".row-arrows").forEach((group) => {
        const row = $id(group.dataset.target);
        if (!row) return;
        const [prev, next] = group.querySelectorAll("button");
        const sync = () => {
            prev.disabled = row.scrollLeft < 4;
            next.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 4;
        };
        group.querySelectorAll("button").forEach((b) =>
            b.addEventListener("click", () =>
                row.scrollBy({ left: Number(b.dataset.dir) * row.clientWidth * 0.9, behavior: "smooth" })
            )
        );
        row.addEventListener("scroll", sync, { passive: true });
        new MutationObserver(sync).observe(row, { childList: true });
        window.addEventListener("resize", sync);
        sync();
    });
}

function parseCount(s) {
    const m = /^([\d.]+)([KMB]?)$/.exec(s || "");
    if (!m) return 0;
    const mult = { "": 1, K: 1e3, M: 1e6, B: 1e9 }[m[2]];
    return parseFloat(m[1]) * mult;
}

// ============ discover ============

let discoverGamesList = [];
let discoverGridLayout = "5"; // "3" or "5"

async function loadDiscover() {
    const grid = $id("games-grid");
    if (!grid) return;
    skeleton(grid, discoverGridLayout === "3" ? 6 : 10);

    try {
        const [trend, play, more] = await Promise.all([
            invoke("get_sort_games", { sortId: "top-trending" }).catch(() => null),
            invoke("get_sort_games", { sortId: "top-playing-now" }).catch(() => null),
            invoke("get_sort_games", { sortId: "up-and-coming" }).catch(() => null),
        ]);
        const pool = [...(trend?.games || []), ...(play?.games || []), ...(more?.games || [])];
        const seen = new Set();
        discoverGamesList = pool.filter((g) => g && g.place_id && !seen.has(g.place_id) && seen.add(g.place_id));
        renderGrid(grid, discoverGamesList);
    } catch (e) {
        failGrid(grid, "Discover failed: " + e);
    }
}

function setupDiscoverGridToggle() {
    const btn3 = $id("grid-toggle-3x3");
    const btn5 = $id("grid-toggle-5x5");
    const grid = $id("games-grid");
    if (!btn3 || !btn5 || !grid) return;

    btn3.addEventListener("click", () => {
        discoverGridLayout = "3";
        btn3.classList.add("active");
        btn5.classList.remove("active");
        grid.classList.add("grid-3x3");
        grid.classList.remove("grid-5x5");
    });

    btn5.addEventListener("click", () => {
        discoverGridLayout = "5";
        btn5.classList.add("active");
        btn3.classList.remove("active");
        grid.classList.add("grid-5x5");
        grid.classList.remove("grid-3x3");
    });
}

// ============ search (integrated in Discover) ============

function setupSearch() {
    const discInput = $id("discover-search-input");
    const clearBtn = $id("discover-search-clear");

    if (discInput) {
        discInput.addEventListener("input", (e) => {
            const q = (e.target.value || "").trim();
            if (clearBtn) clearBtn.classList.toggle("hidden", !q);
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                if (q.length > 0) {
                    runSearch(q);
                } else {
                    renderGrid($id("games-grid"), discoverGamesList);
                }
            }, 250);
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            if (discInput) discInput.value = "";
            clearBtn.classList.add("hidden");
            renderGrid($id("games-grid"), discoverGamesList);
            if (discInput) discInput.focus();
        });
    }
}

async function runSearch(q) {
    if (!q) return;
    const grid = $id("games-grid");
    if (!grid) return;
    skeleton(grid, 6);
    try {
        const page = await invoke("search_games", { query: q });
        renderGrid(grid, (page && page.games) || []);
    } catch (e) {
        failGrid(grid, "Search failed: " + e);
    }
}

// ============ library (slider tabs) ============

let libraryFilter = "all";

function syncLibrarySlider(btn) {
    const container = $id("library-slider-container");
    const indicator = $id("library-slider-indicator");
    const activeBtn = btn || container?.querySelector(".slider-btn.active");
    if (!container || !indicator || !activeBtn) return;
    const cRect = container.getBoundingClientRect();
    const bRect = activeBtn.getBoundingClientRect();
    indicator.style.width = `${bRect.width}px`;
    indicator.style.transform = `translateX(${bRect.left - cRect.left - 4}px)`;
}

async function loadLibrary() {
    const grid = $id("library-grid");
    if (!grid) return;
    skeleton(grid, 6);

    try {
        const page = await invoke("get_sort_games", { sortId: "top-trending" });
        const all = (page && page.games) || [];
        let filtered = all;
        if (libraryFilter === "recent") {
            filtered = all.slice(0, 4);
        } else if (libraryFilter === "favorites") {
            filtered = all.filter((g) => g.likes > 2500000);
        }
        renderGrid(grid, filtered);
    } catch (e) {
        failGrid(grid, "Library could not load: " + e);
    }
}

function setupLibrary() {
    const container = $id("library-slider-container");
    if (!container) return;
    container.querySelectorAll(".slider-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            container.querySelectorAll(".slider-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            libraryFilter = btn.dataset.filter || "all";
            syncLibrarySlider(btn);
            loadLibrary();
        });
    });
    window.addEventListener("resize", () => syncLibrarySlider());
}

// ============ account modal (Not Linked interaction) ============

function setupAccountModal() {
    const modal = $id("account-modal");
    const badge = $id("user-badge");
    const closeBtn = $id("account-modal-close");
    const cookieInput = $id("acc-cookie-input");
    const saveBtn = $id("acc-save-cookie");
    const clearBtn = $id("acc-clear-cookie");
    const settingsBtn = $id("acc-open-settings");

    if (!modal || !badge) return;

    async function syncModalState() {
        const st = await invoke("get_cookie_status").catch(() => ({ linked: false, username: null }));
        const tag = $id("acc-status-tag");
        const status = $id("acc-cookie-status");
        const avatar = $id("acc-avatar-large");

        if (st && st.linked) {
            tag.textContent = `Linked (@${st.username || "player"})`;
            tag.className = "acc-status-tag linked";
            status.textContent = `Active: linked as @${st.username || "player"}`;
            status.className = "cookie-status ok";
            avatar.className = "acc-avatar linked";
            avatar.textContent = (st.username || "P").charAt(0).toUpperCase();
        } else {
            tag.textContent = "Not linked";
            tag.className = "acc-status-tag";
            status.textContent = "No account linked yet.";
            status.className = "cookie-status";
            avatar.className = "acc-avatar";
            avatar.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
        }
    }

    badge.addEventListener("click", () => {
        modal.classList.remove("hidden");
        syncModalState();
        if (cookieInput) setTimeout(() => cookieInput.focus(), 80);
    });

    if (closeBtn) closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
    modal.querySelector(".modal-backdrop").addEventListener("click", () => modal.classList.add("hidden"));

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !modal.classList.contains("hidden")) {
            modal.classList.add("hidden");
        }
    });

    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            const val = cookieInput.value.trim();
            if (!val) return;
            saveBtn.textContent = "Linking...";
            await invoke("save_cookie", { cookie: val }).catch(() => {});
            cookieInput.value = "";
            saveBtn.textContent = "Linked!";
            setTimeout(() => (saveBtn.textContent = "Link"), 1600);
            await loadCookieStatus();
            await syncModalState();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", async () => {
            await invoke("clear_cookie").catch(() => {});
            await loadCookieStatus();
            await syncModalState();
        });
    }

    if (settingsBtn) {
        settingsBtn.addEventListener("click", () => {
            modal.classList.add("hidden");
            switchView("settings");
            const ci = $id("cookie-input");
            if (ci) setTimeout(() => ci.focus(), 150);
        });
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
    $id("play-exit-pill").classList.remove("hidden");
    await setLayout(true);
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
            $id("play-exit-pill").classList.add("hidden");
            await setLayout(false);
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
        $id("play-exit-pill").classList.add("hidden");
        await setLayout(false);
        clearInterval(statusTimer);
    });

    $id("play-exit-pill").addEventListener("click", async () => {
        await invoke("detach_game").catch(() => {});
        $id("play-bar").classList.add("hidden");
        $id("play-exit-pill").classList.add("hidden");
        document.body.classList.remove("playing");
        await setLayout(false);
        clearInterval(statusTimer);
    });
}

// ============ mods ============

let modsListCache = [];

function renderMods(mods) {
    const grid = $id("mods-grid");
    if (!grid) return;
    grid.innerHTML = "";
    if (!mods.length) {
        grid.appendChild(note("No matching mods found."));
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

function filterAndRenderMods() {
    const input = $id("mods-search-input");
    const q = (input?.value || "").trim().toLowerCase();
    const clearBtn = $id("mods-search-clear");
    if (clearBtn) clearBtn.classList.toggle("hidden", !q);
    if (!q) {
        renderMods(modsListCache);
        return;
    }
    const filtered = modsListCache.filter(
        (m) => (m.name && m.name.toLowerCase().includes(q)) ||
               (m.category && m.category.toLowerCase().includes(q)) ||
               (m.description && m.description.toLowerCase().includes(q))
    );
    renderMods(filtered);
}

function setupModsSearch() {
    const input = $id("mods-search-input");
    const clearBtn = $id("mods-search-clear");
    if (input) {
        input.addEventListener("input", filterAndRenderMods);
    }
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            input.value = "";
            filterAndRenderMods();
            input.focus();
        });
    }
}

async function loadMods() {
    const r = await invoke("get_mods").catch(() => []);
    modsListCache = Array.isArray(r) ? r : [];
    filterAndRenderMods();
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

function syncSettingsSlider(btn) {
    const container = $id("settings-slider-container");
    const indicator = $id("settings-slider-indicator");
    const activeBtn = btn || container?.querySelector(".slider-btn.active");
    if (!container || !indicator || !activeBtn) return;
    const cRect = container.getBoundingClientRect();
    const bRect = activeBtn.getBoundingClientRect();
    indicator.style.width = `${bRect.width}px`;
    indicator.style.transform = `translateX(${bRect.left - cRect.left - 4}px)`;
}

function setupSettingsSlider() {
    const container = $id("settings-slider-container");
    if (!container) return;
    const btns = container.querySelectorAll(".slider-btn");
    btns.forEach((btn) => {
        btn.addEventListener("click", () => {
            btns.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const target = btn.dataset.target;
            document.querySelectorAll(".settings-section").forEach((sec) => {
                sec.classList.toggle("hidden", sec.dataset.section !== target);
            });
            syncSettingsSlider(btn);
        });
    });
    window.addEventListener("resize", () => syncSettingsSlider());
    setTimeout(() => syncSettingsSlider(), 80);
}

function setupSettings() {
    setupSettingsSlider();
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
    const s = await invoke("get_settings").catch(() => ({}));
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
    const r = await invoke("get_cookie_status").catch(() => ({ linked: false, username: null }));
    const st = r || { linked: false, username: null };
    const badge = $id("user-badge");
    const name = $id("user-name");
    const status = $id("cookie-status");
    const avatar = $id("avatar-dot");
    if (avatar) avatar.textContent = st.linked ? (st.username || "?").charAt(0).toUpperCase() : "";
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
    if (!info) {
        $id("cache-list").innerHTML = "";
        $id("cache-list").appendChild(note("Cache scan returned no data.", "error-note"));
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
        if (currentView === "home") {
            loadHome();
        } else if (currentView === "games") {
            const discInput = $id("discover-search-input");
            const q = discInput ? discInput.value.trim() : "";
            if (q) runSearch(q);
            else loadDiscover();
        } else if (currentView === "settings") {
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
        item.querySelector(".cmd-item-meta").textContent = g.creator || "Roblox Community";
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

// ============ window frame ============

async function setupFrame() {
    if (!tauriWin) return;
    try { frameless = !(await tauriWin.isDecorated()); } catch { frameless = false; }
    if (!frameless) return;
    document.body.classList.add("frameless");
    $id("win-min").addEventListener("click", () => tauriWin.minimize());
    $id("win-max").addEventListener("click", () => tauriWin.toggleMaximize());
    $id("win-close").addEventListener("click", () => tauriWin.close());
    const syncMax = async () => {
        try { document.body.classList.toggle("maximized", await tauriWin.isMaximized()); } catch {}
    };
    let _t;
    window.addEventListener("resize", () => { clearTimeout(_t); _t = setTimeout(syncMax, 100); });
    syncMax();
    await setLayout(false).catch(() => {});
}

// ============ boot ============

document.addEventListener("DOMContentLoaded", async () => {
    await setupFrame();
    setupNav();
    setupRows();
    setupDiscoverGridToggle();
    setupSearch();
    setupModsSearch();
    setupLibrary();
    setupAccountModal();
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
