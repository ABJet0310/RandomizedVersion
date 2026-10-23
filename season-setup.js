(function () {
  let services;
  let selectedScoringProfile = null;

  function eventLimit(seasonType, finaleFormat) {
    return seasonType === "playoffs" ? 20 : finaleFormat === "triple" ? 22 : 20;
  }

  function profileKey(name) {
    return name.trim().toLocaleLowerCase();
  }

  function findProfile(profiles, name) {
    const key = profileKey(name);
    return Object.prototype.hasOwnProperty.call(profiles, key) ? profiles[key] : null;
  }

  function parsePointTable(value, participantCount, eventNumber) {
    const points = value.split(",").map((entry) => Number(entry.trim()));
    if (points.length !== participantCount) {
      throw new Error(`Event ${eventNumber}: enter exactly ${participantCount} comma-separated rank scores.`);
    }
    if (points.some((point) => !Number.isInteger(point) || point < 0)) {
      throw new Error(`Event ${eventNumber}: rank scores must be non-negative whole numbers.`);
    }
    if (points.some((point, index) => index > 0 && points[index - 1] <= point)) {
      throw new Error(`Event ${eventNumber}: each lower rank must receive fewer points.`);
    }
    return points;
  }

  function renderProfileOptions(selectedName = "") {
    const select = services.$("#scoring-profile-select");
    const profiles = services.loadScoringProfiles();
    const selectedKey = profileKey(selectedName);
    select.innerHTML = `<option value="">Create a new point system</option>${Object.values(profiles)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((profile) => `<option value="${services.escapeHtml(profile.name)}"${profileKey(profile.name) === selectedKey ? " selected" : ""}>${services.escapeHtml(profile.name)}${profile.creatorName ? ` · by ${services.escapeHtml(profile.creatorName)}` : ""}</option>`).join("")}`;
  }

  function resizeProfileTable(values, count) {
    const points = [...values].slice(0, count);
    if (points.length && points.length < count) {
      const drop = points.length > 1 ? Math.max(1, points.at(-2) - points.at(-1)) : 1;
      while (points.length < count) points.push(Math.max(0, points.at(-1) - drop));
    }
    return points;
  }

  function renderPointSchedules(profile = selectedScoringProfile, forceProfile = false) {
    const { $ } = services;
    const container = $("#custom-point-schedules");
    const existing = [...container.querySelectorAll("[data-point-table]")].map((input) => ({
      value: input.value,
      edited: input.dataset.edited === "true",
    }));
    const count = Number($("#participant-count").value) || 20;
    const seasonType = $("#season-type").value;
    const finaleFormat = $("#setup-form").elements.finaleFormat.value;
    const limit = eventLimit(seasonType, finaleFormat);
    container.innerHTML = Array.from({ length: limit }, (_, index) => {
      const eventNumber = index + 1;
      const source = profile?.pointSchedules?.[Math.min(index, profile.pointSchedules.length - 1)];
      const defaultValues = services.defaultPointTable(eventNumber, count, finaleFormat);
      const profileValues = Array.isArray(source) ? resizeProfileTable(source, count) : null;
      const existingNumbers = existing[index]?.value.split(",").map((entry) => Number(entry.trim()));
      const adjustedExisting = existingNumbers?.length && existingNumbers.every(Number.isFinite)
        ? resizeProfileTable(existingNumbers, count)
        : null;
      const wasEdited = existing[index]?.edited ?? false;
      const useProfile = profileValues?.length === count && (forceProfile || !wasEdited);
      const values = useProfile
        ? profileValues
        : wasEdited && adjustedExisting?.length === count
          ? adjustedExisting
          : defaultValues;
      const edited = wasEdited && !useProfile;
      return `<label class="custom-point-row"><span>EVENT ${String(eventNumber).padStart(2, "0")} · RANK POINTS</span><textarea class="text-input" data-point-table data-edited="${edited}" data-event-number="${eventNumber}" rows="2" required>${services.escapeHtml(values.join(", "))}</textarea></label>`;
    }).join("");
  }

  function updateFormat() {
    const { $ } = services;
    const seasonType = $("#season-type").value;
    const finaleFormat = $("#setup-form").elements.finaleFormat.value;
    const isPlayoffs = seasonType === "playoffs";
    $("#finale-format-options").hidden = isPlayoffs;
    $("#standard-scoring-mode").disabled = isPlayoffs;
    $("#standard-scoring-label").hidden = isPlayoffs;
    $("#custom-point-system").hidden = isPlayoffs || $("#standard-scoring-mode").value !== "custom";
    $("#season-format-note").textContent = isPlayoffs
      ? "All participants compete in all 20 events. Rank 1 earns 40 points, rank 2 earns 35, then points descend by one through rank 35; rank 36 and below earn 1. Two randomly drawn active participants win one stage point per event. Qualification checkpoints reset only qualifiers’ points."
      : "Standard RV uses gradual rank-based points by default. Hosts may instead set a named custom point system for every event.";
    renderPointSchedules();
  }

  function loadProfile(profileName) {
    const { $ } = services;
    const profiles = services.loadScoringProfiles();
    const profile = findProfile(profiles, profileName);
    selectedScoringProfile = profile ?? null;
    $("#scoring-host-name").value = profile?.name ?? profileName;
    renderPointSchedules(profile ?? null, true);
  }

  function configure(dependencies) {
    services = dependencies;
    services.$("#standard-scoring-mode").addEventListener("change", updateFormat);
    services.$("#scoring-profile-select").addEventListener("change", (event) => {
      const name = event.currentTarget.value;
      try {
        if (name) loadProfile(name);
        else {
          selectedScoringProfile = null;
          services.$("#scoring-host-name").value = "";
          renderPointSchedules(null, true);
        }
      } catch (error) {
        services.$("#form-error").textContent = `Saved host point systems could not be loaded: ${error.message}`;
      }
    });
    services.$("#scoring-host-name").addEventListener("change", (event) => {
      const name = event.currentTarget.value.trim();
      try {
        renderProfileOptions(name);
        const matchingProfile = name ? findProfile(services.loadScoringProfiles(), name) : null;
        if (matchingProfile) loadProfile(matchingProfile.name);
        else selectedScoringProfile = null;
      } catch (error) {
        services.$("#form-error").textContent = `Saved host point systems could not be loaded: ${error.message}`;
      }
    });
    services.$("#custom-point-schedules").addEventListener("input", (event) => {
      if (event.target.matches("[data-point-table]")) event.target.dataset.edited = "true";
    });
  }

  function open() {
    const { $ } = services;
    $("#season-name").value = "Season 01";
    services.renderRosterEditor(20, Array.from({ length: 20 }, (_, index) => services.makeRosterEntry(index)));
    $("#participant-count").value = "20";
    $("#season-type").value = "standard";
    $("#setup-form").elements.finaleFormat.value = "single";
    $("#standard-scoring-mode").value = "gradual";
    $("#scoring-host-name").value = "";
    selectedScoringProfile = null;
    $("#custom-point-schedules").innerHTML = "";
    $("#form-error").textContent = "";
    try {
      renderProfileOptions();
      renderPointSchedules();
    } catch (error) {
      $("#form-error").textContent = `Saved host point systems could not be loaded: ${error.message}`;
    }
    updateFormat();
    $("#setup-modal").showModal();
  }

  async function create(formData) {
    const { $ } = services;
    const name = String(formData.get("seasonName") ?? "").trim();
    const expectedCount = Number(formData.get("participantCount"));
    const seasonType = formData.get("seasonType") === "playoffs" ? "playoffs" : "standard";
    const finaleFormat = seasonType === "playoffs" ? "single" : formData.get("finaleFormat") === "triple" ? "triple" : "single";
    const limit = eventLimit(seasonType, finaleFormat);
    if (!Number.isInteger(expectedCount) || expectedCount < 20 || expectedCount > 48) return "Choose between 20 and 48 participants.";

    let participants;
    let hostName = "";
    let pointSchedules = null;
    try {
      participants = await services.readRosterDraftFromForm();
      if (seasonType === "standard" && $("#standard-scoring-mode").value === "custom") {
        hostName = $("#scoring-host-name").value.trim();
        if (!hostName) return "Enter a name for the custom point system.";
        pointSchedules = [...$("#custom-point-schedules").querySelectorAll("[data-point-table]")]
          .map((input) => parsePointTable(input.value, expectedCount, Number(input.dataset.eventNumber)));
        if (pointSchedules.length !== limit) return `Enter a point table for all ${limit} events.`;
      }
    } catch (error) {
      return error.message;
    }

    const usernames = participants.map((entrant) => entrant.username.toLocaleLowerCase());
    const colors = participants.map((entrant) => entrant.colorName.toLocaleLowerCase());
    if (!name) return "Give your season a name.";
    if (participants.length !== expectedCount) return `Add details for all ${expectedCount} participants.`;
    if (participants.some((entrant) => !entrant.username || !entrant.colorName)) return "Every participant needs both a username and a color name.";
    if (new Set(usernames).size !== usernames.length) return "Each username can appear only once in a season.";
    if (new Set(colors).size !== colors.length) return "Each color name can appear only once in a season.";
    for (const entrant of participants) {
      if (entrant.kind === "color" && !/^#[\da-f]{6}$/i.test(entrant.solidHex)) return `${entrant.colorName}: enter a valid solid hex color.`;
      if (entrant.kind === "gradient" && (!/^#[\da-f]{6}$/i.test(entrant.gradientStart) || !/^#[\da-f]{6}$/i.test(entrant.gradientEnd))) {
        return `${entrant.colorName}: enter valid hex colors for both gradient stops.`;
      }
    }
    if (participants.some((entrant) => entrant.kind === "image" && !entrant.imageData && !entrant.imageUrl)) {
      return "Choose an image background for every participant using the image style.";
    }

    const normalizedRoster = services.resolveRosterIdentities(participants);
    if (pointSchedules) {
      const untouchedSharedSystem = selectedScoringProfile
        && !selectedScoringProfile.canEdit
        && profileKey(hostName) === profileKey(selectedScoringProfile.name)
        && [...$("#custom-point-schedules").querySelectorAll("[data-point-table]")]
          .every((input) => input.dataset.edited !== "true");
      if (!untouchedSharedSystem) {
        try {
          await services.saveScoringProfile(hostName, {
            name: hostName,
            participantCount: expectedCount,
            eventLimit: limit,
            pointSchedules,
          });
        } catch (error) {
          return `Could not save the point system: ${error.message}`;
        }
      }
    }
    services.renderUserLibrary();
    services.updateLibrarySuggestions();
    services.archiveCurrentSeason();
    const season = services.createSeason(name, normalizedRoster, finaleFormat, seasonType, hostName, pointSchedules);
    services.setSeason(season);
    try {
      await services.saveCurrentSeason(season);
    } catch (error) {
      return `The season could not be saved to your account: ${error.message}`;
    }
    $("#event-notice").textContent = "";
    $("#setup-modal").close();
    services.render();
    services.renderArchiveList();
    services.showToast(`${name} is ready. Choose each event when you are ready to start it.`);
    return "";
  }

  window.RV_SEASON_SETUP = {
    configure,
    eventLimit,
    open,
    updateFormat,
    create,
  };
})();
