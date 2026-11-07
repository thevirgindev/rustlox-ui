// shim.js - Tauri 2 API Mock & Browser Compatibility Shim for Rustlox UI
// Enables running and previewing Rustlox UI seamlessly in standard browser environments

(function () {
    if (window.__TAURI__) {
        console.info("[Rustlox] Native Tauri runtime detected, using native backend.");
        return;
    }

    console.info("[Rustlox] Initializing browser Tauri shim for web preview...");

    // Event bus for Tauri listen / emit
    const listeners = new Map();

    function emit(event, payload) {
        const cbs = listeners.get(event) || [];
        for (const cb of cbs) {
            try {
                cb({ event, payload });
            } catch (err) {
                console.error(`[Rustlox Shim] Error in listener for ${event}:`, err);
            }
        }
    }

    async function listen(event, callback) {
        if (!listeners.has(event)) {
            listeners.set(event, []);
        }
        listeners.get(event).push(callback);
        return {
            unlisten: () => {
                const list = listeners.get(event) || [];
                const idx = list.indexOf(callback);
                if (idx !== -1) list.splice(idx, 1);
            }
        };
    }

    // In-memory mock database & state
    let isGameRunning = false;
    let runningGame = null;
    let cookieLinked = false;
    let cookieUsername = null;

    let settingsState = {
        graphics_quality: 7,
        fps_cap: 144,
        resolution_width: 1920,
        resolution_height: 1080,
        fullscreen: false,
        vsync: true,
        render_distance: 7,
        texture_quality: 5,
        shadow_quality: 3,
        lighting_quality: 4,
        ui_scale: 1.0,
        discord_rpc: true,
        auto_update: true
    };

    let fastFlagsState = [
        { name: "DFIntTaskSchedulerTargetFps", value: "240", description: "Target frame rate cap (Bloxstrap default)", enabled: true },
        { name: "FFlagDebugGraphicsPreferD3D11", value: "True", description: "Direct3D 11 backend preference", enabled: true },
        { name: "FIntDebugForceMSAASamples", value: "4", description: "MSAA Anti-Aliasing multiplier", enabled: true },
        { name: "DFIntDebugFRMQualityLevelOverride", value: "21", description: "Ultra graphics quality level override", enabled: false },
        { name: "FFlagEnableGraphicsAsyncCompute", value: "True", description: "Asynchronous compute pipeline", enabled: true },
        { name: "DFFlagDebugPauseVoxelizer", value: "False", description: "Terrain voxel meshing optimizer", enabled: false },
        { name: "FFlagDisablePostFx", value: "False", description: "Disable screen post-processing effects", enabled: false },
        { name: "DFIntTextureQualityOverrideV2", value: "3", description: "Texture crispness & filtering level", enabled: true }
    ];

    let modsState = [
        {
            id: "mod-glass-hud",
            name: "Modern Glass HUD",
            category: "Interface",
            description: "Frosted acrylic theme for the in-game topbar and leaderboard",
            file_path: "mods/glass_hud.rbxm",
            enabled: true
        },
        {
            id: "mod-dot-cursor",
            name: "Precision Crosshair",
            category: "Controls",
            description: "Ultra-crisp 1px minimal dot cursor for FPS and combat experiences",
            file_path: "mods/crosshair_dot.png",
            enabled: false
        },
        {
            id: "mod-oof-sound",
            name: "Classic OOF Audio",
            category: "Audio",
            description: "Restores the nostalgic 2006 death audio effect across all games",
            file_path: "mods/uuhhh.mp3",
            enabled: true
        },
        {
            id: "mod-nebula-sky",
            name: "4K Nebula Skybox",
            category: "Visuals",
            description: "High dynamic range space nebula backdrop with twinkling stars",
            file_path: "mods/sky_nebula.rbxm",
            enabled: true
        },
        {
            id: "mod-linear-font",
            name: "Geist UI Font",
            category: "Typography",
            description: "Injects Geist and Inter Variable typography into core player GUI",
            file_path: "mods/font_geist.ttf",
            enabled: false
        }
    ];

    let cacheState = {
        total_size_mb: 412.8,
        entries: [
            { name: "HttpCache", path: "~/.cache/rustlox/http_cache", size_mb: 214.5, can_clear: true },
            { name: "AssetCache", path: "~/.cache/rustlox/rbx_assets", size_mb: 162.3, can_clear: true },
            { name: "CrashLogs", path: "~/.cache/rustlox/diagnostics", size_mb: 36.0, can_clear: true }
        ]
    };

    // Helper to generate authentic 16:9 Roblox-style experience thumbnails
    function createCoverSvg(title, bg1, bg2, accentColor, iconSvg, bannerText) {
        const displayText = bannerText || title;
        const safeTitle = encodeURIComponent(title.replace(/[^a-zA-Z0-9]/g, ""));
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
            <defs>
                <linearGradient id="bg_${safeTitle}" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="${bg1}" />
                    <stop offset="55%" stop-color="${bg2}" />
                    <stop offset="100%" stop-color="#0a0a0d" />
                </linearGradient>
                <linearGradient id="glow_${safeTitle}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.45"/>
                    <stop offset="100%" stop-color="${accentColor}" stop-opacity="0.02"/>
                </linearGradient>
                <filter id="shadow_${safeTitle}" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.65"/>
                </filter>
            </defs>
            <rect width="640" height="360" rx="14" fill="url(#bg_${safeTitle})"/>
            
            <circle cx="320" cy="140" r="170" fill="url(#glow_${safeTitle})"/>
            <circle cx="320" cy="140" r="95" fill="${accentColor}" opacity="0.16"/>
            
            <g stroke="${accentColor}" stroke-opacity="0.14" stroke-width="1.5">
                <line x1="0" y1="260" x2="640" y2="260"/>
                <line x1="120" y1="260" x2="220" y2="360"/>
                <line x1="520" y1="260" x2="420" y2="360"/>
                <circle cx="320" cy="140" r="115" fill="none" stroke-dasharray="8 6"/>
            </g>

            <g filter="url(#shadow_${safeTitle})">
                <circle cx="320" cy="135" r="50" fill="rgba(12, 14, 20, 0.82)" stroke="${accentColor}" stroke-width="3"/>
                <g transform="translate(296, 111) scale(2.0)" fill="${accentColor}">
                    ${iconSvg}
                </g>
            </g>

            <rect x="24" y="272" width="592" height="64" rx="10" fill="rgba(10, 11, 16, 0.92)" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1.2"/>
            <text x="320" y="312" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="-0.02em">${displayText.toUpperCase()}</text>
        </svg>`;
        return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    }

    const swordIcon = `<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M19 13l2 2-6 6-2-2"/>`;
    const houseIcon = `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`;
    const flameIcon = `<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>`;
    const heartIcon = `<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>`;
    const skullIcon = `<circle cx="12" cy="12" r="10"/><path d="M9 13h.01M15 13h.01M10 17h4"/>`;
    const targetIcon = `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`;
    const starIcon = `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`;
    const planeIcon = `<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>`;
    const cityIcon = `<path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h1M9 13h1M9 17h1M15 13h1M15 17h1"/>`;
    const shieldIcon = `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`;
    const globeIcon = `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`;
    const carIcon = `<rect x="3" y="11" width="18" height="7" rx="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M5 11l2-5h10l2 5"/>`;
    const ballIcon = `<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 0 0 20"/><path d="M2 12h20"/>`;
    const rocketIcon = `<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6.05 11a22.35 22.35 0 0 1-3.95 2z"/>`;

    const allGames = [
        // Recommended games from Roblox Home screenshot
        {
            place_id: 910001,
            name: "[LIMITED LIVERIES] Airline Manager:",
            creator: "Northwind Air",
            thumbnail_url: createCoverSvg("Airline Manager", "#0284c7", "#0c4a6e", "#38bdf8", planeIcon, "AIRBUS OR BOEING?"),
            playing: 14200,
            visits: 350000000,
            likes: 74000,
            dislikes: 26000,
            description: "Manage international flight corridors, buy legendary jet fleets, and design airports.",
            tags: ["trending", "recommended", "simulator"]
        },
        {
            place_id: 910002,
            name: "Brickline: City Builder",
            creator: "Brickline Interactive",
            thumbnail_url: createCoverSvg("Brickline City", "#047857", "#064e3b", "#34d399", cityIcon, "BUILD A REAL CITY"),
            playing: 28400,
            visits: 580000000,
            likes: 79000,
            dislikes: 21000,
            description: "Zone neighborhoods, manage transit networks, and watch your metropolitan city grow.",
            tags: ["trending", "recommended", "simulator"]
        },
        {
            place_id: 910003,
            name: "[🎃EVENT] Command An Army",
            creator: "Legion Games",
            thumbnail_url: createCoverSvg("Command An Army", "#991b1b", "#450a0a", "#f87171", shieldIcon, "COMMAND AN ARMY"),
            playing: 42100,
            visits: 890000000,
            likes: 94000,
            dislikes: 6000,
            description: "Lead legions of infantry, archers, and cavalry against monstrous bosses.",
            tags: ["trending", "recommended", "adventure"]
        },
        {
            place_id: 910004,
            name: "[🎃] Bey Rivals",
            creator: "Rival Spinning",
            thumbnail_url: createCoverSvg("Bey Rivals", "#1e40af", "#172554", "#60a5fa", starIcon, "BEY RIVALS"),
            playing: 31200,
            visits: 420000000,
            likes: 91000,
            dislikes: 9000,
            description: "Spin into high-energy arenas, upgrade special bit-beasts, and knock out competitors.",
            tags: ["trending", "recommended", "adventure"]
        },
        {
            place_id: 910005,
            name: "WarFront [PVP]",
            creator: "WarFront Studio",
            thumbnail_url: createCoverSvg("WarFront PVP", "#854d0e", "#422006", "#facc15", targetIcon, "WARFRONT [PVP]"),
            playing: 51200,
            visits: 1200000000,
            likes: 68000,
            dislikes: 32000,
            description: "Strategic territory control and military skirmishes across realistic battlefield maps.",
            tags: ["trending", "recommended", "adventure"]
        },
        {
            place_id: 910006,
            name: "Catalog Avatar Creator",
            creator: "ItsMuneeeb",
            is_ad: true,
            thumbnail_url: createCoverSvg("Avatar Creator", "#059669", "#064e3b", "#6ee7b7", starIcon, "CREATE YOUR DREAM OUTFIT!"),
            playing: 84000,
            visits: 4300000000,
            likes: 930000,
            dislikes: 70000,
            description: "Try on millions of community catalog items, test combos, and save avatars.",
            tags: ["trending", "recommended", "roleplay"]
        },
        {
            place_id: 910007,
            name: "Sell a Million Sushi",
            creator: "Sushi Tycoons",
            thumbnail_url: createCoverSvg("Sushi Tycoon", "#c2410c", "#7c2d12", "#fb923c", flameIcon, "SELL A MILLION SUSHI"),
            playing: 19800,
            visits: 310000000,
            likes: 98000,
            dislikes: 2000,
            description: "Roll delicious sushi conveyor belts, hire chefs, and reach the $1,000,000 sushi milestone.",
            tags: ["trending", "recommended", "simulator"]
        },
        {
            place_id: 910008,
            name: "Backseat Rally",
            creator: "Rally Works",
            thumbnail_url: createCoverSvg("Backseat Rally", "#b45309", "#78350f", "#fcd34d", carIcon, "BACKSEAT RALLY"),
            playing: 12500,
            visits: 190000000,
            likes: 91000,
            dislikes: 9000,
            description: "Dual-player rally simulator: driver speeds while the navigator directs the pace notes.",
            tags: ["trending", "recommended", "racing"]
        },
        {
            place_id: 910009,
            name: "[🌌] Build A Galaxy!",
            creator: "Cosmic Forge",
            thumbnail_url: createCoverSvg("Build A Galaxy", "#4c1d95", "#2e1065", "#c084fc", globeIcon, "BUILD A GALAXY!"),
            playing: 38400,
            visits: 760000000,
            likes: 96000,
            dislikes: 4000,
            description: "Fuse cosmic dust, ignite stars, form planetary orbits, and expand your own universe.",
            tags: ["trending", "recommended", "simulator"]
        },
        {
            place_id: 910010,
            name: "Run an Airline✈️",
            creator: "Aero Flight Sim",
            thumbnail_url: createCoverSvg("Run an Airline", "#0284c7", "#075985", "#7dd3fc", planeIcon, "RUN AN AIRLINE"),
            playing: 22100,
            visits: 490000000,
            likes: 90000,
            dislikes: 10000,
            description: "Fly commercial jets across realistic waypoints and manage passenger satisfaction.",
            tags: ["trending", "recommended", "simulator"]
        },
        {
            place_id: 910011,
            name: "HELLHOLE [ ☠️ ]",
            creator: "Void Studios",
            is_ad: true,
            thumbnail_url: createCoverSvg("Hellhole", "#18181b", "#09090b", "#94a3b8", skullIcon, "HELLHOLE [ ☠️ ]"),
            playing: 45000,
            visits: 980000000,
            likes: 98000,
            dislikes: 2000,
            description: "Survive freefall into a surreal atmospheric abyss filled with surreal hazards.",
            tags: ["trending", "recommended", "horror"]
        },
        {
            place_id: 910012,
            name: "[UPD] Come visit Pusheen",
            creator: "Cat Cafe World",
            thumbnail_url: createCoverSvg("Visit Pusheen", "#9a3412", "#431407", "#fdba74", heartIcon, "COME VISIT PUSHEEN"),
            playing: 5400,
            visits: 120000000,
            likes: 25000,
            dislikes: 75000,
            description: "Hangout in the charming Pusheen pastry cafe, make friends, and collect treats.",
            tags: ["trending", "recommended", "roleplay"]
        },

        // Continue section games from screenshot
        {
            place_id: 920001,
            name: "World of Nukes 💥",
            creator: "Atomic Games",
            thumbnail_url: createCoverSvg("World of Nukes", "#0284c7", "#0c4a6e", "#38bdf8", rocketIcon, "WORLD OF NUKES"),
            playing: 7700,
            visits: 140000000,
            likes: 91000,
            dislikes: 9000,
            description: "Silo management, defensive laser grids, and high-stakes bunker defense.",
            tags: ["playing", "continue", "adventure"]
        },
        {
            place_id: 920002,
            name: "مايك المغرب 🇲🇦 [Realism]",
            creator: "Morocco RP",
            thumbnail_url: createCoverSvg("Morocco Realism", "#991b1b", "#450a0a", "#f87171", houseIcon, "REALISTIC MOROCCO"),
            playing: 118,
            visits: 12000000,
            likes: 8500,
            dislikes: 1500,
            description: "Authentic cultural roleplay, historical Medina architectures, and neighborhood bazaars.",
            tags: ["playing", "continue", "roleplay"]
        },
        {
            place_id: 920003,
            name: "[NEW AIRPORT] Flightworld",
            creator: "Skyline Devs",
            thumbnail_url: createCoverSvg("Flightworld", "#0369a1", "#082f49", "#bae6fd", planeIcon, "FLIGHTWORLD"),
            playing: 2500,
            visits: 95000000,
            likes: 96000,
            dislikes: 4000,
            description: "Detailed cockpit controls, air traffic controller towers, and international routes.",
            tags: ["playing", "continue", "simulator"]
        },
        {
            place_id: 920004,
            name: "[PT.2🎃] Turbo Soccer : Beta",
            creator: "Turbo Sports",
            thumbnail_url: createCoverSvg("Turbo Soccer", "#15803d", "#14532d", "#86efac", ballIcon, "TURBO SOCCER"),
            playing: 8600,
            visits: 340000000,
            likes: 92000,
            dislikes: 8000,
            description: "Fast-paced physics arcade football with nitro boosters, bicycle kicks, and ranked divisions.",
            tags: ["playing", "continue", "sports"]
        },
        {
            place_id: 920005,
            name: "RoWorld [World PvP]",
            creator: "RoWorld Ops",
            thumbnail_url: createCoverSvg("RoWorld PVP", "#1e3a8a", "#172554", "#93c5fd", targetIcon, "ROWORLD PVP"),
            playing: 16700,
            visits: 620000000,
            likes: 83000,
            dislikes: 17000,
            description: "Global open-world survival with territory capture, factions, and clan wars.",
            tags: ["playing", "continue", "adventure"]
        },
        {
            place_id: 920006,
            name: "[PRIVATE SERVERS] Rail",
            creator: "Rail Universe",
            thumbnail_url: createCoverSvg("Rail Universe", "#0f766e", "#134e4a", "#5eead4", cityIcon, "RAIL UNIVERSE"),
            playing: 63,
            visits: 18000000,
            likes: 9100,
            dislikes: 900,
            description: "High-speed electric passenger and heavy freight rail networks across varied terrains.",
            tags: ["playing", "continue", "simulator"]
        },
        {
            place_id: 920007,
            name: "Counter Straik 1.6",
            creator: "Classic Shooters",
            thumbnail_url: createCoverSvg("Counter Straik", "#ca8a04", "#713f12", "#fde047", targetIcon, "COUNTER STRAIK"),
            playing: 12,
            visits: 42000000,
            likes: 6500,
            dislikes: 3500,
            description: "Faithful homage to the classic tactical FPS featuring iconic de_dust2 geometry.",
            tags: ["playing", "continue", "adventure"]
        },
        {
            place_id: 920008,
            name: "[SNAPDASH] Brawlbox",
            creator: "Brawl Boxers",
            thumbnail_url: createCoverSvg("Brawlbox", "#c026d3", "#701a75", "#f0abfc", starIcon, "BRAWLBOX"),
            playing: 80,
            visits: 24000000,
            likes: 8200,
            dislikes: 1800,
            description: "Open mystery brawl boxes, unlock rare champion fighters, and clash in 3v3 gem grabs.",
            tags: ["playing", "continue", "adventure"]
        },
        {
            place_id: 920009,
            name: "💥 Tank Game! [2.5]",
            creator: "Armored Battler",
            thumbnail_url: createCoverSvg("Tank Game", "#ea580c", "#7c2d12", "#fed7aa", flameIcon, "TANK GAME [2.5]"),
            playing: 4100,
            visits: 180000000,
            likes: 89000,
            dislikes: 11000,
            description: "Heavy armor ballistic warfare, custom camouflages, and destructible trench warfare.",
            tags: ["playing", "continue", "action"]
        },
        {
            place_id: 920010,
            name: "British Railway",
            creator: "UK Rail Network",
            thumbnail_url: createCoverSvg("British Railway", "#dc2626", "#7f1d1d", "#fca5a5", cityIcon, "BRITISH RAILWAY"),
            playing: 778,
            visits: 62000000,
            likes: 8700,
            dislikes: 1300,
            description: "Drive British passenger trains across historical countryside stations and London suburbs.",
            tags: ["playing", "continue", "simulator"]
        },
        {
            place_id: 920011,
            name: "[ZOMBIES!] BloxStrike",
            creator: "Strike Devs",
            thumbnail_url: createCoverSvg("BloxStrike", "#4338ca", "#312e81", "#a5b4fc", skullIcon, "BLOXSTRIKE"),
            playing: 18500,
            visits: 480000000,
            likes: 94000,
            dislikes: 6000,
            description: "Co-op round-based zombie apocalypse survival with wall weapons, perks, and mystery boxes.",
            tags: ["playing", "continue", "horror"]
        },
        {
            place_id: 920012,
            name: "$20 Draft for Soccer Cards!",
            creator: "Draft Masters",
            thumbnail_url: createCoverSvg("Soccer Draft", "#16a34a", "#14532d", "#86efac", ballIcon, "SOCCER DRAFT"),
            playing: 1600,
            visits: 72000000,
            likes: 9100,
            dislikes: 900,
            description: "Pack legendary player cards, assemble winning fantasy squads, and trade on the market.",
            tags: ["playing", "continue", "sports"]
        },

        // Classic flagship games
        {
            place_id: 2753915549,
            name: "Blox Fruits",
            creator: "Gamer Robot Inc",
            thumbnail_url: createCoverSvg("Blox Fruits", "#1e1b4b", "#0f172a", "#38bdf8", swordIcon, "BLOX FRUITS"),
            playing: 498200,
            visits: 39500000000,
            likes: 9140000,
            dislikes: 420000,
            description: "Welcome to Blox Fruits! Become a master swordsman or a powerful fruit user as you train to become the strongest warrior in the vast seas.",
            tags: ["trending", "playing", "adventure", "up-and-coming", "popular-worldwide"]
        },
        {
            place_id: 4924922222,
            name: "Brookhaven 🏡RP",
            creator: "Wolfpaq",
            thumbnail_url: createCoverSvg("Brookhaven RP", "#1c1917", "#0c0a09", "#f59e0b", houseIcon, "BROOKHAVEN RP"),
            playing: 392400,
            visits: 54200000000,
            likes: 8450000,
            dislikes: 820000,
            description: "A place to hangout with like minded people and roleplay. Own and live in amazing houses, drive cool vehicles and explore the city.",
            tags: ["trending", "playing", "roleplay", "popular-worldwide"]
        },
        {
            place_id: 8737899170,
            name: "Pet Simulator 99!",
            creator: "BIG Games Pets",
            thumbnail_url: createCoverSvg("Pet Simulator 99", "#1e293b", "#0f172a", "#ec4899", heartIcon, "PET SIMULATOR 99!"),
            playing: 184500,
            visits: 5120000000,
            likes: 2480000,
            dislikes: 120000,
            description: "Explore worlds, hatch massive eggs, discover secrets, and collect hundreds of huge unique pets in the ultimate simulator.",
            tags: ["trending", "playing", "simulator", "up-and-coming", "top-rated"]
        },
        {
            place_id: 1537690962,
            name: "Dress to Impress",
            creator: "DTI Fashion Studio",
            thumbnail_url: createCoverSvg("Dress to Impress", "#3b0764", "#18022d", "#f472b6", starIcon, "DRESS TO IMPRESS"),
            playing: 172000,
            visits: 4200000000,
            likes: 3100000,
            dislikes: 160000,
            description: "Show off your style on the runway! Compete in themed fashion shows, customize outfits, and climb the fashion ranks to Top Model.",
            tags: ["trending", "playing", "up-and-coming", "popular-worldwide"]
        },
        {
            place_id: 13772394625,
            name: "Blade Ball",
            creator: "Wiggity",
            thumbnail_url: createCoverSvg("Blade Ball", "#450a0a", "#1a0404", "#ef4444", flameIcon, "BLADE BALL"),
            playing: 145000,
            visits: 6800000000,
            likes: 3950000,
            dislikes: 210000,
            description: "Focus, timing, and strategy. A deflectable homing ball tracks players at increasing speeds. Unlock abilities, customize swords, and survive.",
            tags: ["trending", "playing", "adventure", "top-rated"]
        },
        {
            place_id: 6516141723,
            name: "Doors 👁️",
            creator: "LSPLASH",
            thumbnail_url: createCoverSvg("Doors", "#18181b", "#09090b", "#a855f7", skullIcon, "DOORS"),
            playing: 98400,
            visits: 5850000000,
            likes: 4700000,
            dislikes: 190000,
            description: "A roguelite horror experience involving mysterious hotel rooms, entities lurking in dark corners, and atmospheric puzzles.",
            tags: ["trending", "horror", "adventure", "top-rated", "recommended"]
        }
    ];

    // Friends list from user screenshot
    const friendsList = [
        { name: "ninnie", avatarColor: "#f472b6", status: "online", game: "Blox Fruits" },
        { name: "amine", avatarColor: "#f59e0b", status: "online", game: "Sell a Million Sushi" },
        { name: "shaoline", avatarColor: "#38bdf8", status: "online", game: "Command An Army" },
        { name: "yassinnn", avatarColor: "#4ade80", status: "online", game: "Brookhaven 🏡RP" },
        { name: "zai", avatarColor: "#a855f7", status: "online", game: "Blade Ball" },
        { name: "coinbase", avatarColor: "#e2e8f0", status: "online", game: "Airline Manager" },
        { name: "Noufa_161", avatarColor: "#fb7185", status: "online", game: "Pet Simulator 99!" },
        { name: "MHD3334445", avatarColor: "#60a5fa", status: "online", game: "World of Nukes 💥" },
        { name: "fraud", avatarColor: "#cbd5e1", status: "online", game: "Doors 👁️" },
        { name: "Jelly", avatarColor: "#f43f5e", status: "online", game: "Bey Rivals" },
        { name: "SFHANINAT9WD", avatarColor: "#94a3b8", status: "online", game: "WarFront [PVP]" },
        { name: "adragonmaker", avatarColor: "#fbbf24", status: "online", game: "Build A Galaxy!" },
        { name: "awsmzayn", avatarColor: "#34d399", status: "online", game: "Brickline City" }
    ];

    // Core invoke handler
    async function invoke(cmd, args = {}) {
        await new Promise((r) => setTimeout(r, 20));

        switch (cmd) {
            case "get_friends":
                return [...friendsList];

            case "get_dashboard":
                return {
                    live_players: "1.8M",
                    sorts_loaded: 8,
                    largest_game: "Blox Fruits",
                    largest_players: 498200
                };

            case "get_sorts":
                return [
                    { id: "top-trending", display_name: "Top Trending" },
                    { id: "top-playing-now", display_name: "Playing Now" },
                    { id: "up-and-coming", display_name: "Up and Coming" },
                    { id: "popular-worldwide", display_name: "Popular Worldwide" },
                    { id: "top-rated", display_name: "Top Rated" },
                    { id: "anime-action", display_name: "Anime & Action" },
                    { id: "horror-survival", display_name: "Horror & Survival" },
                    { id: "recommended", display_name: "Recommended" },
                    { id: "roleplay", display_name: "Roleplay" },
                    { id: "adventure", display_name: "Adventure & Action" }
                ];

            case "get_sort_games": {
                const sortId = args.sortId || "top-trending";
                let list = allGames;
                if (sortId === "top-trending") {
                    const rec = allGames.filter((g) => g.tags.includes("recommended"));
                    list = rec.length ? rec.slice(0, 12) : allGames.filter((g) => g.tags.includes("trending")).slice(0, 12);
                } else if (sortId === "top-playing-now") {
                    const cont = allGames.filter((g) => g.tags.includes("continue"));
                    list = cont.length ? cont.slice(0, 12) : [...allGames].sort((a, b) => b.playing - a.playing).slice(0, 12);
                } else if (sortId === "up-and-coming") {
                    list = allGames.filter((g) => g.tags.includes("up-and-coming"));
                } else if (sortId === "top-rated") {
                    list = allGames.filter((g) => g.tags.includes("top-rated"));
                } else if (sortId === "anime-action") {
                    list = allGames.filter((g) => g.tags.some((t) => ["anime", "action", "adventure", "trending"].includes(t)));
                } else if (sortId === "horror-survival") {
                    list = allGames.filter((g) => g.tags.some((t) => ["horror", "survival"].includes(t)));
                } else if (sortId === "roleplay") {
                    list = allGames.filter((g) => g.tags.includes("roleplay"));
                } else if (sortId === "adventure") {
                    list = allGames.filter((g) => g.tags.includes("adventure"));
                }
                return { games: list.length ? list : allGames.slice(0, 8) };
            }

            case "search_games": {
                const q = (args.query || "").toLowerCase().trim();
                if (!q) return { games: [] };
                const filtered = allGames.filter((g) =>
                    g.name.toLowerCase().includes(q) ||
                    g.creator.toLowerCase().includes(q) ||
                    g.tags.some((t) => t.includes(q)) ||
                    (g.description && g.description.toLowerCase().includes(q))
                );
                return { games: filtered };
            }

            case "launch_game": {
                isGameRunning = true;
                runningGame = allGames.find((g) => g.place_id === args.placeId) || {
                    place_id: args.placeId,
                    name: args.gameName || "Roblox Experience"
                };

                // Trigger the Tauri event 'game-embedded' after docking simulation
                setTimeout(() => {
                    emit("game-embedded", { placeId: args.placeId, gameName: runningGame.name });
                }, 750);

                return {
                    ok: true,
                    stage: "ready",
                    message: `Attached to ${runningGame.name} (pid 51842)`
                };
            }

            case "game_status":
                return {
                    embedded: isGameRunning,
                    alive: isGameRunning,
                    name: runningGame ? runningGame.name : "None",
                    pid: isGameRunning ? 51842 : 0
                };

            case "set_layout":
                return { ok: true };

            case "detach_game":
                isGameRunning = false;
                runningGame = null;
                return { ok: true };

            case "connect_discord":
                return "Connected to Discord RPC (Rich Presence Active)";

            case "update_presence":
                return { ok: true };

            case "get_mods":
                return [...modsState];

            case "toggle_mod": {
                const target = modsState.find((m) => m.id === args.modId);
                if (target) {
                    target.enabled = !!args.enabled;
                }
                return { ok: true };
            }

            case "pick_mod_file": {
                const newMod = {
                    id: "mod-" + Date.now(),
                    name: "User Texture Shader Pack",
                    category: "Visuals",
                    description: "Custom ambient occlusion and specular post-processing maps",
                    file_path: "mods/user_shader_v1.rbxm",
                    enabled: true
                };
                modsState.push(newMod);
                return newMod.file_path;
            }

            case "get_settings":
                return { ...settingsState };

            case "save_settings":
                if (args.settings) {
                    settingsState = { ...settingsState, ...args.settings };
                }
                return { ok: true };

            case "get_fastflags":
                return [...fastFlagsState];

            case "save_fastflags":
                if (Array.isArray(args.flags)) {
                    fastFlagsState = [...args.flags];
                }
                return { ok: true };

            case "apply_fastflags":
                return { ok: true };

            case "get_cookie_status":
                return {
                    linked: cookieLinked,
                    username: cookieLinked ? (cookieUsername || "RustloxUser") : null
                };

            case "save_cookie":
                if (args.cookie) {
                    cookieLinked = true;
                    cookieUsername = "RustloxPlayer";
                    return undefined; // main.js expects undefined on success
                }
                return "Invalid cookie format";

            case "clear_cookie":
                cookieLinked = false;
                cookieUsername = null;
                return { ok: true };

            case "get_cache_info":
                return { ...cacheState };

            case "clear_cache":
                if (Array.isArray(args.targets)) {
                    cacheState.entries = cacheState.entries.filter((e) => !args.targets.includes(e.name));
                    cacheState.total_size_mb = cacheState.entries.reduce((acc, curr) => acc + curr.size_mb, 0);
                }
                return { ok: true };

            case "get_system_info":
                return {
                    hostname: "rustlox-workstation",
                    os_name: "Linux (x86_64)",
                    os_version: "Kernel 6.6.137+",
                    cpu_usage: 14.8,
                    used_memory: 6442450944,
                    total_memory: 17179869184,
                    memory_usage_percent: 37.5
                };

            case "get_roblox_process_info":
                if (!isGameRunning) return null;
                return {
                    pid: 51842,
                    name: "RobloxPlayerBeta",
                    cpu_usage: 11.2,
                    memory_usage_mb: 846,
                    status: "Active & Rendering"
                };

            default:
                console.warn(`[Rustlox Shim] Unhandled Tauri command: "${cmd}"`, args);
                return null;
        }
    }

    // Expose window.__TAURI__
    window.__TAURI__ = {
        core: { invoke },
        event: { listen, emit }
    };

    console.info("[Rustlox] Tauri shim loaded successfully.");
})();
