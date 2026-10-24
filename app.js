const STORAGE_KEY = "rv-season-v1";
const SCORING_PROFILE_KEY = "rv-standard-scoring-profiles-v1";
const FINALE_START = 20;
const namesForDemo = [
  "Crimson", "Cobalt", "Marigold", "Violet", "Mint", "Coral", "Indigo", "Saffron",
  "Rose Quartz", "Ocean Fade", "Sunset Fade", "Aurora Bloom", "Moss Gradient", "Dusk Blend",
  "Prism Study", "Neon Dream", "Glacier", "Peach Fuzz", "Starfield", "Lime Light",
];
const eventFormats = window.RV_EVENT_CATALOG;
const seasonSetup = window.RV_SEASON_SETUP;
const seasonRules = window.RV_SEASON_RULES;
const eventEngine = window.RV_EVENT_ENGINE;
const supabaseService = window.RV_SUPABASE;
const { eurovisionBallot, eurovisionPoints, eurovisionVector, randomOrder, rankResults, setBingoEndCall } = eventEngine;
const countryDataPromises = new Map();
const palettes = [
  ["#f4bc67", "#bb563c"], ["#74dbca", "#326997"], ["#cf90f5", "#644abd"],
  ["#f77f9f", "#b84465"], ["#f3df68", "#839a43"], ["#87abff", "#5551ac"],
  ["#ef9e5a", "#6f4764"], ["#91d773", "#277a6a"], ["#a6e3ff", "#5373ae"],
  ["#ff8177", "#6b399b"], ["#a7e76f", "#227f9a"], ["#f8bbd0", "#5546a3"],
];
const $ = (selector) => document.querySelector(selector);
let state = null;
let seasonArchive = [];
let userLibrary = [];
let colorLibrary = [];
let rosterDraft = [];
let renameTargetId = null;
let supabaseConfigured = false;
let authUser = null;
let pointSystemCache = [];
let authMode = "signin";
let cloudSavePending = false;
let toastTimer = 0;
let selectedStandaloneEvent = eventFormats[0];
let standaloneRunner = null;

function defaultAppearance(index, colorName = "") {
  const identitySeed = [...colorName].reduce((sum, character) => sum + character.charCodeAt(0), index);
  const paletteIndex = identitySeed % palettes.length;
  const [solidHex, gradientStart, gradientEnd] = [palettes[paletteIndex][0], palettes[paletteIndex][0], palettes[paletteIndex][1]];
  const kind = ["color", "gradient", "image"][index % 3];
  return {
    colorName,
    kind,
    solidHex,
    gradientStart,
    gradientEnd,
    imageData: "",
    paletteIndex,
  };
}

function seedLibraries() {
  userLibrary = namesForDemo.map((colorName, index) => ({
    id: `test-user-${index + 1}`,
    username: colorName,
    lastColor: colorName,
    colorNames: [colorName],
  }));
  colorLibrary = namesForDemo.map((colorName, index) => ({
    id: `test-color-${index + 1}`,
    name: colorName,
    ...defaultAppearance(index, colorName),
  }));
}

function makeDemoRoster() {
  return namesForDemo.map((colorName, index) => ({
    userId: userLibrary[index].id,
    username: userLibrary[index].username,
    colorId: colorLibrary[index].id,
    colorName,
    kind: colorLibrary[index].kind,
    solidHex: colorLibrary[index].solidHex,
    gradientStart: colorLibrary[index].gradientStart,
    gradientEnd: colorLibrary[index].gradientEnd,
    imageData: "",
  }));
}

function createSeason(name, roster, finaleFormat, seasonType = "standard", hostName = "", pointSchedules = null) {
  const eventLimit = seasonSetup.eventLimit(seasonType, finaleFormat);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name,
    seasonType,
    finaleFormat,
    hostName,
    pointSchedules,
    eventLimit,
    players: roster.map((entrant, index) => {
      return {
        id: entrant.userId,
        userId: entrant.userId,
        username: entrant.username,
        name: entrant.username,
        colorId: entrant.colorId,
        colorName: entrant.colorName,
        appearance: {
          kind: entrant.kind,
          solidHex: entrant.solidHex,
          gradientStart: entrant.gradientStart,
          gradientEnd: entrant.gradientEnd,
          imageData: entrant.imageData,
          paletteIndex: index % palettes.length,
        },
        points: 0,
        medals: { gold: 0, silver: 0, bronze: 0 },
        wins: 0,
        stageWins: 0,
        stagePoints: 0,
        active: true,
        playoffQualified: true,
      };
    }),
    history: [],
    nextEvent: 1,
    completed: false,
    winnerId: null,
  };
}

function demoSeason() {
  return createSeason("Season 01", makeDemoRoster(), "single");
}

function emptySeason() {
  return createSeason("Season 01", [], "single");
}

function pointSystemMap() {
  return Object.fromEntries(pointSystemCache.map((profile) => [profile.name.trim().toLocaleLowerCase(), profile]));
}

async function refreshPointSystems() {
  pointSystemCache = await supabaseService.loadPointSystems();
}

async function loadSharedCatalog() {
  const config = window.RV_SUPABASE_CONFIG ?? {};
  supabaseConfigured = Boolean(config.url && config.publishableKey);
  if (!supabaseConfigured) {
    const message = "Supabase is not configured yet. The current user/color suggestions are test-only and reset on reload.";
    $("#library-status").textContent = message;
    $("#library-page-status").textContent = `${message} Shared storage and account-based host editing are scaffolded for the next setup step.`;
    return;
  }
  try {
    const headers = { apikey: config.publishableKey };
    const base = config.url.replace(/\/$/, "");
    const [usersResponse, colorsResponse, userColorsResponse] = await Promise.all([
      fetch(`${base}/rest/v1/rv_users?select=id,username&order=username.asc`, { headers }),
      fetch(`${base}/rest/v1/rv_colors?select=id,name,kind,solid_hex,gradient_start,gradient_end,image_path&order=name.asc`, { headers }),
      fetch(`${base}/rest/v1/rv_user_colors?select=user_id,color_id,created_at&order=created_at.desc`, { headers }),
    ]);
    if (!usersResponse.ok || !colorsResponse.ok || !userColorsResponse.ok) {
      throw new Error(`Catalog request failed (users ${usersResponse.status}, colors ${colorsResponse.status}, user colors ${userColorsResponse.status}).`);
    }
    const [users, colors, userColors] = await Promise.all([usersResponse.json(), colorsResponse.json(), userColorsResponse.json()]);
    userLibrary = users;
    colorLibrary = colors.map((color) => ({
      ...color,
      solidHex: color.solid_hex,
      gradientStart: color.gradient_start,
      gradientEnd: color.gradient_end,
      imageUrl: color.image_path ? `${base}/storage/v1/object/public/rv-color-backgrounds/${color.image_path.split("/").map(encodeURIComponent).join("/")}` : "",
    }));
    const colorById = new Map(colorLibrary.map((color) => [color.id, color]));
    for (const link of userColors) {
      const user = userLibrary.find((entry) => entry.id === link.user_id);
      const colorName = colorById.get(link.color_id)?.name;
      if (user && colorName) {
        user.colorNames ??= [];
        if (!user.colorNames.includes(colorName)) user.colorNames.push(colorName);
        user.lastColor ??= colorName;
      }
    }
    const status = `${userLibrary.length} shared users and ${colorLibrary.length} reusable colors loaded. Shared catalog editing is limited to approved RV hosts.`;
    $("#library-status").textContent = status;
    $("#library-page-status").textContent = status;
    updateLibrarySuggestions();
    renderUserLibrary();
  } catch (error) {
    console.error("Could not load the shared RV catalog.", error);
    const message = `Supabase is configured, but the shared library could not load: ${error.message}`;
    $("#library-status").textContent = message;
    $("#library-page-status").textContent = message;
    showToast(message, true);
  }
}

function updateLibrarySuggestions() {
  $("#user-library").innerHTML = userLibrary.map((user) => `<option value="${escapeHtml(user.username)}"></option>`).join("");
  $("#color-library").innerHTML = colorLibrary.map((color) => `<option value="${escapeHtml(color.name)}"></option>`).join("");
}

function renderUserLibrary() {
  const list = $("#profile-library-list");
  $("#user-library-count").textContent = `${userLibrary.length} USER${userLibrary.length === 1 ? "" : "S"}`;
  if (!userLibrary.length) {
    list.innerHTML = '<div class="history-empty">No returning users in the library yet.</div>';
    return;
  }
  list.innerHTML = userLibrary.map((user) => `
    <article class="profile-library-row">
      <span class="profile-library-name">${escapeHtml(user.username)}</span>
      <span class="profile-library-color">${escapeHtml((user.colorNames ?? [user.lastColor]).filter(Boolean).join(", ") || "Choose a color for this season")}</span>
      <button class="button button-outline rename-user" type="button" data-rename-id="${escapeHtml(user.id)}" ${supabaseConfigured ? "disabled" : ""}>Rename</button>
    </article>`).join("");
}

function makeRosterEntry(index) {
    const colorName = supabaseConfigured
      ? colorLibrary[index]?.name ?? `Color ${String(index + 1).padStart(2, "0")}`
      : index < namesForDemo.length ? namesForDemo[index] : `Color ${String(index + 1).padStart(2, "0")}`;
    const appearance = colorLibrary.find((color) => color.name.toLocaleLowerCase() === colorName.toLocaleLowerCase())
      ?? defaultAppearance(index, colorName);
    return {
      username: userLibrary[index]?.username ?? `Player ${String(index + 1).padStart(2, "0")}`,
      colorName,
      kind: appearance.kind === "image" && !appearance.imageUrl ? "color" : appearance.kind ?? "color",
      solidHex: appearance.solidHex ?? appearance.solid_hex ?? "#d4f46a",
      gradientStart: appearance.gradientStart ?? appearance.gradient_start ?? "#74dbca",
      gradientEnd: appearance.gradientEnd ?? appearance.gradient_end ?? "#326997",
      imageUrl: appearance.imageUrl ?? "",
      imageData: "",
    };
}

