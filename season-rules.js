(function () {
  const playoffCheckpoints = new Map([
    [10, { qualifiers: 16, resetPoints: 1000, label: "Top 16 qualify" }],
    [13, { qualifiers: 12, resetPoints: 2000, label: "Top 12 qualify" }],
    [16, { qualifiers: 8, resetPoints: 3000, label: "Top 8 qualify" }],
    [19, { qualifiers: 4, resetPoints: 4000, label: "Top 4 qualify" }],
  ]);

  function standings(players, { useWins = false, priorOrder = [] } = {}) {
    const previousPosition = new Map(priorOrder.map((id, index) => [id, index]));
    return [...players].sort((left, right) => {
      if (useWins && right.wins !== left.wins) return (right.wins ?? 0) - (left.wins ?? 0);
      if (right.points !== left.points) return right.points - left.points;
      const previousDifference = (previousPosition.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (previousPosition.get(right.id) ?? Number.MAX_SAFE_INTEGER);
      if (previousDifference) return previousDifference;
      return players.indexOf(left) - players.indexOf(right);
    });
  }

  function snapshot(players, order) {
    return order.map((player, index) => ({
      id: player.id,
      name: player.username ?? player.name,
      rank: index + 1,
      wins: player.wins ?? 0,
      stageWins: player.stageWins ?? 0,
      stagePoints: player.stagePoints ?? 0,
      points: player.points,
      active: player.active,
      qualified: player.playoffQualified !== false,
    }));
  }

  function playoffPointsForRank(rank) {
    if (rank === 1) return 40;
    if (rank === 2) return 35;
    if (rank <= 35) return 37 - rank;
    return 1;
  }

  function awardPlayoffPoints(results) {
    for (const result of results) {
      result.performanceScore = result.points;
      result.points = playoffPointsForRank(result.rank);
    }
  }

  function awardStagePoints(players, randomOrder) {
    const eligible = players.filter((player) => player.active);
    if (!eligible.length) throw new Error("There are no active participants available for the Playoffs stages.");
    return Array.from({ length: 2 }, () => {
      const winner = randomOrder(eligible)[0];
      winner.stageWins = (winner.stageWins ?? 0) + 1;
      winner.stagePoints = (winner.stagePoints ?? 0) + 1;
      return { id: winner.id, name: winner.username ?? winner.name, points: 1 };
    });
  }

  function applyPlayoffCheckpoint(season, eventNumber, priorOrder = []) {
    const checkpoint = playoffCheckpoints.get(eventNumber);
    if (!checkpoint) return null;

    const beforeOrder = standings(season.players, {
      useWins: eventNumber === 10,
      priorOrder,
    });
    const before = snapshot(season.players, beforeOrder);
    const eligiblePlayers = season.players.filter((player) => player.active && player.playoffQualified !== false);
    const qualifierOrder = standings(eligiblePlayers, {
      useWins: eventNumber === 10,
      priorOrder,
    });
    const qualifiers = new Set(qualifierOrder.slice(0, checkpoint.qualifiers).map((player) => player.id));
    const stageBonusApplied = eventNumber !== 19;
    const notQualified = eligiblePlayers.filter((player) => !qualifiers.has(player.id))
      .map((player) => ({ id: player.id, name: player.username ?? player.name }));

    for (const player of season.players) {
      if (!player.active) continue;
      if (!qualifiers.has(player.id)) {
        player.playoffQualified = false;
        continue;
      }
      player.points = checkpoint.resetPoints + (stageBonusApplied ? player.stagePoints ?? 0 : 0);
    }

    const afterOrder = standings(season.players, { priorOrder: beforeOrder.map((player) => player.id) });
    return {
      eventNumber,
      label: checkpoint.label,
      resetPoints: checkpoint.resetPoints,
      stageBonusApplied,
      qualifiers: qualifierOrder.slice(0, checkpoint.qualifiers).map((player) => player.id),
      notQualified,
      eliminated: [],
      before: snapshot(season.players, beforeOrder),
      after: snapshot(season.players, afterOrder),
    };
  }

  window.RV_SEASON_RULES = {
    awardPlayoffPoints,
    awardStagePoints,
    applyPlayoffCheckpoint,
    playoffPointsForRank,
    standings,
  };
})();
