(() => {
  let client = null;

  function initialize() {
    const config = window.RV_SUPABASE_CONFIG ?? {};
    if (!config.url || !config.publishableKey) return null;
    if (!window.supabase?.createClient) {
      throw new Error("The Supabase client library could not be loaded. Check your internet connection and reload.");
    }
    client ??= window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
    return client;
  }

  function getClient() {
    if (!client) throw new Error("Supabase is not configured. Add the project URL and publishable key before using accounts.");
    return client;
  }

  function redirectUrl() {
    const configuredSiteUrl = window.RV_SUPABASE_CONFIG?.siteUrl?.trim();
    if (configuredSiteUrl) return configuredSiteUrl;
    return `${window.location.origin}${window.location.pathname}`;
  }

  async function signUp(email, password, username) {
    const { data, error } = await getClient().auth.signUp({
      email,
      password,
      options: {
        data: { username },
        emailRedirectTo: redirectUrl(),
      },
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await getClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await getClient().auth.signOut();
    if (error) throw error;
  }

  async function sendPasswordReset(email) {
    const { error } = await getClient().auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl(),
    });
    if (error) throw error;
  }

  async function updatePassword(password) {
    const { error } = await getClient().auth.updateUser({ password });
    if (error) throw error;
  }

  async function getSession() {
    const { data, error } = await getClient().auth.getSession();
    if (error) throw error;
    return data.session;
  }

  function onAuthStateChange(callback) {
    const { data, error } = getClient().auth.onAuthStateChange(callback);
    if (error) throw error;
    return data.subscription;
  }

  async function loadSeasons() {
    const { data, error } = await getClient()
      .from("rv_saved_seasons")
      .select("season_id,season_data,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data.map((row) => row.season_data);
  }

  async function saveSeason(season) {
    const user = (await getSession())?.user;
    if (!user) throw new Error("Sign in before saving a season.");
    const { error } = await getClient()
      .from("rv_saved_seasons")
      .upsert({
        owner_id: user.id,
        season_id: String(season.id),
        season_data: season,
        updated_at: new Date().toISOString(),
      }, { onConflict: "owner_id,season_id" });
    if (error) throw error;
  }

  async function uploadSeasonImages(season) {
    const user = (await getSession())?.user;
    if (!user) throw new Error("Sign in before uploading season backgrounds.");
    const storage = getClient().storage.from("rv-season-backgrounds");
    for (const player of season.players ?? []) {
      const appearance = player.appearance;
      if (!appearance?.imageData?.startsWith("data:image/")) continue;
      const response = await fetch(appearance.imageData);
      if (!response.ok) throw new Error(`Could not prepare the image background for ${player.colorName ?? player.name}.`);
      const blob = await response.blob();
      const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[blob.type];
      if (!extension) throw new Error(`Unsupported image type for ${player.colorName ?? player.name}.`);
      const path = `${user.id}/seasons/${encodeURIComponent(String(season.id))}/${encodeURIComponent(String(player.id))}.${extension}`;
      const { error } = await storage.upload(path, blob, {
        contentType: blob.type,
        upsert: true,
      });
      if (error) throw error;
      appearance.imagePath = path;
      appearance.imageData = "";
    }
    await hydrateSeasonImages([season]);
  }

  async function hydrateSeasonImages(seasons) {
    const storage = getClient().storage.from("rv-season-backgrounds");
    const appearances = seasons.flatMap((season) => (season.players ?? [])
      .map((player) => player.appearance)
      .filter((appearance) => appearance?.imagePath));
    await Promise.all(appearances.map(async (appearance) => {
      if (appearance.imageUrl && appearance.imageUrlExpiresAt > Date.now() + 60_000) return;
      const { data, error } = await storage.createSignedUrl(appearance.imagePath, 3600);
      if (error) throw error;
      appearance.imageUrl = data.signedUrl;
      appearance.imageUrlExpiresAt = Date.now() + 3600_000;
    }));
  }

  async function loadPointSystems() {
    const user = (await getSession())?.user;
    const { data, error } = await getClient()
      .from("rv_point_systems")
      .select("id,name,creator_name,creator_id,participant_count,event_limit,point_schedules,updated_at")
      .order("name", { ascending: true });
    if (error) throw error;
    return data.map((row) => ({
      id: row.id,
      name: row.name,
      creatorName: row.creator_name,
      creatorId: row.creator_id,
      canEdit: row.creator_id === user?.id,
      participantCount: row.participant_count,
      eventLimit: row.event_limit,
      pointSchedules: row.point_schedules,
      savedAt: row.updated_at,
    }));
  }

  async function savePointSystem(profile) {
    const user = (await getSession())?.user;
    if (!user) throw new Error("Sign in before publishing a point system.");
    const payload = {
      creator_id: user.id,
      creator_name: profile.creatorName || profile.name,
      name: profile.name.trim(),
      participant_count: profile.participantCount,
      event_limit: profile.eventLimit,
      point_schedules: profile.pointSchedules,
      updated_at: new Date().toISOString(),
    };
    const { data: existing, error: lookupError } = await getClient()
      .from("rv_point_systems")
      .select("id")
      .eq("creator_id", user.id)
      .eq("name_key", profile.name.trim().toLocaleLowerCase())
      .maybeSingle();
    if (lookupError) throw lookupError;
    const query = existing
      ? getClient().from("rv_point_systems").update(payload).eq("id", existing.id)
      : getClient().from("rv_point_systems").insert(payload);
    const { error } = await query;
    if (error) {
      if (error.code === "23505") throw new Error("That point-system name is already in use. Choose a unique name so everyone can tell the systems apart.");
      throw error;
    }
  }

  window.RV_SUPABASE = {
    initialize,
    getSession,
    onAuthStateChange,
    signUp,
    signIn,
    signOut,
    sendPasswordReset,
    updatePassword,
    loadSeasons,
    saveSeason,
    uploadSeasonImages,
    hydrateSeasonImages,
    loadPointSystems,
    savePointSystem,
  };
})();
