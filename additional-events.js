(function () {
  const wordIndexes = new Map();
  const handNames = {
    1: "High card",
    2: "One pair",
    3: "Two pair",
    4: "Three of a kind",
    5: "Straight",
    6: "Flush",
    7: "Full house",
    8: "Four of a kind",
    9: "Straight flush",
  };

  function intSetting(settings, key, fallback) {
    const value = Number(settings[key] ?? fallback);
    if (!Number.isInteger(value)) throw new Error(`${key} must be a whole number.`);
    return value;
  }

  function drawWord(length) {
    if (!wordIndexes.has(length)) {
      wordIndexes.set(length, window.RV_LETTER_WORDS.filter((word) => word.length === length));
    }
    const words = wordIndexes.get(length);
    if (!words?.length) throw new Error(`The bundled dictionary has no ${length}-letter words.`);
    return words[Math.floor(Math.random() * words.length)];
  }

  function wordResult(word, player) {
    const values = [...word].map((letter) => letter.charCodeAt(0) - 96);
    const sum = values.reduce((total, value) => total + value, 0);
    const highestLetter = Math.max(...values);
    const average = sum / values.length;
    return {
      id: player.id,
      name: player.username ?? player.name,
      points: average,
      eventTiebreakScore: [highestLetter],
      eventTiebreakLabels: ["Highest-value letter"],
      eventTiebreakDisplay: [`${String.fromCharCode(highestLetter + 96).toUpperCase()} (${highestLetter})`],
      detail: `${word.toUpperCase()} · ${sum} ÷ ${values.length} = ${average.toFixed(2)}`,
      word,
      wordLength: values.length,
      highestLetter,
    };
  }

  function letterValues(players, settings, randomOrder) {
    const minimum = intSetting(settings, "minimumLetters", 3);
    const maximum = intSetting(settings, "maximumLetters", 12);
    if (minimum < 3 || maximum > 12 || maximum < minimum) {
      throw new Error("Letter length must be between 3 and 12, with the maximum at least the minimum.");
    }
    const tieBreaker = settings.tieBreaker ?? "highest-letter";
    const results = players.map((player) => {
      const length = settings.randomLength === false
        ? minimum
        : minimum + Math.floor(Math.random() * (maximum - minimum + 1));
      return wordResult(drawWord(length), player);
    });
    if (tieBreaker === "longest-word") {
      for (const result of results) {
        result.eventTiebreakScore = [result.wordLength];
        result.eventTiebreakLabels = ["Word length"];
        result.eventTiebreakDisplay = [`${result.wordLength} letters`];
      }
    } else if (tieBreaker === "go-again") {
      for (const result of results) {
        result.eventTiebreakScore = [];
        result.eventTiebreakLabels = [];
        result.eventTiebreakDisplay = [];
      }
      let round = 0;
      let ties = tiedGroups(results);
      while (ties.length) {
        round += 1;
        if (round > 500) throw new Error("The Letter Values tie-break did not resolve after 500 extra words.");
        for (const group of ties) {
          for (const result of group) {
            const extra = wordResult(drawWord(result.wordLength), { id: result.id, name: result.name });
            result.eventTiebreakScore.push(extra.points);
            result.eventTiebreakLabels.push(`Go-again word ${round} average`);
            result.eventTiebreakDisplay.push(extra.points.toFixed(2));
            result.detail += ` · tie-break ${extra.detail}`;
          }
        }
        ties = tiedGroups(results);
      }
    }
    return results;
  }

  function addObjectsToList(players, objectCount, objectName, randomOrder) {
    const entries = [
      ...players.map((player) => ({ type: "participant", id: player.id, name: player.username ?? player.name })),
      ...Array.from({ length: objectCount }, (_, index) => ({ type: "object", id: `object-${index + 1}`, name: objectName })),
    ];
    return randomOrder(entries);
  }

  function catchRound(players, objectCount, objectName, randomOrder, roundNumber, isTiebreak = false) {
    const order = addObjectsToList(players, objectCount, objectName, randomOrder);
    const catches = new Map(players.map((player) => [player.id, 0]));
    for (let index = 0; index < order.length;) {
      if (order[index].type !== "object") {
        index += 1;
        continue;
      }
      let end = index + 1;
      while (end < order.length && order[end].type === "object") end += 1;
      const catcher = order[index - 1];
      if (catcher?.type === "participant") catches.set(catcher.id, catches.get(catcher.id) + end - index);
      index = end;
    }
    return {
      round: roundNumber,
      isTiebreak,
      order,
      catches: Object.fromEntries(catches),
      caughtBy: Object.fromEntries([...catches].filter(([, count]) => count > 0)),
    };
  }

  function tiedGroups(results, randomOrder) {
    const scoreGroups = new Map();
    for (const result of results) {
      if (!scoreGroups.has(result.points)) scoreGroups.set(result.points, []);
      scoreGroups.get(result.points).push(result);
    }
    const ties = [];
    for (const group of scoreGroups.values()) {
      if (group.length > 1) {
        const vectorGroups = new Map();
        for (const result of group) {
          const vector = JSON.stringify(result.eventTiebreakScore ?? []);
          if (!vectorGroups.has(vector)) vectorGroups.set(vector, []);
          vectorGroups.get(vector).push(result);
        }
        for (const vectorGroup of vectorGroups.values()) {
          if (vectorGroup.length > 1) ties.push(vectorGroup);
        }
      }
    }
    return ties;
  }

  function catching(players, settings, randomOrder) {
    const rounds = intSetting(settings, "rounds", 30);
    const objectName = String(settings.objectName ?? "Wenycats").trim();
    if (rounds < 1 || rounds > 100) throw new Error("Catching rounds must be between 1 and 100.");
    if (!objectName) throw new Error("Enter a name for the objects in the Catching event.");

    const eventRounds = Array.from({ length: rounds }, (_, index) =>
      catchRound(players, 3, objectName, randomOrder, index + 1));
    const totals = new Map(players.map((player) => [player.id, 0]));
    for (const round of eventRounds) {
      for (const [id, count] of Object.entries(round.catches)) totals.set(id, totals.get(id) + count);
    }
    const results = players.map((player) => ({
      id: player.id,
      name: player.username ?? player.name,
      points: totals.get(player.id),
      eventTiebreakScore: [],
      eventTiebreakLabels: [],
      eventTiebreakDisplay: [],
      detail: `${totals.get(player.id)} ${objectName.toLocaleLowerCase()} caught in ${rounds} rounds`,
    }));

    let tieRound = 0;
    let ties = tiedGroups(results, randomOrder);
    while (ties.length) {
      tieRound += 1;
      if (tieRound > 500) throw new Error("The Catching tie-break did not resolve after 500 one-object rounds.");
      for (const [groupIndex, group] of ties.entries()) {
        const tiedIds = new Set(group.map((result) => result.id));
        const tiedPlayers = players.filter((player) => tiedIds.has(player.id));
        const round = catchRound(tiedPlayers, 1, objectName, randomOrder, tieRound, true);
        round.tiedParticipants = group.map((result) => result.name);
        round.group = groupIndex + 1;
        eventRounds.push(round);
        for (const result of group) {
          result.eventTiebreakScore.push(round.catches[result.id] ?? 0);
          result.eventTiebreakLabels.push(`One-object round ${tieRound}`);
          result.eventTiebreakDisplay.push(`${round.catches[result.id] ?? 0} caught`);
        }
      }
      ties = tiedGroups(results, randomOrder);
    }
    results.eventRounds = eventRounds;
    results.eventTitle = `Catching ${objectName}`;
    return results;
  }

  function survivalArena(players, settings, randomOrder) {
    const maximumRounds = intSetting(settings, "maximumRounds", 30);
    const eliminationPercent = intSetting(settings, "eliminationPercent", 24);
    if (maximumRounds < 1 || maximumRounds > 60) throw new Error("Survival rounds must be between 1 and 60.");
    if (eliminationPercent < 1 || eliminationPercent > 90) throw new Error("Elimination chance must be between 1% and 90%.");
    const remaining = new Set(players.map((player) => player.id));
    const elimination = new Map();
    const eventRounds = [];
    const phaseNames = ["Opening scramble", "Day", "Night"];
    const events = [
      "finds a sheltered route",
      "secures a useful supply cache",
      "avoids a sudden weather shift",
      "takes a safer path around an obstacle",
      "forms a temporary alliance",
      "finds a quiet place to recover",
      "is caught out by a changing arena",
      "loses time searching for supplies",
      "chooses a risky route and falls behind",
      "is forced to leave after a difficult encounter",
    ];
    const opening = { round: 0, phase: "Opening scramble", events: [] };
    for (const player of randomOrder(players)) {
      if (Math.random() < 0.18 && players.length > 1) {
        remaining.delete(player.id);
        elimination.set(player.id, { round: 0, phase: "Opening scramble", detail: "Left during the opening scramble" });
        opening.events.push({ id: player.id, name: player.username ?? player.name, detail: "left during the opening scramble" });
      }
    }
    if (!remaining.size) {
      const last = randomOrder(players)[0];
      remaining.add(last.id);
      elimination.delete(last.id);
      const lastEvent = opening.events.findIndex((entry) => entry.id === last.id);
      if (lastEvent >= 0) opening.events.splice(lastEvent, 1);
      opening.events.push({ id: last.id, name: last.username ?? last.name, detail: "made it through the opening scramble" });
    }
    eventRounds.push(opening);

    for (let round = 1; round <= maximumRounds && remaining.size > 1; round += 1) {
      const phase = phaseNames[1 + ((round - 1) % 2)];
      const eventsThisRound = [];
      const contenders = randomOrder(players.filter((player) => remaining.has(player.id)));
      for (const player of contenders) {
        const roll = Math.random() * 100;
        const event = events[Math.floor(Math.random() * events.length)];
        if (roll < eliminationPercent) {
          remaining.delete(player.id);
          const detail = `${phase}: ${event}`;
          elimination.set(player.id, { round, phase, detail });
          eventsThisRound.push({ id: player.id, name: player.username ?? player.name, detail });
        }
      }
      if (!remaining.size) {
        const last = contenders[Math.floor(Math.random() * contenders.length)];
        remaining.add(last.id);
        elimination.delete(last.id);
        const lastEvent = eventsThisRound.findIndex((entry) => entry.id === last.id);
        if (lastEvent >= 0) eventsThisRound.splice(lastEvent, 1);
        eventsThisRound.push({ id: last.id, name: last.username ?? last.name, detail: `${phase}: remained in the contest` });
      }
      eventRounds.push({ round, phase, events: eventsThisRound });
    }

    let finaleRound = maximumRounds + 1;
    while (remaining.size > 1) {
      const contenders = randomOrder(players.filter((player) => remaining.has(player.id)));
      const eliminated = contenders.slice(1);
      for (const player of eliminated) {
        remaining.delete(player.id);
        elimination.set(player.id, {
          round: finaleRound,
          phase: "Finale",
          detail: "Did not advance through the sudden-decision finale",
        });
      }
      eventRounds.push({
        round: finaleRound,
        phase: "Finale",
        events: eliminated.map((player) => ({
          id: player.id,
          name: player.username ?? player.name,
          detail: "did not advance through the sudden-decision finale",
        })),
      });
      finaleRound += 1;
    }

    const winnerId = [...remaining][0];
    const finalRound = Math.max(...[...elimination.values()].map((entry) => entry.round), 0) + 1;
    const results = players.map((player) => {
      const outcome = elimination.get(player.id);
      const survivalRound = player.id === winnerId ? finalRound : outcome.round;
      return {
        id: player.id,
        name: player.username ?? player.name,
        points: survivalRound,
        eventTiebreakScore: [Math.random()],
        eventTiebreakLabels: ["Random survival draw"],
        eventTiebreakDisplay: ["Randomized"],
        detail: player.id === winnerId
          ? `Won the survival simulation after ${eventRounds.length} phases`
          : `${outcome.detail} · phase ${survivalRound}`,
        survivalRound,
      };
    });
    results.eventRounds = eventRounds;
    return results;
  }

  function cards() {
    const suits = ["♣", "♦", "♥", "♠"];
    return suits.flatMap((suit) => Array.from({ length: 13 }, (_, index) => ({
      rank: index + 2,
      suit,
      label: `${["", "", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"][index + 2]}${suit}`,
    })));
  }

  function shuffledDeck(decks, randomOrder) {
    return randomOrder(Array.from({ length: decks }, () => cards()).flat());
  }

  function cardValue(card) {
    return card.rank === 14 ? 1 : Math.min(card.rank, 10);
  }

  function blackjackTotal(hand) {
    let total = hand.reduce((sum, card) => sum + cardValue(card), 0);
    let aces = hand.filter((card) => card.rank === 14).length;
    while (aces > 0 && total + 10 <= 21) {
      total += 10;
      aces -= 1;
    }
    return total;
  }

  function blackjack(players, randomOrder) {
    let deck = shuffledDeck(6, randomOrder);
    let cursor = 0;
    const draw = () => {
      if (cursor >= deck.length) {
        deck = shuffledDeck(6, randomOrder);
        cursor = 0;
      }
      return deck[cursor++];
    };
    const dealer = [draw(), draw()];
    const hands = players.map((player) => ({ player, hand: [draw(), draw()] }));
    for (const entry of hands) {
      while (blackjackTotal(entry.hand) < 17) entry.hand.push(draw());
    }
    while (blackjackTotal(dealer) < 17) dealer.push(draw());
    const dealerTotal = blackjackTotal(dealer);
    const dealerNatural = dealer.length === 2 && dealerTotal === 21;
    const results = hands.map(({ player, hand }) => {
      const total = blackjackTotal(hand);
      const natural = hand.length === 2 && total === 21;
      let outcome;
      let outcomePoints;
      if (total > 21) {
        outcome = "Bust";
        outcomePoints = 0;
      } else if (natural && dealerNatural) {
        outcome = "Push";
        outcomePoints = 2;
      } else if (natural) {
        outcome = "Natural blackjack";
        outcomePoints = 4;
      } else if (dealerNatural) {
        outcome = "Dealer wins";
        outcomePoints = 1;
      } else if (dealerTotal > 21 || total > dealerTotal) {
        outcome = "Beat the dealer";
        outcomePoints = 3;
      } else if (total === dealerTotal) {
        outcome = "Push";
        outcomePoints = 2;
      } else {
        outcome = "Dealer wins";
        outcomePoints = 1;
      }
      return {
        id: player.id,
        name: player.username ?? player.name,
        points: outcomePoints,
        eventTiebreakScore: [outcomePoints === 0 ? -total : total, dealerTotal],
        eventTiebreakLabels: ["Hand total", "Dealer total"],
        eventTiebreakDisplay: [`${total}`, `${dealerTotal}`],
        detail: `${hand.map((card) => card.label).join(" ")} · ${total} · ${outcome} (dealer ${dealer.map((card) => card.label).join(" ")} · ${dealerTotal})`,
        hand: hand.map((card) => card.label),
        dealer: dealer.map((card) => card.label),
        outcome,
        total,
      };
    });
    results.eventTiebreakLabels = ["Hand total", "Dealer total"];
    return results;
  }

  function pokerHand(cardsInHand) {
    const ranks = cardsInHand.map((card) => card.rank).sort((left, right) => right - left);
    const counts = new Map();
    for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
    const groups = [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0]);
    const flush = cardsInHand.every((card) => card.suit === cardsInHand[0].suit);
    const distinct = [...new Set(ranks)];
    if (distinct.includes(14)) distinct.push(1);
    let straightHigh = 0;
    for (let index = 0; index <= distinct.length - 5; index += 1) {
      if (distinct[index] - distinct[index + 4] === 4) {
        straightHigh = distinct[index];
        break;
      }
    }
    if (flush && straightHigh) return [9, straightHigh];
    if (groups[0][1] === 4) return [8, groups[0][0], groups[1][0]];
    if (groups[0][1] === 3 && groups[1][1] === 2) return [7, groups[0][0], groups[1][0]];
    if (flush) return [6, ...ranks];
    if (straightHigh) return [5, straightHigh];
    if (groups[0][1] === 3) return [4, groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)];
    if (groups[0][1] === 2 && groups[1][1] === 2) {
      const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
      return [3, ...pairs, groups[2][0]];
    }
    if (groups[0][1] === 2) return [2, groups[0][0], ...groups.slice(1).map(([rank]) => rank).sort((a, b) => b - a)];
    return [1, ...ranks];
  }

  function compareVectors(left, right) {
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const difference = (right[index] ?? 0) - (left[index] ?? 0);
      if (difference) return difference;
    }
    return 0;
  }

  function texasHoldem(players, randomOrder) {
    const shuffledPlayers = randomOrder(players);
    const tableSize = 23;
    const tables = [];
    for (let index = 0; index < shuffledPlayers.length; index += tableSize) {
      const contestants = shuffledPlayers.slice(index, index + tableSize);
      const deck = shuffledDeck(1, randomOrder);
      const holes = new Map(contestants.map((player) => [player.id, [deck.pop(), deck.pop()]]));
      const board = Array.from({ length: 5 }, () => deck.pop());
      tables.push({ contestants, holes, board });
    }
    const results = [];
    for (const [tableIndex, table] of tables.entries()) {
      for (const player of table.contestants) {
        const hand = [...table.holes.get(player.id), ...table.board];
        let best = null;
        let bestCards = [];
        for (let first = 0; first < hand.length - 4; first += 1) {
          for (let second = first + 1; second < hand.length - 3; second += 1) {
            for (let third = second + 1; third < hand.length - 2; third += 1) {
              for (let fourth = third + 1; fourth < hand.length - 1; fourth += 1) {
                for (let fifth = fourth + 1; fifth < hand.length; fifth += 1) {
                  const selection = [hand[first], hand[second], hand[third], hand[fourth], hand[fifth]];
                  const value = pokerHand(selection);
                  if (!best || compareVectors(value, best) < 0) {
                    best = value;
                    bestCards = selection;
                  }
                }
              }
            }
          }
        }
        const category = best[0];
        results.push({
          id: player.id,
          name: player.username ?? player.name,
          points: category,
          eventTiebreakScore: best,
          eventTiebreakLabels: ["Hand category", "Primary kicker", "Next kicker", "Next kicker", "Next kicker", "Final kicker"],
          eventTiebreakDisplay: [handNames[category], ...best.slice(1).map(String)],
          detail: `Table ${tableIndex + 1} · ${handNames[category]} · ${[...table.holes.get(player.id), ...table.board].map((card) => card.label).join(" ")} · best: ${bestCards.map((card) => card.label).join(" ")}`,
          hand: bestCards.map((card) => card.label),
          table: tableIndex + 1,
        });
      }
    }
    return results;
  }

  function sportPerformance(players, settings, randomOrder, format) {
    const sport = format?.sport;
    if (!sport) throw new Error("Sports event settings are missing their event definition.");
    const minimum = Number(settings.minimumPerformance ?? sport.minimum);
    const maximum = Number(settings.maximumPerformance ?? sport.maximum);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum <= minimum) {
      throw new Error("Performance range must have a non-negative minimum and a larger maximum.");
    }
    const metric = (player, phase, heat) => {
      const performance = minimum + Math.random() * (maximum - minimum);
      const rounded = Math.round(performance * 100) / 100;
      const metricScore = sport.direction === "higher" ? rounded : -rounded;
      return {
        id: player.id,
        name: player.username ?? player.name,
        performance: rounded,
        metricScore,
        phase,
        heat,
      };
    };
    const betterFirst = (left, right) => sport.direction === "higher"
      ? right.performance - left.performance
      : left.performance - right.performance;
    const label = `${settings.distance ?? sport.distance ?? ""}${sport.distance ? "m" : ""}`;
    const renderPerformance = (performance) => `${performance.toFixed(2)} ${sport.direction === "higher" ? "m" : "s"}${label ? ` · ${label}` : ""}`;
    const allScores = new Map();
    if (!settings.useHeats) {
      for (const player of players) allScores.set(player.id, metric(player, "Direct", null));
    } else {
      const heatSize = intSetting(settings, "heatSize", 8);
      const qualifiersPerHeat = intSetting(settings, "qualifiersPerHeat", 2);
      if (heatSize < 2 || heatSize > 48 || qualifiersPerHeat < 1 || qualifiersPerHeat > 48) {
        throw new Error("Heat size must be 2–48 and qualifiers per heat must be 1–48.");
      }
      const shuffled = randomOrder(players);
      const heats = [];
      for (let index = 0; index < shuffled.length; index += heatSize) {
        const heatNumber = heats.length + 1;
        const heatResults = shuffled.slice(index, index + heatSize)
          .map((player) => metric(player, "Heat", heatNumber))
          .sort(betterFirst);
        heats.push(heatResults);
      }
      const qualifiers = new Set();
      for (const heat of heats) heat.slice(0, qualifiersPerHeat).forEach((result) => qualifiers.add(result.id));
      const nonQualifiers = new Map(heats.flatMap((heat) => heat
        .filter((result) => !qualifiers.has(result.id))
        .map((result) => [result.id, result])));
      const finals = players.filter((player) => qualifiers.has(player.id))
        .map((player) => metric(player, "Final", null));
      for (const result of finals) {
        const heatResult = heats.flat().find((entry) => entry.id === result.id);
        result.heatPerformance = heatResult.performance;
        allScores.set(result.id, result);
      }
      for (const [id, result] of nonQualifiers) allScores.set(id, result);
    }
    const results = players.map((player) => {
      const score = allScores.get(player.id);
      const isFinalist = score.phase === "Final";
      const value = score.metricScore + (isFinalist ? 1_000_000 : 0);
      const performance = renderPerformance(score.performance);
      const detail = score.phase === "Direct"
        ? performance
        : isFinalist
          ? `Final · ${performance} (heat: ${renderPerformance(score.heatPerformance)})`
          : `Heat ${score.heat} · ${performance} · did not qualify`;
      return {
        id: player.id,
        name: player.username ?? player.name,
        points: value,
        performanceScore: value,
        eventTiebreakScore: [],
        eventTiebreakLabels: [],
        eventTiebreakDisplay: [],
        detail,
      };
    });
    let round = 0;
    let ties = tiedGroups(results);
    while (ties.length) {
      round += 1;
      if (round > 500) throw new Error(`${format.label} performance ties did not resolve after 500 extra draws.`);
      for (const group of ties) {
        for (const result of group) {
          const performance = Math.round((minimum + Math.random() * (maximum - minimum)) * 100) / 100;
          const score = sport.direction === "higher" ? performance : -performance;
          result.eventTiebreakScore.push(score);
          result.eventTiebreakLabels.push(`Tie-break performance ${round}`);
          result.eventTiebreakDisplay.push(renderPerformance(performance));
          result.detail += ` · tie-break ${renderPerformance(performance)}`;
        }
      }
      ties = tiedGroups(results);
    }
    return results;
  }

  async function scoreEvent(players, mechanic, settings, dependencies) {
    const { randomOrder } = dependencies;
    if (mechanic === "letter-values") return letterValues(players, settings, randomOrder);
    if (mechanic === "catching") return catching(players, settings, randomOrder);
    if (mechanic === "survival-arena") return survivalArena(players, settings, randomOrder);
    if (mechanic === "blackjack") return blackjack(players, randomOrder);
    if (mechanic === "texas-holdem") return texasHoldem(players, randomOrder);
    if (mechanic.startsWith("sport-")) return sportPerformance(players, settings, randomOrder, dependencies.format);
    throw new Error(`Unsupported additional event mechanic: ${mechanic}`);
  }

  window.RV_ADDITIONAL_EVENTS = { scoreEvent };
})();