function createUserId() {
    return `rv-user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function resolveRosterIdentities(roster) {
    return roster.map((entrant, index) => {
      let user = userLibrary.find((entry) => entry.username.toLocaleLowerCase() === entrant.username.toLocaleLowerCase());
      if (!user) {
        user = { id: createUserId(), username: entrant.username, lastColor: entrant.colorName, colorNames: [entrant.colorName] };
        userLibrary.push(user);
      } else {
        user.lastColor = entrant.colorName;
        user.colorNames ??= [];
        if (!user.colorNames.includes(entrant.colorName)) user.colorNames.push(entrant.colorName);
      }
      entrant.username = user.username;
      let color = colorLibrary.find((entry) => entry.name.toLocaleLowerCase() === entrant.colorName.toLocaleLowerCase());
      if (!color) {
        color = { id: `rv-color-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`, name: entrant.colorName, ...entrant };
        colorLibrary.push(color);
      } else {
        Object.assign(color, entrant);
      }
      return {
        ...entrant,
        userId: user.id,
        colorId: color.id,
      };
    });
}

function renderRosterEditor(count, previousDraft = rosterDraft) {
    const roster = Array.from({ length: count }, (_, index) => previousDraft[index] ?? makeRosterEntry(index));
    rosterDraft = roster;
    $("#roster-editor").innerHTML = roster.map((entrant, index) => `
      <fieldset class="roster-entry">
        <legend>PARTICIPANT ${String(index + 1).padStart(2, "0")}</legend>
        <div class="roster-entry-grid">
          <label class="roster-field"><span>USERNAME</span><input class="text-input" data-roster-field="username" list="user-library" maxlength="32" value="${escapeHtml(entrant.username)}" required></label>
          <label class="roster-field"><span>COLOR NAME</span><input class="text-input" data-roster-field="colorName" list="color-library" maxlength="32" value="${escapeHtml(entrant.colorName)}" required></label>
          <label class="roster-field"><span>BACKGROUND TYPE</span><select class="text-input" data-roster-field="kind"><option value="color"${entrant.kind === "color" ? " selected" : ""}>Solid color</option><option value="gradient"${entrant.kind === "gradient" ? " selected" : ""}>Gradient</option><option value="image"${entrant.kind === "image" ? " selected" : ""}>Image</option></select></label>
          <label class="roster-field roster-solid"${entrant.kind === "color" ? "" : " hidden"}><span>HEX COLOR</span><span class="hex-control"><input class="text-input hex-text" data-roster-field="solidHex" maxlength="7" value="${escapeHtml(entrant.solidHex)}"><input type="color" data-color-picker="solidHex" value="${escapeHtml(entrant.solidHex)}" aria-label="Pick solid background color"></span></label>
          <label class="roster-field roster-gradient"${entrant.kind === "gradient" ? "" : " hidden"}><span>GRADIENT START</span><span class="hex-control"><input class="text-input hex-text" data-roster-field="gradientStart" maxlength="7" value="${escapeHtml(entrant.gradientStart)}"><input type="color" data-color-picker="gradientStart" value="${escapeHtml(entrant.gradientStart)}" aria-label="Pick gradient start color"></span></label>
          <label class="roster-field roster-gradient"${entrant.kind === "gradient" ? "" : " hidden"}><span>GRADIENT END</span><span class="hex-control"><input class="text-input hex-text" data-roster-field="gradientEnd" maxlength="7" value="${escapeHtml(entrant.gradientEnd)}"><input type="color" data-color-picker="gradientEnd" value="${escapeHtml(entrant.gradientEnd)}" aria-label="Pick gradient end color"></span></label>
          <label class="roster-field roster-image"${entrant.kind === "image" ? "" : " hidden"}><span>BACKGROUND IMAGE · MAX 10 MB</span><input class="text-input image-input" type="file" data-roster-field="imageFile" accept="image/png,image/jpeg,image/webp,image/gif"></label>
        </div>
      </fieldset>`).join("");
    updateLibrarySuggestions();
}

function readRosterDraftFromForm() {
    return Promise.all([...$("#roster-editor").querySelectorAll(".roster-entry")].map(async (row, index) => {
      const value = (field) => row.querySelector(`[data-roster-field="${field}"]`)?.value ?? "";
      const imageInput = row.querySelector('[data-roster-field="imageFile"]');
      let imageData = rosterDraft[index]?.imageData ?? "";
      const file = imageInput?.files?.[0];
      if (file) {
        if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
          throw new Error(`Participant ${index + 1}: choose a JPEG, PNG, WebP, or GIF image.`);
        }
        if (file.size > 10 * 1024 * 1024) throw new Error(`Participant ${index + 1}: image must be 10 MB or smaller.`);
        imageData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () => resolve(String(reader.result)));
          reader.addEventListener("error", () => reject(new Error(`Participant ${index + 1}: image could not be read.`)));
          reader.readAsDataURL(file);
        });
      }
      return {
        username: value("username").trim(),
        colorName: value("colorName").trim(),
        kind: value("kind"),
        solidHex: value("solidHex"),
        gradientStart: value("gradientStart"),
        gradientEnd: value("gradientEnd"),
        imageUrl: rosterDraft[index]?.imageUrl ?? "",
        imageData,
      };
    }));
}

function findColorByName(name) {
    return colorLibrary.find((color) => color.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
}

function toHexColor(name) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "";
    context.fillStyle = "#010203";
    context.fillStyle = name.trim();
    const parsed = context.fillStyle;
    if (parsed === "#010203" && name.trim().toLowerCase() !== "#010203") return "";
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function syncDraftRow(row) {
    const index = [...$("#roster-editor").querySelectorAll(".roster-entry")].indexOf(row);
    if (index < 0) return;
    for (const input of row.querySelectorAll("[data-roster-field]")) {
      if (input.type === "file") continue;
      rosterDraft[index][input.dataset.rosterField] = input.value;
    }
}

function showRosterAppearance(row, kind) {
    row.querySelectorAll(".roster-solid").forEach((item) => { item.hidden = kind !== "color"; });
    row.querySelectorAll(".roster-gradient").forEach((item) => { item.hidden = kind !== "gradient"; });
    row.querySelectorAll(".roster-image").forEach((item) => { item.hidden = kind !== "image"; });
}

function renameUser(userId) {
    const user = userLibrary.find((entry) => entry.id === userId);
    if (!user || supabaseConfigured) return;
    renameTargetId = userId;
    $("#rename-username").value = user.username;
    $("#rename-error").textContent = "";
    $("#rename-modal").showModal();
}

function saveRenamedUser(username) {
    const user = userLibrary.find((entry) => entry.id === renameTargetId);
    const nextName = username.trim();
    if (!user || !nextName) return "Enter a username.";
    if (userLibrary.some((entry) => entry.id !== user.id && entry.username.toLocaleLowerCase() === nextName.toLocaleLowerCase())) {
      return "That username is already in the user library.";
    }
    $("#rename-username").dataset.previousName = user.username;
    user.username = nextName;
    const renameInSeason = (season) => {
      for (const player of season.players) {
        if (player.userId !== user.id) continue;
        player.username = nextName;
        player.name = nextName;
      }
      for (const event of season.history) {
        for (const result of event.results) {
          if (result.id === user.id) result.name = nextName;
        }
      }
    };
    renameInSeason(state);
    seasonArchive.forEach(renameInSeason);
    rosterDraft.forEach((entry) => {
      const oldName = $("#rename-username").dataset.previousName;
      if (entry.username === oldName) entry.username = nextName;
    });
    $("#rename-modal").close();
    render();
    renderArchiveList();
    renderUserLibrary();
    return "";
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3800);
}

function loadSeason() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Could not clear the previous RV test season.", error);
    showToast("Browser storage could not be cleared. This test season will still start fresh.", true);
  }
  return demoSeason();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function loadScoringProfiles() {
  if (authUser && supabaseConfigured) return pointSystemMap();
  const raw = window.localStorage.getItem(SCORING_PROFILE_KEY);
  if (!raw) return {};
  let profiles;
  try {
    profiles = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Saved host scoring data is not valid JSON: ${error.message}`);
  }
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    throw new Error("Saved host scoring data has an invalid format.");
  }
  for (const [key, profile] of Object.entries(profiles)) {
    if (!profile || typeof profile.name !== "string" || !Array.isArray(profile.pointSchedules)
      || profile.pointSchedules.some((table) => !Array.isArray(table)
        || table.some((point) => !Number.isInteger(point) || point < 0))) {
      throw new Error(`Saved point system "${key}" is incomplete or invalid.`);
    }
  }
  return profiles;
}

async function saveScoringProfile(name, profile) {
  const key = name.trim().toLocaleLowerCase();
  if (!key) throw new Error("A point-system name is required.");
  if (authUser && supabaseConfigured) {
    await supabaseService.savePointSystem({
      ...profile,
      name: name.trim(),
      creatorName: authUser.user_metadata?.username ?? "RV Host",
    });
    await refreshPointSystems();
    return;
  }
  if (supabaseConfigured) throw new Error("Sign in before saving a shared point system.");
  const profiles = Object.assign(Object.create(null), loadScoringProfiles());
  profiles[key] = {
    ...profile,
    savedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(SCORING_PROFILE_KEY, JSON.stringify(profiles));
}

async function saveSeasonToCloud(season = state, quiet = false) {
  if (!supabaseConfigured || !season?.id) return;
  if (!authUser) throw new Error("Sign in before saving season progress.");
  try {
    await supabaseService.uploadSeasonImages(season);
    await supabaseService.saveSeason(season);
    cloudSavePending = false;
  } catch (error) {
    cloudSavePending = true;
    console.error("Could not save the RV season to Supabase.", error);
    if (!quiet) showToast(`Season save failed: ${error.message}`, true);
    const drawButton = $("#draw-button");
    if (drawButton) {
      drawButton.disabled = false;
      drawButton.innerHTML = `<span class="button-dice">↻</span> Retry cloud save`;
    }
    throw error;
  }
}

function renderAccountControl() {
  const username = authUser?.user_metadata?.username;
  $("#auth-button").hidden = Boolean(authUser);
  $("#auth-button").title = supabaseConfigured ? "" : "Configure Supabase to enable accounts";
  $("#account-menu").hidden = !authUser;
  $("#account-username").textContent = username ?? authUser?.email ?? "Account";
}

function setAuthMode(mode) {
  authMode = mode;
  const signingUp = mode === "signup";
  const recovering = mode === "recovery";
  $("#auth-title").innerHTML = `${recovering ? "Reset password" : signingUp ? "Create account" : "Sign in"}<span class="heading-period">.</span>`;
  $("#auth-description").textContent = recovering
    ? "Choose a new password for your account."
    : signingUp
      ? "Create a public host username and RV account. Email confirmation is disabled; you’ll be signed in after signup."
      : "Sign in to save your seasons and access the shared points library. Password recovery by email is unavailable until email delivery is configured.";
  $("#auth-username-label").hidden = !signingUp;
  $("#auth-username").hidden = !signingUp;
  $("#auth-username").required = signingUp;
  $("#auth-confirm-label").hidden = !signingUp || recovering;
  $("#auth-confirm-password").hidden = !signingUp || recovering;
  $("#auth-confirm-password").required = signingUp;
  $("#auth-password").autocomplete = signingUp || recovering ? "new-password" : "current-password";
  $("#auth-password").required = mode !== "reset-sent";
  $("#auth-password").hidden = mode === "reset-sent";
  $("#auth-confirm-password").hidden = !(signingUp || recovering);
  $("#auth-confirm-label").hidden = !(signingUp || recovering);
  $("#auth-confirm-password").required = signingUp || recovering;
  $("#auth-forgot-password").hidden = signingUp || recovering || mode === "reset-sent";
  $("#auth-mode-toggle").hidden = recovering || mode === "reset-sent";
  $("#auth-mode-toggle").textContent = signingUp ? "Back to sign in" : "Create account";
  $("#auth-submit").textContent = recovering ? "Save new password" : signingUp ? "Sign up" : mode === "reset-sent" ? "Close" : "Sign in";
  $("#auth-submit").hidden = mode === "reset-sent";
  $("#auth-message").textContent = "";
  $("#auth-password").value = "";
  $("#auth-confirm-password").value = "";
}

function openAuth(mode = "signin") {
  if (!supabaseConfigured) {
    showToast("Add the Supabase project URL and publishable key to enable accounts.", true);
    return;
  }
  setAuthMode(mode);
  if (!$("#auth-modal").open) $("#auth-modal").showModal();
}

async function applyAuthSession(session) {
  const nextUser = session?.user ?? null;
  authUser = nextUser;
  renderAccountControl();
  if (authUser) {
    const [savedSeasons] = await Promise.all([
      supabaseService.loadSeasons(),
      refreshPointSystems(),
    ]);
    const currentSeason = savedSeasons.find((season) => !season.completed) ?? emptySeason();
    try {
      await supabaseService.hydrateSeasonImages([currentSeason]);
    } catch (error) {
      console.error("Could not refresh a season background image URL.", error);
      showToast(`A season background could not be loaded: ${error.message}`, true);
    }
    state = currentSeason;
    seasonArchive = savedSeasons.filter((season) => season.id !== currentSeason.id);
    renderUserLibrary();
    render();
    renderArchiveList();
    if (!currentSeason.players.length) {
      $("#event-notice").textContent = "Create a season to save your first event.";
    }
    return;
  }
  pointSystemCache = [];
  seasonArchive = [];
  state = supabaseConfigured ? emptySeason() : demoSeason();
  if (!supabaseConfigured) seedLibraries();
  renderUserLibrary();
  render();
  renderArchiveList();
}

async function initializeAccount() {
  try {
    supabaseConfigured = Boolean(supabaseService.initialize());
    renderAccountControl();
    if (!supabaseConfigured) {
      seedLibraries();
      state = loadSeason();
      render();
      renderUserLibrary();
      return;
    }
    const session = await supabaseService.getSession();
    await applyAuthSession(session);
    supabaseService.onAuthStateChange((event, nextSession) => {
      window.setTimeout(() => {
        if (event === "PASSWORD_RECOVERY") {
          setAuthMode("recovery");
          $("#auth-email").value = nextSession?.user?.email ?? "";
          if (!$("#auth-modal").open) $("#auth-modal").showModal();
        }
        applyAuthSession(nextSession).catch((error) => {
          console.error("Could not load this account's RV data.", error);
          showToast(`Account data could not be loaded: ${error.message}`, true);
        });
      }, 0);
    });
  } catch (error) {
    console.error("Could not initialize Supabase account support.", error);
    showToast(`Account setup failed: ${error.message}`, true);
  }
}

async function submitAuthForm(event) {
  event.preventDefault();
  const submit = $("#auth-submit");
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const username = $("#auth-username").value.trim();
  $("#auth-message").textContent = "";
  submit.disabled = true;
  try {
    if (authMode === "signup") {
      if (!username || username.length < 3) throw new Error("Choose a public username at least 3 characters long.");
      if (password !== $("#auth-confirm-password").value) throw new Error("The passwords do not match.");
      const { session } = await supabaseService.signUp(email, password, username);
      if (session) {
        $("#auth-modal").close();
        showToast("Account created and signed in.");
      } else {
        setAuthMode("reset-sent");
        $("#auth-message").textContent = "Check your email for a confirmation link. You can sign in after confirming your address.";
      }
    } else if (authMode === "recovery") {
      if (password !== $("#auth-confirm-password").value) throw new Error("The passwords do not match.");
      await supabaseService.updatePassword(password);
      $("#auth-modal").close();
      showToast("Your password has been updated.");
    } else if (authMode === "reset-sent") {
      $("#auth-modal").close();
    } else {
      await supabaseService.signIn(email, password);
      $("#auth-modal").close();
    }
  } catch (error) {
    $("#auth-message").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

function getEventFormat(mechanic = state.selectedMechanic) {
  return eventFormats.find((format) => format.mechanic === mechanic) ?? eventFormats[0];
}

function defaultPointTable(eventNumber, participantCount, finaleFormat) {
  const boundedEvent = Math.max(1, Math.min(FINALE_START, eventNumber));
  const base = Math.round(300 + ((boundedEvent - 1) * 900) / (FINALE_START - 1));
  const topPoints = finaleFormat === "triple" ? Math.round(base / 3) : base;
  const pointsPerRank = finaleFormat === "triple" ? 2 : 6;
  return Array.from({ length: participantCount }, (_, index) => topPoints - index * pointsPerRank);
}

function singleEventTopPoints(eventNumber) {
  const boundedEvent = Math.max(1, Math.min(FINALE_START, eventNumber));
  return Math.round(300 + ((boundedEvent - 1) * 900) / (FINALE_START - 1));
}

function totalEventPoints(eventNumber, finaleFormat = state.finaleFormat) {
  if (state.seasonType === "playoffs") return seasonRules.playoffPointsForRank(1);
  if (state.pointSchedules?.[eventNumber - 1]?.length) return state.pointSchedules[eventNumber - 1][0];
  const fullEventPoints = singleEventTopPoints(finaleFormat === "triple" ? Math.min(FINALE_START, eventNumber) : eventNumber);
  return finaleFormat === "triple" ? Math.round(fullEventPoints / 3) : fullEventPoints;
}

function awardRankPoints(results, eventNumber) {
  if (state.seasonType === "playoffs") {
    seasonRules.awardPlayoffPoints(results);
    return;
  }
  const customPoints = state.pointSchedules?.[eventNumber - 1];
  if (customPoints) {
    if (customPoints.length < results.length) {
      throw new Error(`The saved point system has ${customPoints.length} ranks, but this event has ${results.length} participants.`);
    }
    for (const result of results) {
      result.performanceScore = result.points;
      result.points = customPoints[result.rank - 1];
    }
    return;
  }
  const topScore = totalEventPoints(eventNumber);
  const pointsPerRank = state.finaleFormat === "triple" ? 2 : 6;
  for (const result of results) {
    result.performanceScore = result.points;
    result.points = topScore - (result.rank - 1) * pointsPerRank;
  }
}

function currentEventName() {
  if (state.nextEvent > state.eventLimit) return "Season complete";
  if (state.seasonType === "playoffs") {
    if (state.nextEvent <= 10) return "Playoffs · Qualification";
    if (state.nextEvent <= 13) return "Playoffs · Top 16";
    if (state.nextEvent <= 16) return "Playoffs · Top 12";
    if (state.nextEvent <= 19) return "Playoffs · Top 8";
    return "Playoffs · Top 4 final";
  }
  if (state.nextEvent <= 2) return "The season opener";
  if (state.nextEvent < FINALE_START) return "Elimination round";
  if (state.finaleFormat === "triple") return `Finale · Part ${state.nextEvent - FINALE_START + 1} of 3`;
  return "The grand finale";
}

function updateHeader() {
  const seasonNumber = state.name.match(/\d+/)?.[0] || "01";
  const finished = state.completed;
  const needsSetup = state.players.length === 0;
  $("#season-label").textContent = state.name.toUpperCase();
  $("#season-status").textContent = finished ? "COMPLETE" : needsSetup ? "SETUP REQUIRED" : "IN PROGRESS";
  $("#intro-status").textContent = finished ? "SEASON COMPLETE" : needsSetup ? "READY TO SET UP" : "SEASON IN PLAY";
  $("#format-label").textContent = state.seasonType === "playoffs"
    ? "PLAYOFFS · FOUR POINT RESETS"
    : `${state.eventLimit} EVENTS · ${state.finaleFormat === "triple" ? "THREE-PART" : "SINGLE"} FINALE`;
  $("#footer-season").textContent = seasonNumber.padStart(2, "0");
  $("#event-number").textContent = finished ? String(state.eventLimit).padStart(2, "0") : String(state.nextEvent).padStart(2, "0");
  $("#event-total").textContent = String(state.eventLimit).padStart(2, "0");
  $("#event-kind").textContent = currentEventName().toUpperCase();
  $("#event-index").textContent = `EVENT ${String(Math.min(state.nextEvent, state.eventLimit)).padStart(2, "0")} / ${String(state.eventLimit).padStart(2, "0")}`;
  $("#active-count").textContent = state.players.filter((player) => player.active).length;
  $("#player-total").textContent = state.players.length;
  $("#history-count").textContent = `${state.history.length} EVENT${state.history.length === 1 ? "" : "S"} PLAYED`;
  $("#archive-count").textContent = `${seasonArchive.length} SEASON${seasonArchive.length === 1 ? "" : "S"}`;
  $("#draw-button").disabled = (finished && !cloudSavePending) || (supabaseConfigured && !authUser);
  $("#draw-button").innerHTML = cloudSavePending
    ? `<span class="button-dice">↻</span> Retry cloud save`
    : finished
    ? `<span class="button-dice">✓</span> Season complete`
    : needsSetup
    ? `<span class="button-dice">＋</span> Set up a season`
    : `<span class="button-dice">✳</span> Draw the event <span class="button-arrow">↗</span>`;

  const ranked = getCurrentStandings(state);
  const leader = ranked[0];
  $("#leader-name").textContent = leader?.points ? leader.name : "—";
  $("#leader-points").textContent = leader?.points ?? 0;
  $("#point-range").textContent = String(totalEventPoints(Math.min(state.nextEvent, state.eventLimit)));
}

function identityStyle(player) {
  const appearance = player.appearance ?? defaultAppearance(0, player.colorName);
  const [first, second] = palettes[(appearance.paletteIndex ?? 0) % palettes.length];
  const start = /^#[\da-f]{6}$/i.test(appearance.gradientStart ?? "") ? appearance.gradientStart : first;
  const end = /^#[\da-f]{6}$/i.test(appearance.gradientEnd ?? "") ? appearance.gradientEnd : second;
  const solid = /^#[\da-f]{6}$/i.test(appearance.solidHex ?? "") ? appearance.solidHex : first;
  const configuredUrl = window.RV_SUPABASE_CONFIG?.url ?? "";
  const imageUrl = configuredUrl && appearance.imageUrl?.startsWith(configuredUrl)
    ? appearance.imageUrl
    : "";
  const imageSource = /^data:image\/(png|jpeg|webp|gif);base64,/i.test(appearance.imageData ?? "")
    ? appearance.imageData
    : imageUrl;
  const background = appearance.kind === "image" && imageSource
    ? `linear-gradient(90deg, #101110dd, #10111044),url('${imageSource}')`
    : appearance.kind === "gradient"
      ? `linear-gradient(115deg, ${start}dd, ${end}77 42%, transparent 92%)`
      : `linear-gradient(115deg, ${solid}cc, ${solid}55 40%, transparent 92%)`;
  return `--identity-a:${start};--identity-b:${end};background-image:${background}`;
}

function getCurrentStandings(season = state) {
  if (season.seasonType === "playoffs") {
    const priorOrder = season.history.at(-1)?.priorLeaderboardIds ?? [];
    return seasonRules.standings(season.players, {
      useWins: season.nextEvent <= 10,
      priorOrder,
    });
  }
  return [...season.players].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function renderLeaderboard() {
  const list = $("#leaderboard-list");
  const isPlayoffs = state.seasonType === "playoffs";
  const players = getCurrentStandings(state);
  document.body.classList.toggle("playoffs-season", isPlayoffs);
  $(".scoreboard-columns").innerHTML = isPlayoffs
    ? "<span>PLACE</span><span>USERNAME</span><span>COLOR NAME</span><span>W / STAGE WINS</span><span>POINTS</span>"
    : "<span>PLACE</span><span>USERNAME</span><span>COLOR NAME</span><span>G / S / B</span><span>POINTS</span>";
  $(".scoreboard-columns").classList.toggle("playoffs", isPlayoffs);
  $(".sort-label").textContent = isPlayoffs && state.nextEvent <= 10 ? "EVENT WINS / POINTS" : "TOTAL PTS ↓";
  $(".medal-key").innerHTML = isPlayoffs
    ? "<span>PLAYOFF COUNTERS</span><b>W · EVENT WINS</b><b>SW · STAGE WINS</b><b class=\"gold-count\">G · GOLD</b><b class=\"silver-count\">S · SILVER</b><b class=\"bronze-count\">B · BRONZE</b>"
    : '<span>EVENT MEDALS</span><b class="gold-count">G · GOLD</b><b class="silver-count">S · SILVER</b><b class="bronze-count">B · BRONZE</b>';
  $(".leaderboard-footer").innerHTML = isPlayoffs
    ? '<span><span class="legend-dot legend-active"></span> ALL PARTICIPANTS COMPETE</span><span>QUALIFICATION RESETS POINTS, NOT PARTICIPATION</span>'
    : '<span><span class="legend-dot legend-active"></span> COMPETING</span><span><span class="legend-dot legend-out"></span> ELIMINATED</span>';
  if (!players.length) {
    list.innerHTML = '<p class="empty-leaderboard">No players in the field yet.</p>';
    return;
  }
  list.innerHTML = players.map((player, index) => {
    const counters = player.medals ?? { gold: 0, silver: 0, bronze: 0 };
    return `
      <div class="player-row${isPlayoffs ? " playoffs" : ""}${player.active ? "" : " eliminated"} identity-${player.appearance.kind}" style="${identityStyle(player)}">
        <span class="player-rank">${String(index + 1).padStart(2, "0")}</span>
        <span class="player-name" title="${escapeHtml(player.username ?? player.name)}">${escapeHtml(player.username ?? player.name)}</span>
        <span class="player-color" title="${escapeHtml(player.colorName ?? "—")}">${escapeHtml(player.colorName ?? "—")}</span>
        <span class="player-medals" aria-label="${isPlayoffs ? `${player.wins ?? 0} event wins, ${player.stageWins ?? 0} stage wins, ` : ""}${counters.gold} gold, ${counters.silver} silver, ${counters.bronze} bronze">
          ${isPlayoffs ? `<b>W ${player.wins ?? 0}</b><b>SW ${player.stageWins ?? 0}</b>` : ""}
          <b class="gold-count">G ${counters.gold}</b><b class="silver-count">S ${counters.silver}</b><b class="bronze-count">B ${counters.bronze}</b>
        </span>
        <span class="player-points">${player.points} <small>PTS</small></span>
        <span class="player-status" aria-label="${player.active ? "Competing" : "Eliminated"}"></span>
      </div>`;
  }).join("");
}

function archiveSeason(season) {
  if (!season?.history?.length || seasonArchive.some((entry) => entry.id === season.id)) return;
  seasonArchive.unshift(JSON.parse(JSON.stringify(season)));
  renderArchiveList();
}

function renderArchiveList() {
  const list = $("#archive-list");
  $("#archive-count").textContent = `${seasonArchive.length} SEASON${seasonArchive.length === 1 ? "" : "S"}`;
  if (!seasonArchive.length) {
    list.innerHTML = '<div class="history-empty">Finished or replaced seasons appear here in your archive.</div>';
    return;
  }
  list.innerHTML = seasonArchive.map((season) => {
    const champion = season.players.find((player) => player.id === season.winnerId)
      ?? [...season.players].sort((a, b) => b.points - a.points)[0];
    const ranked = getCurrentStandings(season);
    return `<article class="archive-row">
      <div class="archive-info">
        <span class="archive-season-name">${escapeHtml(season.name)}</span>
        <span class="archive-meta">${season.history.length} EVENTS · ${ranked.length} PLAYERS</span>
      </div>
      <div class="archive-champion">
        <span>${season.completed ? "SEASON WINNER" : "LEADER WHEN ARCHIVED"}</span>
        <strong>${escapeHtml(champion?.name ?? "—")}</strong>
        <small>${champion?.points ?? 0} PTS</small>
      </div>
      <button class="button button-outline archive-open" type="button" data-archive-id="${escapeHtml(season.id)}">View season ↗</button>
    </article>`;
  }).join("");
}

async function openArchivedSeason(seasonId) {
  const season = seasonArchive.find((entry) => entry.id === seasonId);
  if (!season) return;
  if (supabaseConfigured && authUser) {
    await supabaseService.hydrateSeasonImages([season]);
  }
  const champion = season.players.find((player) => player.id === season.winnerId);
  const rankings = getCurrentStandings(season);
  $("#archive-title").innerHTML = `${escapeHtml(season.name)}<span class="heading-period">.</span>`;
  $("#archive-detail").innerHTML = `
    <section class="archive-standings">
      <h3>Final scoreboard</h3>
      <div class="archive-champion-banner">
        <span>${season.completed ? "SEASON WINNER" : "LEADER WHEN ARCHIVED"}</span>
        <strong>${escapeHtml(champion?.name ?? rankings[0]?.name ?? "—")}</strong>
        <small>${champion?.points ?? rankings[0]?.points ?? 0} TOTAL PTS</small>
      </div>
      <div class="archive-table-wrap"><table class="results-table archive-score-table">
        <thead><tr><th scope="col">PLACE</th><th scope="col">USERNAME</th><th scope="col">COLOR</th>${season.seasonType === "playoffs" ? "<th scope=\"col\">WINS</th><th scope=\"col\">STAGE WINS</th>" : ""}<th scope="col">G</th><th scope="col">S</th><th scope="col">B</th><th scope="col">TOTAL PTS</th></tr></thead>
        <tbody>${rankings.map((player, index) => {
          const medals = player.medals ?? { gold: 0, silver: 0, bronze: 0 };
          return `<tr style="${identityStyle(player)}"><td>${String(index + 1).padStart(2, "0")}</td><th scope="row">${escapeHtml(player.username ?? player.name)}</th><td>${escapeHtml(player.colorName ?? "—")}</td>${season.seasonType === "playoffs" ? `<td>${player.wins ?? 0}</td><td>${player.stageWins ?? 0}</td>` : ""}<td>${medals.gold}</td><td>${medals.silver}</td><td>${medals.bronze}</td><td>${player.points}</td></tr>`;
        }).join("")}</tbody>
      </table></div>
    </section>
    <section class="archive-events">
      <h3>Event results</h3>
      ${[...season.history].reverse().map((event) => {
        const results = rankResults(event.results);
        const format = eventFormats.find((entry) => entry.mechanic === event.mechanic);
        return `<details class="archive-event">
          <summary><span>EVENT ${String(event.number).padStart(2, "0")} · ${escapeHtml(event.title)}</span><span>${results.length} PLAYERS</span></summary>
          <div class="archive-event-description">${escapeHtml(event.summary ?? event.description ?? "")} ${escapeHtml(event.rulesMode === "custom" ? `Custom settings: ${format ? describeEventSettings(format, event.settings ?? {}) : ""}` : event.standardRules ?? format?.standardRules ?? "")}</div>
          <div class="archive-table-wrap"><table class="results-table">
            <thead><tr><th scope="col">PLACE</th><th scope="col">USERNAME</th><th scope="col">COLOR</th><th scope="col">DETAIL</th><th scope="col">MEDAL</th><th scope="col">TIEBREAK</th><th scope="col">EVENT PTS</th><th scope="col">TOTAL PTS</th></tr></thead>
            <tbody>${results.map((result) => {
              const player = season.players.find((entry) => entry.id === result.id);
              return `<tr style="${player ? identityStyle(player) : ""}"><td>${String(result.rank).padStart(2, "0")}</td><th scope="row">${escapeHtml(result.name)}</th><td>${escapeHtml(player?.colorName ?? "—")}</td><td>${eventDetailMarkup(result)}</td><td>${result.medal ? result.medal.toUpperCase() : "—"}</td><td>${escapeHtml(result.tieBreak ?? "—")}</td><td>+${result.points}</td><td>${result.totalPoints ?? player?.points ?? "—"}</td></tr>`;
            }).join("")}</tbody>
          </table></div>
          ${eventRoundsMarkup(event.eventRounds, season.players)}
          ${event.pointReset ? renderPlayoffResetComparison(event.pointReset, season.players) : ""}
          ${event.stageWinners?.length ? `<p class="playoff-stage-note">Stage points: ${event.stageWinners.map((winner) => `${escapeHtml(winner.name)} (+1)`).join(", ")}. Stage points are added only to qualifying players at resets 1–3.</p>` : ""}
          ${event.eliminated?.length ? `<p class="archive-eliminations">Eliminated: ${event.eliminated.map(escapeHtml).join(", ")}</p>` : ""}
        </details>`;
      }).join("")}
    </section>`;
  $("#archive-modal").showModal();
}

function renderPlayoffResetComparison(pointReset, players = state.players) {
  if (!pointReset) return "";
  const playerById = new Map(players.map((player) => [player.id, player]));
  const renderSnapshot = (title, description, entries, markQualifiers = false) => `
    <section class="playoff-reset-card">
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(description)}</p>
      <div class="archive-table-wrap"><table class="results-table">
        <thead><tr><th scope="col">PLACE</th><th scope="col">USERNAME</th><th scope="col">W</th><th scope="col">STAGE W</th><th scope="col">POINTS</th>${markQualifiers ? "<th scope=\"col\">STATUS</th>" : ""}</tr></thead>
        <tbody>${entries.map((entry) => `<tr style="${playerById.has(entry.id) ? identityStyle(playerById.get(entry.id)) : ""}"><td>${String(entry.rank).padStart(2, "0")}</td><th scope="row">${escapeHtml(entry.name)}</th><td>${entry.wins}</td><td>${entry.stageWins}</td><td>${entry.points}</td>${markQualifiers ? `<td>${pointReset.qualifiers.includes(entry.id) ? "QUALIFIED" : pointReset.notQualified?.some((player) => player.id === entry.id) ? "NOT QUALIFIED" : "ALREADY OUT"}</td>` : ""}</tr>`).join("")}</tbody>
      </table></div>
    </section>`;
  const afterDescription = pointReset.stageBonusApplied
    ? `Qualifiers reset to ${pointReset.resetPoints} plus their accumulated stage points.`
    : `Qualifiers reset to ${pointReset.resetPoints}; Event 19 stage points are not added.`;
  return `<div class="playoff-reset-comparison">
    ${renderSnapshot("Leaderboard before reset", `${pointReset.label}. Tie order carried forward from the previous leaderboard.`, pointReset.before)}
    ${renderSnapshot("Leaderboard after reset", afterDescription, pointReset.after, true)}
  </div>`;
}

function renderHistory() {
  const historyList = $("#history-list");
  if (!state.history.length) {
    historyList.innerHTML = '<div class="history-empty">No events played yet. The season is waiting on its first draw.</div>';
    return;
  }
  historyList.innerHTML = [...state.history].reverse().map((event) => {
    const winner = state.players.find((player) => player.id === event.results[0]?.id);
    const eliminated = event.eliminated?.length
      ? `<div class="history-eliminations">Eliminated: <strong>${event.eliminated.map(escapeHtml).join(", ")}</strong></div>`
      : "";
    return `<article class="history-row">
      <span class="history-event-no">EVT ${String(event.number).padStart(2, "0")}</span>
      <span class="history-event-name">${escapeHtml(event.title)}</span>
      <span class="history-event-meta">${event.results.length} PLAYERS · ${escapeHtml(event.type ?? "EVENT")}</span>
      <span class="history-winner">${escapeHtml(winner?.name ?? "—")} <small>+${event.results[0]?.points ?? 0}</small></span>
      ${eliminated}
    </article>`;
  }).join("");
}

function renderPlayoffResetHistory() {
  const section = $("#playoff-reset-history");
  const resets = state.history.filter((event) => event.pointReset);
  section.hidden = state.seasonType !== "playoffs" || resets.length === 0;
  $("#playoff-reset-list").innerHTML = resets.map((event) => `
    <details class="archive-event">
      <summary><span>EVENT ${String(event.number).padStart(2, "0")} · ${escapeHtml(event.pointReset.label)}</span><span>${event.pointReset.qualifiers.length} QUALIFIED</span></summary>
      ${renderPlayoffResetComparison(event.pointReset)}
    </details>`).join("");
}

function eventDetailMarkup(result, expanded = false) {
  if (result.board) {
    const callNumber = new Map((result.callOrder ?? []).map((ball, index) => [ball, index + 1]));
    const board = result.board.map((row) => `<span>${row.map((cell) => {
      if (cell === "FREE") return `<b class="bingo-free">${cell}</b>`;
      const calledAt = callNumber.get(Number(cell.slice(1)));
      const called = calledAt && calledAt <= (result.eventEndCallIndex ?? 0);
      const afterFinish = called && calledAt > result.finishCallNumber;
      return `<b class="${called ? afterFinish ? "bingo-called-after" : "bingo-called" : ""}">${escapeHtml(cell)}</b>`;
    }).join("")}</span>`).join("");
    return `<details class="bingo-board-details"${expanded ? " open" : ""}><summary>View board</summary><span class="bingo-board">${board}</span><small><i class="bingo-called"></i> Called before this participant finished · <i class="bingo-called-after"></i> Called after finishing</small></details>`;
  }
  return escapeHtml(result.detail ?? "—");
}

function eventRoundsMarkup(rounds, players) {
  if (!rounds?.length) return "";
  const names = new Map(players.map((player) => [player.id, player.username ?? player.name]));
  const catchingRounds = rounds.some((round) => Array.isArray(round.order));
  const heading = catchingRounds
    ? `${rounds.filter((round) => !round.isTiebreak).length} Catching rounds`
    : `${rounds.length} survival phases`;
  return `<details class="event-round-log">
    <summary>View ${escapeHtml(heading)}</summary>
    ${rounds.map((round) => {
      if (Array.isArray(round.order)) {
        const outcomes = Object.entries(round.caughtBy ?? {}).map(([id, count]) =>
          `${escapeHtml(names.get(id) ?? id)} caught ${count}`).join(" · ");
        return `<section><h4>${round.isTiebreak ? `One-object tie-break ${round.round} · group ${round.group}` : `Round ${round.round}`}</h4>
          <ol>${round.order.map((entry) => `<li>${entry.type === "object" ? "OBJECT" : "PLAYER"} · ${escapeHtml(entry.name)}</li>`).join("")}</ol>
          <p>${outcomes || "No catches this round."}</p></section>`;
      }
      return `<section><h4>${escapeHtml(round.phase)}${round.round ? ` · ${round.round}` : ""}</h4>
        <ul>${(round.events ?? []).map((entry) => `<li>${escapeHtml(entry.name)} · ${escapeHtml(entry.detail)}</li>`).join("") || "<li>No eliminations this phase.</li>"}</ul></section>`;
    }).join("")}
  </details>`;
}

function describeEventSettings(format, settings) {
  return format.settings.map((setting) => {
    const value = settings[setting.key];
    const display = Array.isArray(value)
      ? value.join(", ")
      : typeof value === "boolean"
        ? value ? "Yes" : "No"
        : String(value ?? setting.standard);
    return `${setting.label}: ${display}`;
  }).join(" · ");
}

function awardEventMedals(results) {
  const medalForRank = { 1: "gold", 2: "silver", 3: "bronze" };
  for (const result of results) {
    const medal = medalForRank[result.rank];
    if (!medal) continue;
    result.medal = medal;
    const player = state.players.find((entry) => entry.id === result.id);
    player.medals ??= { gold: 0, silver: 0, bronze: 0 };
    player.medals[medal] += 1;
  }
}

function renderResults(event) {
  const box = $("#event-results");
  const mechanic = $("#event-mechanic");
  if (!event) {
    box.hidden = true;
    mechanic.hidden = true;
    box.innerHTML = "";
    mechanic.textContent = "";
    return;
  }
  const playersById = new Map(state.players.map((player) => [player.id, player]));
  const results = rankResults(event.results);
  box.hidden = false;
  mechanic.hidden = false;
  const format = eventFormats.find((entry) => entry.mechanic === event.mechanic);
  const rules = event.rulesMode === "custom"
    ? `Custom settings: ${format ? describeEventSettings(format, event.settings ?? {}) : ""}`
    : event.standardRules ?? format?.standardRules ?? "";
  mechanic.textContent = `${event.title} — ${event.summary || "Random placement decides this event."}${rules ? ` ${rules}` : ""}`;
  box.innerHTML = `
    <div class="results-heading">
      <strong>Event ${String(event.number).padStart(2, "0")} results</strong>
      <span>${results.length} PARTICIPANTS</span>
    </div>
    <div class="event-results-wrap">
      <table class="results-table">
        <thead><tr><th scope="col">PLACE</th><th scope="col">USERNAME</th><th scope="col">COLOR</th><th scope="col">DETAIL</th><th scope="col">MEDAL</th><th scope="col">TIEBREAK</th><th scope="col">EVENT PTS</th><th scope="col">TOTAL PTS</th></tr></thead>
        <tbody>${results.map((result) => {
          const player = playersById.get(result.id);
          if (!player) return "";
          return `<tr class="result-row identity-${player.appearance.kind}" style="${identityStyle(player)}">
            <td>${String(result.rank).padStart(2, "0")}</td>
            <th scope="row">${escapeHtml(result.name)}</th>
            <td>${escapeHtml(player.colorName ?? "—")}</td>
            <td>${eventDetailMarkup(result)}</td>
            <td>${result.medal ? result.medal.toUpperCase() : "—"}</td>
            <td>${result.tieBreak ?? "—"}</td>
            <td>+${result.points}</td>
            <td>${result.totalPoints ?? player.points}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
    </div>
    ${eventRoundsMarkup(event.eventRounds, state.players)}
    ${event.stageWinners?.length ? `<p class="playoff-stage-note">Stage winners: ${event.stageWinners.map((winner) => `${escapeHtml(winner.name)} (+1 stage point)`).join(", ")}.</p>` : ""}
    ${event.pointReset ? renderPlayoffResetComparison(event.pointReset) : ""}`;
}

function renderEventSettings(format, container) {
  container.innerHTML = format.settings.map((setting) => {
    let control;
    if (setting.type === "checkbox") {
      control = `<input class="standalone-setting" data-setting="${escapeHtml(setting.key)}" type="checkbox"${setting.standard ? " checked" : ""}>`;
    } else if (setting.type === "select") {
      control = `<select class="text-input standalone-setting" data-setting="${escapeHtml(setting.key)}">${setting.options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === setting.standard ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>`;
    } else {
      const value = setting.type === "number" ? setting.standard : String(setting.standard);
      const attributes = setting.type === "number"
        ? ` min="${setting.min}" max="${setting.max}"${setting.step ? ` step="${setting.step}"` : ""}`
        : setting.maxLength ? ` maxlength="${setting.maxLength}"` : "";
      control = `<input class="text-input standalone-setting" data-setting="${escapeHtml(setting.key)}" type="${setting.type}"${attributes} value="${escapeHtml(value)}">`;
    }
    return `<label class="standalone-setting-field"><span>${escapeHtml(setting.label)}</span>${control}</label>`;
  }).join("");
}

function setSettingsEnabled(container, enabled) {
  container.hidden = !enabled || container.children.length === 0;
  container.querySelectorAll(".standalone-setting").forEach((input) => { input.disabled = !enabled; });
}

function readEventSettings(format, container, custom) {
  const settings = {};
  for (const setting of format.settings) {
    const input = container.querySelector(`[data-setting="${setting.key}"]`);
    if (!input) throw new Error(`Missing the ${setting.label} setting control.`);
    const rawValue = custom ? input.value : setting.standard;
    if (setting.type === "checkbox") {
      settings[setting.key] = custom ? input.checked : setting.standard;
    } else if (setting.type === "number") {
      const value = Number(rawValue);
      if (!input.value.trim() || !Number.isFinite(value) || value < setting.min || value > setting.max
        || (!setting.step && !Number.isInteger(value))) {
        throw new Error(`${setting.label} must be between ${setting.min} and ${setting.max}${setting.step ? "" : " as a whole number"}.`);
      }
      settings[setting.key] = value;
    } else if (setting.key === "ballotPoints") {
      const values = rawValue.split(",").map((value) => Number(value.trim()));
      if (!values.length || values.some((value) => !Number.isInteger(value) || value < 1 || value > 100)
        || new Set(values).size !== values.length || values.some((value, index) => index > 0 && values[index - 1] <= value)) {
        throw new Error("Ballot points must be unique, positive whole numbers in descending order.");
      }
      settings[setting.key] = values;
    } else {
      settings[setting.key] = String(rawValue).trim();
      if (setting.maxLength && settings[setting.key].length > setting.maxLength) {
        throw new Error(`${setting.label} must be ${setting.maxLength} characters or fewer.`);
      }
    }
  }
  if (settings.minimumDrop && settings.maximumDrop && settings.maximumDrop < settings.minimumDrop) {
    throw new Error("Maximum dropped must be at least the minimum dropped.");
  }
  if (settings.minimumLetters && settings.maximumLetters && settings.maximumLetters < settings.minimumLetters) {
    throw new Error("Maximum word length must be at least the minimum word length.");
  }
  if (settings.minimumPerformance != null && settings.maximumPerformance != null
    && settings.maximumPerformance <= settings.minimumPerformance) {
    throw new Error("Maximum performance must be greater than minimum performance.");
  }
  if (settings.useHeats && settings.qualifiersPerHeat != null && settings.heatSize != null && settings.qualifiersPerHeat > settings.heatSize) {
    throw new Error("Qualifiers per heat cannot exceed the number of participants per heat.");
  }
  return settings;
}

function updateSeasonEventSettings() {
  const format = getEventFormat($("#season-event-choice").value);
  $("#season-standard-rules").textContent = format.standardRules;
  renderEventSettings(format, $("#season-event-settings"));
  $("#season-event-settings").hidden = true;
  document.querySelector('input[name="seasonRulesMode"][value="standard"]').checked = true;
  $("#season-event-settings").querySelectorAll(".standalone-setting").forEach((input) => { input.disabled = true; });
}

function renderEventCard() {
  const eventNumber = Math.min(state.nextEvent, state.eventLimit);
  const latestEvent = state.history.at(-1) ?? null;
  const choices = $("#season-event-choice");
  const previousMechanic = state.selectedMechanic;
  const mechanic = eventFormats.some((entry) => entry.mechanic === previousMechanic)
    ? previousMechanic
    : eventFormats[0].mechanic;
  const categories = new Map();
  for (const entry of eventFormats) {
    const category = entry.category ?? "Other";
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(entry);
  }
  choices.innerHTML = [...categories].map(([category, formats]) => `
    <optgroup label="${escapeHtml(category)}">${formats.map((entry) =>
      `<option value="${escapeHtml(entry.mechanic)}"${entry.mechanic === mechanic ? " selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")}</optgroup>`).join("");
  state.selectedMechanic = mechanic;
  const format = getEventFormat(mechanic);
  const settingsKey = `${eventNumber}:${format.mechanic}`;
  if (state.eventSettingsKey !== settingsKey) {
    updateSeasonEventSettings();
    state.eventSettingsKey = settingsKey;
  }
  const needsSetup = state.players.length === 0;
  $("#season-event-config").hidden = state.completed || needsSetup;
  $("#season-event-choice").disabled = state.completed || needsSetup || (supabaseConfigured && !authUser);
  $("#season-standard-rules").textContent = format.standardRules;
  const paletteIndex = (eventNumber * 7 + state.players.length) % palettes.length;
  const [colorA, colorB] = palettes[paletteIndex];
  const kind = format.kind;
  const colors = kind === "color"
    ? `linear-gradient(135deg, ${colorA}, ${colorA})`
    : kind === "gradient"
      ? `linear-gradient(135deg, ${colorA}, ${colorB})`
      : `radial-gradient(ellipse at 70% 23%, ${colorA}bb 0, transparent 31%), radial-gradient(ellipse at 25% 78%, ${colorB} 0, transparent 40%), linear-gradient(135deg, #242823, #171a17)`;
  $("#event-art").style.backgroundImage = colors;
  $("#art-type").textContent = state.completed ? "SEASON COMPLETE" : format.type;
  $("#art-mark").textContent = `RV—${String(eventNumber).padStart(2, "0")}`;
  $("#art-center").textContent = state.completed
    ? `WINNER: ${state.players.find((player) => player.id === state.winnerId)?.name ?? "—"}`
    : `EVENT ${String(eventNumber).padStart(2, "0")}`;
  $("#event-title").textContent = state.completed ? "The season is decided" : needsSetup ? "Create your season" : format.label;
  $("#event-description").textContent = state.completed
    ? "The final draw is in. Check the leaderboard and event history for the complete season."
    : needsSetup
      ? supabaseConfigured && !authUser
        ? "Sign in to access your saved seasons, then set up a new season."
        : "Set the participant field and choose the season format to get started."
      : format.description;
  $("#event-card-heading").textContent = state.completed ? "Season complete" : needsSetup ? "A fresh start" : `Event ${String(eventNumber).padStart(2, "0")} is ready`;
  $("#top-score").innerHTML = `${state.completed ? "—" : totalEventPoints(eventNumber)} <small>PTS</small>`;
  $("#event-notice").textContent = "";
  renderResults(latestEvent);
}

function render() {
  updateHeader();
  renderLeaderboard();
  renderHistory();
  renderPlayoffResetHistory();
  renderEventCard();
}

function scoreboardOrder(players) {
  return [...players].sort((left, right) => right.points - left.points
    || state.players.indexOf(left) - state.players.indexOf(right));
}

async function loadCountryData(statistic = "population") {
  if (!countryDataPromises.has(statistic)) {
    countryDataPromises.set(statistic, (async () => {
      const countryResponse = await fetch("https://raw.githubusercontent.com/mledoze/countries/master/countries.json");
      if (!countryResponse.ok) throw new Error(`Country list request failed (${countryResponse.status}).`);
      const countryPayload = await countryResponse.json();
      const specialCountries = new Set(["XKX", "TWN", "PSE", "VAT"]);
      const countries = countryPayload
        .filter((country) => country.unMember || country.independent || specialCountries.has(country.cca3))
        .map((country) => ({
          code: country.cca3,
          name: country.name.common,
          populationFallback: Number(country.population) || 0,
        }));
      if (!countries.some((country) => country.code === "XKX")) {
        countries.push({ code: "XKX", name: "Kosovo", populationFallback: 1_585_566 });
      }
      const uniqueCountries = [...new Map(countries.filter((country) => country.code).map((country) => [country.code, country])).values()];
      if (uniqueCountries.length < 190) throw new Error(`The recognized-country dataset returned only ${uniqueCountries.length} countries.`);

      const indicator = statistic === "gdp" ? "NY.GDP.MKTP.CD" : "SP.POP.TOTL";
      const statisticResponse = await fetch(`https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=20000`);
      if (!statisticResponse.ok) throw new Error(`World Bank ${statistic} request failed (${statisticResponse.status}).`);
      const statisticPayload = await statisticResponse.json();
      const statisticRows = statisticPayload[1];
      if (!Array.isArray(statisticRows)) throw new Error(`World Bank returned no ${statistic} records.`);
      const statisticByCode = new Map();
      for (const row of statisticRows) {
        if (row.value == null) continue;
        const existing = statisticByCode.get(row.countryiso3code);
        if (!existing || Number(row.date) > Number(existing.year)) {
          statisticByCode.set(row.countryiso3code, { value: Number(row.value), year: row.date });
        }
      }
      return uniqueCountries.map((country) => {
        const observation = statisticByCode.get(country.code);
        return {
          ...country,
          statistic: observation?.value ?? (statistic === "population" ? country.populationFallback : 0),
          year: observation?.year ?? "latest available",
          source: observation ? "World Bank" : "country dataset fallback",
        };
      });
    })().catch((error) => {
      countryDataPromises.delete(statistic);
      throw error;
    }));
  }
  return countryDataPromises.get(statistic);
}

async function scoreEvent(players, mechanic, settings = {}, format = null) {
  return eventEngine.scoreEvent(players, mechanic, settings, {
    loadCountryData,
    scoreboardOrder,
    format,
  });
}

async function drawEvent() {
  if (supabaseConfigured && !authUser) {
    $("#auth-modal").showModal();
    return;
  }
  if (!state.players.length) {
    seasonSetup.open();
    return;
  }
  if (cloudSavePending) {
    await saveSeasonToCloud(state, true);
    render();
    showToast("Season progress saved.");
    return;
  }
  if (state.completed || state.nextEvent > state.eventLimit) return;
  const eventNumber = state.nextEvent;
  const activePlayers = state.seasonType === "playoffs"
    ? [...state.players]
    : state.players.filter((player) => player.active);
  const priorLeaderboardIds = getCurrentStandings(state).map((player) => player.id);
  if (activePlayers.length < 3) {
    showToast("A season needs at least three active players to continue.", true);
    return;
  }

  const format = getEventFormat($("#season-event-choice").value);
  const customRules = document.querySelector('input[name="seasonRulesMode"]:checked').value === "custom";
  const paletteIndex = Math.floor(Math.random() * palettes.length);
  const [colorA] = palettes[paletteIndex];
  $("#draw-button").disabled = true;
  $("#event-notice").textContent = "The event is being drawn…";
  let results;
  let eventSettings;
  let scoredResults;
  try {
    eventSettings = readEventSettings(format, $("#season-event-settings"), customRules);
    scoredResults = await scoreEvent(activePlayers, format.mechanic, eventSettings, format);
    results = rankResults(scoredResults);
    if (format.mechanic === "bingo") setBingoEndCall(results);
  } catch (error) {
    console.error("Could not complete the RV event.", error);
    $("#event-notice").textContent = `The event could not be completed: ${error.message}`;
    showToast(`The event could not be completed: ${error.message}`, true);
    $("#draw-button").disabled = false;
    return;
  }
  awardRankPoints(results, eventNumber);
  awardEventMedals(results);
  const pointsById = new Map(results.map((result) => [result.id, result.points]));
  for (const player of activePlayers) player.points += pointsById.get(player.id);

  const eliminated = [];
  let stageWinners = [];
  let pointReset = null;
  if (state.seasonType === "playoffs") {
    const eventWinner = state.players.find((player) => player.id === results[0]?.id);
    if (eventWinner) eventWinner.wins = (eventWinner.wins ?? 0) + 1;
    stageWinners = seasonRules.awardStagePoints(state.players, randomOrder);
    pointReset = seasonRules.applyPlayoffCheckpoint(state, eventNumber, priorLeaderboardIds);
    if (pointReset) eliminated.push(...pointReset.eliminated.map((player) => player.name));
  } else if (eventNumber >= 3 && eventNumber < FINALE_START) {
    const cutsLeft = FINALE_START - eventNumber;
    const excessPlayers = activePlayers.length - 3;
    const cutCount = Math.min(excessPlayers, Math.max(1, Math.ceil(excessPlayers / cutsLeft)));
    const cutCandidates = randomOrder(activePlayers).sort((a, b) => a.points - b.points);
    const cutIds = new Set(cutCandidates.slice(0, cutCount).map((player) => player.id));
    for (const player of activePlayers) {
      if (cutIds.has(player.id)) {
        player.active = false;
        eliminated.push(player.name);
      }
    }
  }

  for (const result of results) {
    result.totalPoints = state.players.find((player) => player.id === result.id).points;
  }
  const stageSummary = stageWinners.length
    ? ` Stage winners: ${stageWinners.map((winner) => `${winner.name} (+1 stage point)`).join(", ")}.`
    : "";
  const resetSummary = pointReset
    ? ` ${pointReset.label}; points reset to ${pointReset.resetPoints}${pointReset.stageBonusApplied ? " plus accumulated stage points" : " without stage points"}.`
    : "";
  const eventLabel = scoredResults.eventTitle ?? format.label;
  const eventTitle = `Event ${String(eventNumber).padStart(2, "0")} · ${eventLabel}`;
  const eventRecord = {
    id: `${state.name}-${eventNumber}-${Date.now()}`,
    number: eventNumber,
    title: eventTitle,
    type: format.type,
    kind: format.kind,
    mechanic: format.mechanic,
    center: colorA.toUpperCase(),
    description: format.description,
    standardRules: format.standardRules,
    summary: `${format.description}${results.some((result) => result.tieBreak !== "—") ? ` Tiebreaks resolved: ${results.filter((result) => result.tieBreak !== "—").map((result) => `${result.name} (${result.tieBreak.toLowerCase()})`).join(", ")}.` : ""}${stageSummary}${resetSummary}`,
    paletteIndex,
    results,
    settings: eventSettings,
    rulesMode: customRules ? "custom" : "standard",
    eventRounds: scoredResults.eventRounds ?? [],
    eliminated,
    notQualified: pointReset?.notQualified ?? [],
    priorLeaderboardIds,
    stageWinners,
    pointReset,
  };
  state.history.push(eventRecord);
  state.nextEvent += 1;
  state.selectedMechanic = null;
  state.eventSettingsKey = null;

  if (eventNumber === state.eventLimit) {
    const finalists = state.players.filter((player) => player.active);
    const champion = state.seasonType === "playoffs"
      ? seasonRules.standings(finalists)[0]
      : [...finalists].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))[0];
    state.winnerId = champion?.id ?? null;
    state.completed = true;
    archiveSeason(state);
  }

  render();
  await saveSeasonToCloud(state, true);
  const winner = results[0];
  const eliminationMessage = eliminated.length
    ? ` ${eliminated.length} player${eliminated.length === 1 ? "" : "s"} eliminated: ${eliminated.join(", ")}.`
    : "";
  if (state.completed) {
    const champion = state.players.find((player) => player.id === state.winnerId);
    $("#event-notice").textContent = `${champion.name} wins the season with ${champion.points} points!`;
  } else {
    $("#event-notice").textContent = `${winner.name} takes the event with ${winner.points} points.${eliminationMessage}`;
  }
}

function renderEventCatalogue() {
  $("#events-catalog").innerHTML = eventFormats.map((format) => `
    <button class="event-catalog-card${format === selectedStandaloneEvent ? " is-selected" : ""}" type="button" data-event-id="${format.mechanic}" aria-pressed="${format === selectedStandaloneEvent}">
      <span class="event-catalog-type">${escapeHtml(format.category ?? format.type)}</span>
      <strong>${escapeHtml(format.label)}</strong>
      <small>${escapeHtml(format.description)}</small>
    </button>`).join("");
  renderStandaloneEventDetails();
}

function renderStandaloneEventDetails() {
  $("#standalone-event-title").textContent = selectedStandaloneEvent.label;
  $("#standalone-event-description").textContent = selectedStandaloneEvent.description;
  $("#standalone-standard-rules").textContent = selectedStandaloneEvent.standardRules;
  renderEventSettings(selectedStandaloneEvent, $("#standalone-settings"));
  updateStandaloneSettingsAvailability();
  standaloneRunner = null;
  $("#standalone-runner").hidden = true;
  $("#standalone-runner").innerHTML = "";
  $("#standalone-start").disabled = false;
  $("#standalone-error").textContent = "";
}

function updateStandaloneSettingsAvailability() {
  const custom = $("#standalone-event-form").elements.rulesMode.value === "custom";
  setSettingsEnabled($("#standalone-settings"), custom);
}

function standaloneSettings() {
  const custom = $("#standalone-event-form").elements.rulesMode.value === "custom";
  return readEventSettings(selectedStandaloneEvent, $("#standalone-settings"), custom);
}

function createStandalonePlayers() {
  const names = $("#standalone-participants").value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  if (names.length < 2) throw new Error("Enter at least two participant names, one per line.");
  if (new Set(names.map((name) => name.toLocaleLowerCase())).size !== names.length) {
    throw new Error("Participant names must be unique.");
  }
  if (selectedStandaloneEvent.mechanic === "eurovision" && names.length < 3) {
    throw new Error("Eurovision needs at least three acts so every act can vote for other acts.");
  }
  return names.map((username, index) => ({
    id: `standalone-${index + 1}`,
    username,
    name: username,
    points: 0,
    appearance: defaultAppearance(index, username),
  }));
}

function getEurovisionRounds(players, settings) {
  const ballotPoints = settings.ballotPoints ?? eurovisionPoints;
  const groups = players.length <= settings.finalCutoff
    ? [{ label: "Final", contestants: players }]
    : (() => {
      const shuffled = randomOrder(players);
      const half = Math.ceil(shuffled.length / 2);
      return [
        { label: "Semi-final 1", contestants: shuffled.slice(0, half) },
        { label: "Semi-final 2", contestants: shuffled.slice(half) },
      ];
    })();
  return groups.map((group) => {
    const runningOrder = randomOrder(group.contestants);
    const ballotResults = eurovisionBallot(group.contestants, ballotPoints, group.contestants);
    const ballots = ballotResults.ballots;
    const results = rankResults(ballotResults);
    return { ...group, runningOrder, ballots, results };
  });
}

function revealStepMarkup(runner) {
  if (runner.phase === "reveal" && runner.revealedCount > 0) {
    const step = runner.steps[runner.revealedCount - 1];
    return `<div class="runner-reveal"><span class="runner-reveal-index">REVEAL ${runner.revealedCount} / ${runner.steps.length}</span><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.detail)}</p></div>`;
  }
  return "";
}

function renderStandaloneResults(results, includeDetails = true, allowSafeMarkup = false) {
  return `<div class="standalone-results-wrap"><table class="results-table">
    <thead><tr><th>PLACE</th><th>PARTICIPANT</th>${includeDetails ? "<th>RESULT</th>" : "<th>POINTS</th>"}</tr></thead>
    <tbody>${results.map((result) => `<tr><td>${String(result.rank).padStart(2, "0")}</td><th scope="row">${escapeHtml(result.name)}</th><td>${allowSafeMarkup ? result.detail ?? "" : escapeHtml(includeDetails ? result.detail ?? "" : String(result.points))}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

function renderEurovisionRoundResults(round) {
  return `<div class="runner-round-results">
    <h4>${escapeHtml(round.label)} results</h4>
    ${renderStandaloneResults(round.results.map((result) => ({
      ...result,
      detail: `${standaloneRunner.rounds.length > 1 && !standaloneRunner.finalRound && result.rank <= standaloneRunner.settings.qualifiersPerSemi ? "QUALIFIES · " : ""}${result.points} total${result.tieBreak !== "—" ? ` · ${result.tieBreak}` : ""}`,
    })))}
  </div>`;
}

function renderStandaloneRunner() {
  const runner = standaloneRunner;
  const panel = $("#standalone-runner");
  if (!runner) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  let content = "";
  let nextLabel = "";
  if (runner.type === "eurovision") {
    const round = runner.finalRound ?? runner.rounds[runner.roundIndex];
    if (runner.phase === "draw" || runner.phase === "final-draw") {
      const rounds = runner.phase === "draw" ? runner.rounds : [runner.finalRound];
      content = `<div class="runner-draw-results">${rounds.map((entry) => `
        <section><h4>${escapeHtml(entry.label)} · RUNNING ORDER</h4><ol>${entry.runningOrder.map((player) => `<li>${escapeHtml(player.username ?? player.name)}</li>`).join("")}</ol></section>`).join("")}</div>`;
      nextLabel = runner.phase === "final-draw" ? "Start final voting" : `Start ${round.label.toLocaleLowerCase()} voting`;
    } else if (runner.phase === "voting") {
      const ballots = round.ballots;
      const ballot = runner.lastBallot;
      content = `<div class="runner-ballot">
        <span class="runner-reveal-index">${runner.revealedBallots} / ${ballots.length} VOTES REVEALED</span>
        ${ballot ? `<h4>${escapeHtml(ballot.voterName)} votes</h4><ol>${ballot.votes.map((vote) => `<li><strong>${vote.points} points</strong> · ${escapeHtml(vote.name)}</li>`).join("")}</ol>` : "<p>Start revealing the individual participant ballots.</p>"}
      </div>`;
      nextLabel = runner.revealedBallots < ballots.length ? "Reveal next participant's vote" : `Show ${round.label.toLocaleLowerCase()} results`;
    } else if (runner.phase === "round-results") {
      content = renderEurovisionRoundResults(round);
      if (runner.finalRound) nextLabel = "Finish event";
      else if (runner.roundIndex < runner.rounds.length - 1) nextLabel = `Continue to ${runner.rounds[runner.roundIndex + 1].label.toLocaleLowerCase()}`;
      else if (runner.rounds.length > 1) nextLabel = "Draw final running order";
      else nextLabel = "Finish event";
    } else if (runner.phase === "complete") {
      content = `<h4>Final Eurovision results</h4>${renderStandaloneResults(runner.finalResults.map((result) => ({
        ...result,
        detail: `${result.points} points${result.tieBreak !== "—" ? ` · ${result.tieBreak}` : ""}`,
      })))}`;
    }
  } else if (runner.type === "random-ranking") {
    if (runner.phase === "turn-order") {
      content = `<div class="runner-draw-results"><section><h4>RANDOMIZED TURN ORDER</h4><ol>${runner.turnOrder.map((player) => `<li>${escapeHtml(player.username)}</li>`).join("")}</ol></section></div>`;
      nextLabel = "Begin random rank picks";
    } else if (runner.phase === "complete") {
      content = `<h4>Final random ranking</h4>${renderStandaloneResults([...runner.results].sort((left, right) => left.rank - right.rank))}`;
    } else {
      content = `<div class="random-ranking-draw">
          <div class="random-ranking-pick"><span class="runner-reveal-index">PICKED PARTICIPANT</span><strong>${escapeHtml(runner.selectedPlayer?.username ?? (runner.turnOrderRevealed ? runner.turnOrder[runner.results.length]?.username : "Ready to pick"))}</strong></div>
          <div class="random-ranking-rank"><span class="runner-reveal-index">RANK DRAW</span><strong>${runner.selectedRank ?? "?"}</strong></div>
        </div>
        <p class="runner-progress">${runner.results.length} ranked</p>`;
      if (runner.phase === "pick") nextLabel = "Pick a random participant";
      else if (runner.phase === "rank") nextLabel = "Draw random rank";
    }
  } else if (runner.type === "bottom-drop") {
    const round = runner.rounds[runner.roundIndex];
    const revealed = runner.phase === "round-drop";
    content = `<section class="bottom-drop-round">
      <h4>Round ${runner.roundIndex + 1}</h4>
      <ol>${round.order.map((entrant) => `<li class="${revealed && entrant.dropped ? "is-dropped" : ""}">${escapeHtml(entrant.name)}${revealed && entrant.dropped ? " · DROPPED" : ""}</li>`).join("")}</ol>
      ${revealed ? `<p>${round.dropped.length} dropped: ${round.dropped.map(escapeHtml).join(", ")}</p>` : ""}
    </section>`;
    nextLabel = revealed
      ? runner.roundIndex + 1 < runner.rounds.length ? "Reveal next round order" : "Show final results"
      : "Reveal dropped participants";
  } else if (runner.type === "catching") {
    if (runner.phase === "complete") {
      content = `<h4>Catching event results</h4>${renderStandaloneResults(runner.results)}`;
    } else {
      const round = runner.eventRounds[runner.roundIndex];
      const revealed = runner.phase === "round-catches";
      const names = new Map(runner.players.map((player) => [player.id, player.username ?? player.name]));
      const catches = Object.entries(round.caughtBy ?? {}).map(([id, count]) =>
        `${escapeHtml(names.get(id) ?? id)} catches ${count} ${escapeHtml(runner.settings.objectName.toLocaleLowerCase())}`).join(" · ");
      content = `<section class="bottom-drop-round">
        <h4>${round.isTiebreak ? `One-object tie-break ${round.round} · group ${round.group}` : `Round ${round.round}`}</h4>
        <ol>${round.order.map((entry) => `<li class="${entry.type === "object" ? "is-dropped" : ""}">${escapeHtml(entry.name)}</li>`).join("")}</ol>
        ${revealed ? `<p>${catches || "No object was caught; any remaining tie continues."}</p>` : ""}
      </section>`;
      nextLabel = revealed
        ? runner.roundIndex + 1 < runner.eventRounds.length ? "Reveal next round order" : "Show final results"
        : "Reveal catches";
    }
  } else if (runner.type === "bingo") {
    if (runner.phase === "boards") {
      content = `<h4>Participant Bingo boards</h4><div class="standalone-bingo-boards">${runner.results.map((result) => `<article><strong>${escapeHtml(result.name)}</strong>${eventDetailMarkup({ ...result, eventEndCallIndex: 0 }, true)}</article>`).join("")}</div>`;
      nextLabel = "Start Bingo";
    } else if (runner.phase === "calling") {
      const ball = runner.callOrder[runner.callIndex - 1];
      const letter = ["B", "I", "N", "G", "O"][Math.floor((ball - 1) / 15)];
      content = `<div class="runner-reveal"><span class="runner-reveal-index">BINGO BALL</span><strong>${letter}-${ball}</strong><p>${runner.results.filter((result) => result.lineCallNumbers.includes(runner.callIndex)).map((result) => `${result.name} completes a line`).join(" · ") || "No new line completed."}</p></div>
        <div class="standalone-bingo-boards">${runner.results.map((result) => `<article><strong>${escapeHtml(result.name)}</strong>${eventDetailMarkup({ ...result, eventEndCallIndex: runner.callIndex })}</article>`).join("")}</div>`;
      nextLabel = runner.callIndex < runner.endCallIndex ? "Draw next ball" : "End Bingo event";
    } else if (runner.phase === "complete") {
      content = `<div class="bingo-ended-banner">BINGO EVENT ENDED</div>${renderStandaloneResults(runner.results.map((result) => ({ ...result, detail: eventDetailMarkup({ ...result, eventEndCallIndex: runner.endCallIndex }) })), true, true)}`;
    }
  } else if (runner.phase === "complete") {
    content = `<h4>Final event results</h4>${renderStandaloneResults(runner.results)}`;
  } else {
    content = `${revealStepMarkup(runner)}<p class="runner-progress">${runner.revealedCount} of ${runner.steps.length} reveals shown.</p>`;
    nextLabel = runner.revealedCount < runner.steps.length ? runner.steps[runner.revealedCount]?.buttonLabel ?? "Reveal next result" : "Show final results";
  }
  const complete = runner.phase === "complete";
  panel.innerHTML = `
    <div class="runner-heading"><div><span class="eyebrow"><span class="eyebrow-line"></span> ${complete ? "EVENT COMPLETE" : "LIVE EVENT"}</span><h3>${escapeHtml(runner.eventTitle ?? runner.format.label)}</h3></div></div>
    ${content}
    ${complete ? "" : `<button class="button button-primary runner-next" id="standalone-next" type="button">${escapeHtml(nextLabel)} <span class="button-arrow">↗</span></button>`}
  `;
}

async function startStandaloneEvent(event) {
  const players = createStandalonePlayers();
  const settings = standaloneSettings();
  const panel = $("#standalone-runner");
  $("#standalone-error").textContent = "";
  $("#standalone-start").disabled = true;
  if (event.mechanic === "eurovision") {
    const rounds = getEurovisionRounds(players, settings);
    standaloneRunner = { type: "eurovision", format: event, settings, players, rounds, roundIndex: 0, phase: "draw", revealedBallots: 0, lastBallot: null, finalRound: null, finalResults: [] };
    renderStandaloneRunner();
    return;
  }
  if (event.mechanic === "random-ranking") {
    const turnOrder = randomOrder(players);
    standaloneRunner = {
      type: "random-ranking",
      format: event,
      settings,
      players,
      turnOrder,
      turnOrderRevealed: settings.revealTurnOrder,
      availableRanks: randomOrder(players.map((_, index) => index + 1)),
      results: [],
      phase: settings.revealTurnOrder ? "turn-order" : "pick",
      selectedPlayer: null,
      selectedRank: null,
    };
    renderStandaloneRunner();
    return;
  }
  try {
    const eventResults = await scoreEvent(players, event.mechanic, settings, event);
    const results = rankResults(eventResults);
    let steps;
    let type = "standard";
    if (event.mechanic === "bottom-drop") {
      type = "bottom-drop";
      standaloneRunner = {
        type,
        format: event,
        settings,
        results,
        rounds: results[0].bottomDropRounds,
        roundIndex: 0,
        phase: "round-order",
      };
    } else if (event.mechanic === "bingo") {
      type = "bingo";
      const endCallIndex = setBingoEndCall(results);
      standaloneRunner = {
        type,
        format: event,
        settings,
        results,
        callOrder: results[0].callOrder,
        endCallIndex,
        callIndex: 0,
        phase: "boards",
      };
    } else if (event.mechanic === "catching") {
      type = "catching";
      standaloneRunner = {
        type,
        format: event,
        eventTitle: eventResults.eventTitle,
        settings,
        players,
        results,
        eventRounds: eventResults.eventRounds,
        roundIndex: 0,
        phase: "round-order",
      };
    } else {
      const revealOrder = ["atomic-fusion", "country-choosing"].includes(event.mechanic)
        ? [...results].sort((left, right) => left.turn - right.turn)
        : results;
      steps = revealOrder.map((result) => ({ title: result.name, detail: result.detail ?? `${result.points} points` }));
      standaloneRunner = { type, format: event, settings, results, steps, phase: "reveal", revealedCount: 0 };
    }
    renderStandaloneRunner();
  } catch (error) {
    console.error(`Could not start ${event.label}.`, error);
    $("#standalone-error").textContent = `Could not start the event: ${error.message}`;
    $("#standalone-start").disabled = false;
    panel.hidden = true;
  }
}

function advanceStandaloneEvent() {
  const runner = standaloneRunner;
  if (!runner) return;
  if (runner.type === "random-ranking") {
    if (runner.phase === "turn-order") {
      runner.phase = "rank";
    } else if (runner.phase === "pick") {
      runner.selectedPlayer = randomOrder(runner.players.filter((player) => !runner.results.some((result) => result.id === player.id)))[0];
      runner.phase = "rank";
    } else if (runner.phase === "rank") {
      const rankIndex = Math.floor(Math.random() * runner.availableRanks.length);
      const [rank] = runner.availableRanks.splice(rankIndex, 1);
      runner.selectedRank = rank;
      const player = runner.turnOrderRevealed
        ? runner.turnOrder[runner.results.length]
        : runner.selectedPlayer;
      runner.results.push({
        id: player.id,
        name: player.username,
        rank,
        points: runner.players.length - rank,
        detail: `Random rank ${rank}`,
      });
      runner.selectedPlayer = null;
      runner.selectedRank = null;
      runner.phase = runner.results.length === runner.players.length
        ? "complete"
        : runner.turnOrderRevealed ? "rank" : "pick";
    }
    renderStandaloneRunner();
    return;
  }
  if (runner.type === "bottom-drop") {
    if (runner.phase === "round-order") {
      runner.phase = "round-drop";
    } else if (runner.phase === "round-drop") {
      runner.roundIndex += 1;
      runner.phase = runner.roundIndex === runner.rounds.length ? "complete" : "round-order";
    }
    renderStandaloneRunner();
    return;
  }
  if (runner.type === "catching") {
    if (runner.phase === "round-order") {
      runner.phase = "round-catches";
    } else if (runner.phase === "round-catches") {
      runner.roundIndex += 1;
      runner.phase = runner.roundIndex === runner.eventRounds.length ? "complete" : "round-order";
    }
    renderStandaloneRunner();
    return;
  }
  if (runner.type === "bingo") {
    if (runner.phase === "boards") {
      runner.phase = "calling";
      runner.callIndex = 1;
    } else if (runner.phase === "calling" && runner.callIndex < runner.endCallIndex) {
      runner.callIndex += 1;
    } else if (runner.phase === "calling") {
      runner.phase = "complete";
    }
    renderStandaloneRunner();
    return;
  }
  if (runner.type !== "eurovision") {
    if (runner.revealedCount < runner.steps.length) runner.revealedCount += 1;
    else runner.phase = "complete";
    renderStandaloneRunner();
    return;
  }
  if (runner.phase === "draw" || runner.phase === "final-draw") {
    runner.phase = "voting";
    runner.revealedBallots = 0;
    runner.lastBallot = null;
  } else if (runner.phase === "voting") {
    const ballots = (runner.finalRound ?? runner.rounds[runner.roundIndex]).ballots;
    if (runner.revealedBallots < ballots.length) {
      runner.lastBallot = ballots[runner.revealedBallots];
      runner.revealedBallots += 1;
    } else {
      runner.phase = "round-results";
    }
  } else if (runner.phase === "round-results") {
    if (runner.finalRound) {
      runner.finalResults = runner.finalRound.results;
      runner.phase = "complete";
    } else if (runner.roundIndex < runner.rounds.length - 1) {
      runner.roundIndex += 1;
      runner.phase = "draw";
    } else if (runner.rounds.length > 1) {
      const qualifiers = runner.rounds.flatMap((round) => round.results
        .slice(0, runner.settings.qualifiersPerSemi)
        .map((result) => round.contestants.find((player) => player.id === result.id)));
      runner.finalRound = {
        label: "Final",
        contestants: qualifiers,
        runningOrder: randomOrder(qualifiers),
        ballots: [],
      };
      const finalBallotResults = eurovisionBallot(runner.players, runner.settings.ballotPoints, qualifiers);
      runner.finalRound.ballots = finalBallotResults.ballots;
      runner.finalRound.results = rankResults(finalBallotResults);
      runner.phase = "final-draw";
    } else {
      runner.finalResults = runner.rounds[0].results;
      runner.phase = "complete";
    }
  }
  renderStandaloneRunner();
}

function closeOnBackdrop(event, dialog) {
  if (event.target === dialog) dialog.close();
}

seasonSetup.configure({
  $,
  eventFormats,
  escapeHtml,
  defaultPointTable,
  loadScoringProfiles,
  saveScoringProfile,
  makeRosterEntry,
  renderRosterEditor,
  readRosterDraftFromForm,
  resolveRosterIdentities,
  renderUserLibrary,
  updateLibrarySuggestions,
  archiveCurrentSeason: () => archiveSeason(state),
  saveCurrentSeason: saveSeasonToCloud,
  setSeason: (season) => { state = season; },
  createSeason,
  render,
  renderArchiveList,
  showToast,
});

supabaseConfigured = Boolean(window.RV_SUPABASE_CONFIG?.url && window.RV_SUPABASE_CONFIG?.publishableKey);
if (!supabaseConfigured) seedLibraries();
state = supabaseConfigured ? emptySeason() : loadSeason();
render();
renderUserLibrary();
loadSharedCatalog();
renderRosterEditor(20, supabaseConfigured ? Array.from({ length: 20 }, (_, index) => makeRosterEntry(index)) : makeDemoRoster());
renderEventCatalogue();

$("#draw-button").addEventListener("click", () => {
  drawEvent().catch((error) => showToast(`The season could not be saved: ${error.message}`, true));
});
$("#new-season-button").addEventListener("click", () => {
  if (supabaseConfigured && !authUser) {
    openAuth();
    return;
  }
  seasonSetup.open();
});
$("#auth-button").addEventListener("click", async () => {
  openAuth();
});
$("#account-logout").addEventListener("click", async () => {
  try {
    await supabaseService.signOut();
  } catch (error) {
    console.error("Could not sign out of the RV account.", error);
    showToast(`Sign out failed: ${error.message}`, true);
  }
});
$("#account-settings-button").addEventListener("click", () => {
  $("#account-menu").open = false;
  $("#account-settings-username").value = authUser?.user_metadata?.username ?? "";
  $("#account-settings-email").value = authUser?.email ?? "";
  for (const selector of ["#account-profile-message", "#account-email-message", "#account-password-message"]) {
    $(selector).textContent = "";
  }
  for (const selector of ["#account-email-password", "#account-password-current", "#account-password-new", "#account-password-confirm"]) {
    $(selector).value = "";
  }
  $("#account-settings-modal").showModal();
});
$("#account-profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("#account-profile-save");
  const username = $("#account-settings-username").value.trim();
  const message = $("#account-profile-message");
  message.textContent = "";
  submit.disabled = true;
  try {
    if (username.length < 3 || username.length > 32) throw new Error("Username must be between 3 and 32 characters.");
    authUser = await supabaseService.updateUsername(username);
    renderAccountControl();
    message.textContent = "Username updated.";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
$("#account-email-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("#account-email-save");
  const email = $("#account-settings-email").value.trim();
  const password = $("#account-email-password").value;
  const message = $("#account-email-message");
  message.textContent = "";
  submit.disabled = true;
  try {
    await supabaseService.reauthenticate(password);
    authUser = await supabaseService.updateEmail(email);
    renderAccountControl();
    message.textContent = "Email update requested. If confirmation is enabled, confirm the message sent to the new address.";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
$("#account-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("#account-password-save");
  const currentPassword = $("#account-password-current").value;
  const newPassword = $("#account-password-new").value;
  const message = $("#account-password-message");
  message.textContent = "";
  submit.disabled = true;
  try {
    if (newPassword.length < 8) throw new Error("The new password must be at least 8 characters long.");
    if (newPassword !== $("#account-password-confirm").value) throw new Error("The new passwords do not match.");
    await supabaseService.reauthenticate(currentPassword);
    await supabaseService.updatePassword(newPassword);
    $("#account-password-current").value = "";
    $("#account-password-new").value = "";
    $("#account-password-confirm").value = "";
    message.textContent = "Password changed.";
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
$("#auth-form").addEventListener("submit", submitAuthForm);
$("#auth-mode-toggle").addEventListener("click", () => setAuthMode(authMode === "signup" ? "signin" : "signup"));
$("#auth-forgot-password").addEventListener("click", async () => {
  const email = $("#auth-email").value.trim();
  if (!email) {
    $("#auth-message").textContent = "Enter your account email first.";
    return;
  }
  try {
    await supabaseService.sendPasswordReset(email);
    setAuthMode("reset-sent");
    $("#auth-message").textContent = "If an account exists for that address, Supabase accepted the reset request. Without an email provider, the reset message may not arrive.";
  } catch (error) {
    $("#auth-message").textContent = error.message;
  }
});
$("#rules-button").addEventListener("click", () => $("#rules-modal").showModal());
document.querySelectorAll("[data-workspace]").forEach((button) => {
  button.addEventListener("click", () => {
    const eventsMode = button.dataset.workspace === "events-view";
    $("#season-view").hidden = eventsMode;
    $("#events-view").hidden = !eventsMode;
    document.body.classList.toggle("events-mode", eventsMode);
    document.querySelectorAll("[data-workspace]").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
  });
});
$("#events-catalog").addEventListener("click", (event) => {
  const button = event.target.closest("[data-event-id]");
  if (!button) return;
  selectedStandaloneEvent = eventFormats.find((format) => format.mechanic === button.dataset.eventId) ?? eventFormats[0];
  renderEventCatalogue();
});
$("#season-event-choice").addEventListener("change", (event) => {
  state.selectedMechanic = event.currentTarget.value;
  state.eventSettingsKey = null;
  render();
});
document.querySelectorAll('input[name="seasonRulesMode"]').forEach((input) => {
  input.addEventListener("change", () => {
    setSettingsEnabled($("#season-event-settings"), document.querySelector('input[name="seasonRulesMode"]:checked').value === "custom");
  });
});
$("#standalone-event-form").elements.rulesMode.forEach((input) => {
  input.addEventListener("change", updateStandaloneSettingsAvailability);
});
$("#standalone-event-form").addEventListener("submit", (event) => {
  event.preventDefault();
  $("#standalone-error").textContent = "";
  startStandaloneEvent(selectedStandaloneEvent).catch((error) => {
    console.error(`Could not start ${selectedStandaloneEvent.label}.`, error);
    $("#standalone-error").textContent = `Could not start the event: ${error.message}`;
    $("#standalone-start").disabled = false;
  });
});
$("#standalone-reset").addEventListener("click", () => {
  standaloneRunner = null;
  $("#standalone-runner").hidden = true;
  $("#standalone-runner").innerHTML = "";
  $("#standalone-error").textContent = "";
  $("#standalone-start").disabled = false;
});
$("#standalone-runner").addEventListener("click", (event) => {
  if (event.target.closest("#standalone-next")) advanceStandaloneEvent();
});
$("#season-type").addEventListener("change", seasonSetup.updateFormat);
$("#setup-form").elements.finaleFormat.forEach((input) => {
  input.addEventListener("change", seasonSetup.updateFormat);
});
$("#participant-count").addEventListener("change", (event) => {
  const count = Math.max(20, Math.min(48, Number(event.currentTarget.value) || 20));
  event.currentTarget.value = String(count);
  const currentRoster = [...$("#roster-editor").querySelectorAll(".roster-entry")].map((row, index) => {
    syncDraftRow(row);
    const draft = rosterDraft[index];
    return { ...draft, imageData: draft.imageData ?? "" };
  });
  renderRosterEditor(count, currentRoster);
  seasonSetup.updateFormat();
});
$("#roster-editor").addEventListener("input", (event) => {
  const row = event.target.closest(".roster-entry");
  if (!row) return;
  syncDraftRow(row);
  if (event.target.matches("[data-color-picker]")) {
    const textInput = row.querySelector(`[data-roster-field="${event.target.dataset.colorPicker}"]`);
    if (textInput) textInput.value = event.target.value.toUpperCase();
    syncDraftRow(row);
  } else if (event.target.matches(".hex-text")) {
    const picker = row.querySelector(`[data-color-picker="${event.target.dataset.rosterField}"]`);
    if (picker && /^#[\da-f]{6}$/i.test(event.target.value)) picker.value = event.target.value;
  }
  const index = [...$("#roster-editor").querySelectorAll(".roster-entry")].indexOf(row);
  if (event.target.matches('[data-roster-field="username"]')) {
    const user = userLibrary.find((entry) => entry.username.toLocaleLowerCase() === event.target.value.trim().toLocaleLowerCase());
    const associatedColor = user?.lastColor ? findColorByName(user.lastColor) : null;
    if (associatedColor && index >= 0) {
      const colorInput = row.querySelector('[data-roster-field="colorName"]');
      colorInput.value = associatedColor.name;
      colorInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  if (event.target.matches('[data-roster-field="colorName"]')) {
    const color = findColorByName(event.target.value);
    if (color && index >= 0) {
      const styleSelect = row.querySelector('[data-roster-field="kind"]');
      styleSelect.value = color.kind;
      showRosterAppearance(row, color.kind);
      const solid = row.querySelector('[data-roster-field="solidHex"]');
      const gradientStart = row.querySelector('[data-roster-field="gradientStart"]');
      const gradientEnd = row.querySelector('[data-roster-field="gradientEnd"]');
      if (solid && (color.solidHex ?? color.solid_hex)) solid.value = color.solidHex ?? color.solid_hex;
      if (gradientStart && (color.gradientStart ?? color.gradient_start)) gradientStart.value = color.gradientStart ?? color.gradient_start;
      if (gradientEnd && (color.gradientEnd ?? color.gradient_end)) gradientEnd.value = color.gradientEnd ?? color.gradient_end;
      for (const key of ["solidHex", "gradientStart", "gradientEnd"]) {
        const picker = row.querySelector(`[data-color-picker="${key}"]`);
        const text = row.querySelector(`[data-roster-field="${key}"]`);
        if (picker && text && /^#[\da-f]{6}$/i.test(text.value)) picker.value = text.value;
      }
      rosterDraft[index].imageUrl = color.imageUrl ?? "";
      syncDraftRow(row);
    }
    const hex = color?.solidHex ?? color?.solid_hex ?? toHexColor(event.target.value);
    if (hex) {
      if (!color) {
        row.querySelector('[data-roster-field="kind"]').value = "color";
        showRosterAppearance(row, "color");
      }
      const input = row.querySelector('[data-roster-field="solidHex"]');
      if (input) input.value = hex;
      const picker = row.querySelector('[data-color-picker="solidHex"]');
      if (picker) picker.value = hex;
      syncDraftRow(row);
    }
  }
});
$("#roster-editor").addEventListener("change", (event) => {
  const row = event.target.closest(".roster-entry");
  if (!row) return;
  if (event.target.matches('[data-roster-field="kind"]')) {
    showRosterAppearance(row, event.target.value);
  }
  if (event.target.matches('[data-roster-field="imageFile"]')) {
    const index = [...$("#roster-editor").querySelectorAll(".roster-entry")].indexOf(row);
    if (index >= 0) {
      rosterDraft[index].imageUrl = "";
      const file = event.target.files?.[0];
      if (file) {
        if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 10 * 1024 * 1024) {
          showToast("Choose a JPEG, PNG, WebP, or GIF image that is 10 MB or smaller.", true);
          event.target.value = "";
          return;
        }
        const reader = new FileReader();
        reader.addEventListener("load", () => {
          rosterDraft[index].imageData = String(reader.result);
        });
        reader.addEventListener("error", () => showToast("The selected background image could not be read.", true));
        reader.readAsDataURL(file);
      }
    }
  }
  syncDraftRow(row);
});
$("#archive-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-archive-id]");
  if (button) {
    openArchivedSeason(button.dataset.archiveId).catch((error) => {
      console.error("Could not open the saved season archive.", error);
      showToast(`The season archive could not be opened: ${error.message}`, true);
    });
  }
});
$("#profile-library-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-rename-id]");
  if (button) renameUser(button.dataset.renameId);
});
$("#setup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('[type="submit"]');
  submitButton.disabled = true;
  seasonSetup.create(new FormData(event.currentTarget)).then((error) => {
    $("#form-error").textContent = error;
  }).catch((error) => {
    console.error("Could not start the RV season.", error);
    $("#form-error").textContent = `Could not start the season: ${error.message}`;
  }).finally(() => {
    submitButton.disabled = false;
  });
});
$("#rename-form").addEventListener("submit", (event) => {
  event.preventDefault();
  $("#rename-error").textContent = saveRenamedUser($("#rename-username").value);
});
document.querySelectorAll("[data-close-modal]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => closeOnBackdrop(event, dialog));
});
initializeAccount();
