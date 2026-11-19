(function () {
  const eurovisionPoints = [12, 10, 8, 7, 6, 5, 4, 3, 2, 1];
  const periodicElements = [
    ["Hydrogen", "H"], ["Helium", "He"], ["Lithium", "Li"], ["Beryllium", "Be"], ["Boron", "B"], ["Carbon", "C"], ["Nitrogen", "N"], ["Oxygen", "O"], ["Fluorine", "F"], ["Neon", "Ne"],
    ["Sodium", "Na"], ["Magnesium", "Mg"], ["Aluminum", "Al"], ["Silicon", "Si"], ["Phosphorus", "P"], ["Sulfur", "S"], ["Chlorine", "Cl"], ["Argon", "Ar"], ["Potassium", "K"], ["Calcium", "Ca"],
    ["Scandium", "Sc"], ["Titanium", "Ti"], ["Vanadium", "V"], ["Chromium", "Cr"], ["Manganese", "Mn"], ["Iron", "Fe"], ["Cobalt", "Co"], ["Nickel", "Ni"], ["Copper", "Cu"], ["Zinc", "Zn"],
    ["Gallium", "Ga"], ["Germanium", "Ge"], ["Arsenic", "As"], ["Selenium", "Se"], ["Bromine", "Br"], ["Krypton", "Kr"], ["Rubidium", "Rb"], ["Strontium", "Sr"], ["Yttrium", "Y"], ["Zirconium", "Zr"],
    ["Niobium", "Nb"], ["Molybdenum", "Mo"], ["Technetium", "Tc"], ["Ruthenium", "Ru"], ["Rhodium", "Rh"], ["Palladium", "Pd"], ["Silver", "Ag"], ["Cadmium", "Cd"], ["Indium", "In"], ["Tin", "Sn"],
    ["Antimony", "Sb"], ["Tellurium", "Te"], ["Iodine", "I"], ["Xenon", "Xe"], ["Cesium", "Cs"], ["Barium", "Ba"], ["Lanthanum", "La"], ["Cerium", "Ce"], ["Praseodymium", "Pr"], ["Neodymium", "Nd"],
    ["Promethium", "Pm"], ["Samarium", "Sm"], ["Europium", "Eu"], ["Gadolinium", "Gd"], ["Terbium", "Tb"], ["Dysprosium", "Dy"], ["Holmium", "Ho"], ["Erbium", "Er"], ["Thulium", "Tm"], ["Ytterbium", "Yb"],
    ["Lutetium", "Lu"], ["Hafnium", "Hf"], ["Tantalum", "Ta"], ["Tungsten", "W"], ["Rhenium", "Re"], ["Osmium", "Os"], ["Iridium", "Ir"], ["Platinum", "Pt"], ["Gold", "Au"], ["Mercury", "Hg"],
    ["Thallium", "Tl"], ["Lead", "Pb"], ["Bismuth", "Bi"], ["Polonium", "Po"], ["Astatine", "At"], ["Radon", "Rn"], ["Francium", "Fr"], ["Radium", "Ra"], ["Actinium", "Ac"], ["Thorium", "Th"],
    ["Protactinium", "Pa"], ["Uranium", "U"], ["Neptunium", "Np"], ["Plutonium", "Pu"], ["Americium", "Am"], ["Curium", "Cm"], ["Berkelium", "Bk"], ["Californium", "Cf"], ["Einsteinium", "Es"], ["Fermium", "Fm"],
    ["Mendelevium", "Md"], ["Nobelium", "No"], ["Lawrencium", "Lr"], ["Rutherfordium", "Rf"], ["Dubnium", "Db"], ["Seaborgium", "Sg"], ["Bohrium", "Bh"], ["Hassium", "Hs"], ["Meitnerium", "Mt"], ["Darmstadtium", "Ds"],
    ["Roentgenium", "Rg"], ["Copernicium", "Cn"], ["Nihonium", "Nh"], ["Flerovium", "Fl"], ["Moscovium", "Mc"], ["Livermorium", "Lv"], ["Tennessine", "Ts"], ["Oganesson", "Og"],
  ].map(([name, symbol], index) => ({ name, symbol, atomicNumber: index + 1 }));

  function randomOrder(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function rankResults(results) {
    if (results.length && results.every((result) => Number.isInteger(result.rank))) {
      return [...results].sort((a, b) => a.rank - b.rank).map((result) => ({ ...result, medal: result.medal ?? null }));
    }
    const compareEventResult = (left, right) => {
      const leftScore = left.eventTiebreakScore;
      const rightScore = right.eventTiebreakScore;
      if (Array.isArray(leftScore) && Array.isArray(rightScore)) {
        for (let index = 0; index < Math.max(leftScore.length, rightScore.length); index += 1) {
          const difference = (rightScore[index] ?? 0) - (leftScore[index] ?? 0);
          if (difference) return difference;
        }
        return 0;
      }
      return (rightScore ?? 0) - (leftScore ?? 0);
    };
    const ranked = [...results].map((result) => ({ ...result, tieBreak: result.tieBreak ?? "—" }));
    const byPoints = new Map();
    for (const result of ranked) {
      if (!byPoints.has(result.points)) byPoints.set(result.points, []);
      byPoints.get(result.points).push(result);
    }
    for (const tiedResults of byPoints.values()) {
      if (tiedResults.length < 2) continue;
      const eventOrder = [...tiedResults].sort(compareEventResult);
      const remainingTies = new Map();
      for (const result of eventOrder) {
        const key = Array.isArray(result.eventTiebreakScore)
          ? JSON.stringify(result.eventTiebreakScore)
          : result.eventTiebreakScore ?? 0;
        if (!remainingTies.has(key)) remainingTies.set(key, []);
        remainingTies.get(key).push(result);
      }
      for (const sameEventResult of remainingTies.values()) {
        if (sameEventResult.length < 2) continue;
        randomOrder(sameEventResult).forEach((result, index) => {
          result.roundTiebreakScore = sameEventResult.length - index;
          result.tieBreak = "Random extra round";
        });
      }
      for (const result of tiedResults) {
        if (result.tieBreak === "Random extra round") continue;
        const resultIndex = eventOrder.indexOf(result);
        const neighbor = eventOrder[resultIndex - 1] ?? eventOrder[resultIndex + 1];
        if (!neighbor) continue;
        const score = result.eventTiebreakScore;
        const otherScore = neighbor.eventTiebreakScore;
        const labels = result.eventTiebreakLabels ?? [];
        if (Array.isArray(score) && Array.isArray(otherScore)) {
          const differingIndex = score.findIndex((value, index) => value !== otherScore[index]);
          if (differingIndex >= 0) {
            const label = labels[differingIndex] ?? "Event result";
            const display = result.eventTiebreakDisplay?.[differingIndex];
            result.tieBreak = display ? `${label}: ${display}` : label;
          }
        } else {
          result.tieBreak = result.tieBreakLabel ?? "Event result";
        }
      }
    }
    ranked.sort((a, b) => b.points - a.points
      || compareEventResult(a, b)
      || (b.roundTiebreakScore ?? 0) - (a.roundTiebreakScore ?? 0));
    return ranked.map((result, index) => ({
      ...result,
      rank: index + 1,
      medal: result.medal ?? null,
    }));
  }

  function randomRanking(players) {
    return randomOrder(players).map((player, index) => ({
      id: player.id,
      name: player.username ?? player.name,
      points: players.length - index,
      detail: `Turn ${index + 1}`,
    }));
  }

  function atomicFusion(players, settings, scoreboardOrder) {
    const rollCount = Number(settings.elementRolls ?? 5);
    return scoreboardOrder(players).map((player, turnIndex) => {
      const elements = Array.from({ length: rollCount }, () => periodicElements[Math.floor(Math.random() * periodicElements.length)]);
      const total = elements.reduce((sum, element) => sum + element.atomicNumber, 0);
      const highestFirst = [...elements].sort((left, right) => right.atomicNumber - left.atomicNumber);
      return {
        id: player.id,
        name: player.username ?? player.name,
        points: total,
        eventTiebreakScore: highestFirst.map((element) => element.atomicNumber),
        eventTiebreakLabels: highestFirst.map((_, index) => ["Highest element", "2nd-highest element", "3rd-highest element", "4th-highest element", "5th-highest element"][index] ?? `${index + 1}th-highest element`),
        eventTiebreakDisplay: highestFirst.map((element) => `${element.symbol} (${element.atomicNumber})`),
        detail: `${elements.map((element) => `${element.symbol} ${element.atomicNumber}`).join(" + ")} = ${total}`,
        turn: turnIndex + 1,
      };
    });
  }

  async function countryChoosing(players, settings, loadCountryData, scoreboardOrder) {
    const statistic = settings.countryStatistic ?? "population";
    const countries = randomOrder(await loadCountryData(statistic)).slice(0, players.length);
    if (countries.length < players.length) throw new Error(`There are only ${countries.length} recognized countries available for ${players.length} participants.`);
    return scoreboardOrder(players).map((player, turnIndex) => {
      const country = countries[turnIndex];
      return {
        id: player.id,
        name: player.username ?? player.name,
        points: country.statistic,
        detail: `${country.name} · ${country.statistic.toLocaleString()} ${statistic === "gdp" ? "US$ GDP" : "people"} · ${country.year} · ${country.source}`,
        turn: turnIndex + 1,
      };
    });
  }

  function droppedIdsForRound(round) {
    return new Set(round.dropped.map((player) => player.id));
  }

  function bottomDrop(players, settings) {
    let remaining = [...players];
    let round = 0;
    const eliminatedRounds = [];
    while (remaining.length > 1) {
      round += 1;
      const roundOrder = randomOrder(remaining);
      const minimumDrop = Math.max(1, Number(settings.minimumDrop ?? 1));
      const maximumDrop = Math.max(minimumDrop, Number(settings.maximumDrop ?? 5));
      const dropCount = Math.min(remaining.length - 1, minimumDrop + Math.floor(Math.random() * (maximumDrop - minimumDrop + 1)));
      const dropped = roundOrder.slice(-dropCount);
      const droppedIds = new Set(dropped.map((player) => player.id));
      eliminatedRounds.push({ round, dropped, roundOrder });
      remaining = roundOrder.filter((player) => !droppedIds.has(player.id));
    }
    const finalOrder = [
      ...remaining,
      ...[...eliminatedRounds].reverse().flatMap((entry) => entry.dropped),
    ];
    const roundById = new Map();
    for (const entry of eliminatedRounds) {
      for (const player of entry.dropped) roundById.set(player.id, entry.round);
    }
    return finalOrder.map((player, index) => ({
      id: player.id,
      name: player.username ?? player.name,
      points: finalOrder.length - index,
      detail: index === 0 ? `Survived ${eliminatedRounds.length} round${eliminatedRounds.length === 1 ? "" : "s"}` : `Dropped in round ${roundById.get(player.id)}`,
      bottomDropRounds: index === 0 ? eliminatedRounds.map((entry) => ({
        round: entry.round,
        order: entry.roundOrder.map((entrant) => ({
          id: entrant.id,
          name: entrant.username ?? entrant.name,
          dropped: droppedIdsForRound(entry).has(entrant.id),
        })),
        dropped: entry.dropped.map((entrant) => entrant.username ?? entrant.name),
      })) : undefined,
    }));
  }

  function bingoBoard() {
    const columns = [
      [1, 15], [16, 30], [31, 45], [46, 60], [61, 75],
    ].map(([first, last]) => randomOrder(Array.from({ length: last - first + 1 }, (_, index) => first + index)).slice(0, 5));
    return Array.from({ length: 5 }, (_, row) => columns.map((column, col) => {
      if (row === 2 && col === 2) return "FREE";
      return `${["B", "I", "N", "G", "O"][col]}${column[row]}`;
    }));
  }

  function bingoLines() {
    const lines = [];
    for (let row = 0; row < 5; row += 1) lines.push(Array.from({ length: 5 }, (_, col) => [row, col]));
    for (let col = 0; col < 5; col += 1) lines.push(Array.from({ length: 5 }, (_, row) => [row, col]));
    lines.push(Array.from({ length: 5 }, (_, index) => [index, index]));
    lines.push(Array.from({ length: 5 }, (_, index) => [index, 4 - index]));
    return lines;
  }

  function bingo(players, settings) {
    const callOrder = randomOrder(Array.from({ length: 75 }, (_, index) => index + 1));
    const callNumber = new Map(callOrder.map((value, index) => [value, index + 1]));
    const lines = bingoLines();
    return players.map((player) => {
      const board = bingoBoard();
      const lineCallNumbers = lines.map((line) => Math.max(...line.map(([row, col]) => {
        const cell = board[row][col];
        if (cell === "FREE") return 0;
        return callNumber.get(Number(cell.slice(1)));
      }))).sort((left, right) => left - right);
      const linesToWin = Number(settings.linesToWin ?? 3);
      const finishCall = lineCallNumbers[linesToWin - 1];
      const [first, second, , fourth] = lineCallNumbers;
      const tieBreakCalls = [second, first, fourth];
      return {
        id: player.id,
        name: player.username ?? player.name,
        points: -finishCall,
        eventTiebreakScore: tieBreakCalls.map((call) => -call),
        eventTiebreakLabels: ["2nd line", "1st line", "4th line"],
        eventTiebreakDisplay: tieBreakCalls.map((call) => `call ${call}`),
        eventTiebreakCalls: tieBreakCalls,
        board,
        callOrder,
        lineCallNumbers,
        finishCallNumber: finishCall,
        detail: `${linesToWin} lines at call ${finishCall}; line calls ${lineCallNumbers.slice(0, Math.max(linesToWin, 4)).join(", ")}`,
      };
    });
  }

  function setBingoEndCall(results) {
    let endCallIndex = -results[0].points;
    const tiedScores = new Map();
    for (const result of results) {
      if (!tiedScores.has(result.points)) tiedScores.set(result.points, []);
      tiedScores.get(result.points).push(result);
    }
    for (const tiedResults of tiedScores.values()) {
      if (tiedResults.length < 2) continue;
      const decidingLines = new Set(tiedResults.map((result) => {
        if (result.tieBreak?.startsWith("2nd line")) return 1;
        if (result.tieBreak?.startsWith("1st line")) return 0;
        if (result.tieBreak?.startsWith("4th line") || result.tieBreak === "Random extra round") return 3;
        return -1;
      }).filter((index) => index >= 0));
      for (const lineIndex of decidingLines) {
        endCallIndex = Math.max(endCallIndex, ...tiedResults.map((result) => result.lineCallNumbers[lineIndex] ?? 0));
      }
    }
    for (const result of results) result.eventEndCallIndex = endCallIndex;
    return endCallIndex;
  }

  function eurovisionVector(pointCounts, ballotPoints = eurovisionPoints) {
    return ballotPoints.map((point) => pointCounts.get(point) ?? 0);
  }

  function eurovisionBallot(voters, ballotPoints = eurovisionPoints, contestants = voters) {
    const received = new Map(contestants.map((player) => [player.id, new Map(ballotPoints.map((point) => [point, 0]))]));
    const ballots = [];
    for (const voter of voters) {
      const recipients = randomOrder(contestants.filter((player) => player.id !== voter.id)).slice(0, ballotPoints.length);
      const votes = recipients.map((recipient, index) => ({ id: recipient.id, name: recipient.username ?? recipient.name, points: ballotPoints[index] }));
      ballots.push({ voterId: voter.id, voterName: voter.username ?? voter.name, votes });
      votes.forEach((vote) => {
        received.get(vote.id).set(vote.points, received.get(vote.id).get(vote.points) + 1);
      });
    }
    const results = contestants.map((player) => {
      const pointCounts = received.get(player.id);
      const total = [...pointCounts.entries()].reduce((sum, [point, count]) => sum + point * count, 0);
      return {
        id: player.id,
        name: player.username ?? player.name,
        points: total,
        eventTiebreakScore: eurovisionVector(pointCounts, ballotPoints),
        eventTiebreakLabels: ballotPoints.map((point) => `${point}-point votes`),
        eventTiebreakDisplay: ballotPoints.map((point) => `${point} points × ${pointCounts.get(point)} vote${pointCounts.get(point) === 1 ? "" : "s"}`),
        pointCounts,
      };
    });
    results.ballots = ballots;
    return results;
  }

  function eurovision(players, settings = {}) {
    const ballotPoints = settings.ballotPoints ?? eurovisionPoints;
    const finalCutoff = Number(settings.finalCutoff ?? 30);
    const qualifiersPerSemi = Number(settings.qualifiersPerSemi ?? 13);
    if (players.length <= finalCutoff) {
      return eurovisionBallot(players, ballotPoints, players).map((result) => ({
        ...result,
        detail: `Final · ${result.points} points`,
      }));
    }
    const shuffled = randomOrder(players);
    const splitIndex = Math.ceil(shuffled.length / 2);
    const semis = [shuffled.slice(0, splitIndex), shuffled.slice(splitIndex)];
    const semiResults = semis.map((contestants, index) => rankResults(eurovisionBallot(contestants, ballotPoints))
      .map((result) => ({ ...result, semi: index + 1 })));
    const qualifiers = semiResults.flatMap((results) => results.slice(0, qualifiersPerSemi));
    const finalResults = eurovisionBallot(players, ballotPoints, qualifiers);
    const finalById = new Map(finalResults.map((result) => [result.id, result]));
    const semiById = new Map(semiResults.flat().map((result) => [result.id, result]));
    return players.map((player) => {
      const finalResult = finalById.get(player.id);
      if (finalResult) {
        return { ...finalResult, points: 1_000_000 + finalResult.points, detail: `Final · ${finalResult.points} points` };
      }
      const semiResult = semiById.get(player.id);
      return { ...semiResult, detail: `Semi ${semiResult.semi} · ${semiResult.points} points` };
    });
  }

  function parkourRush(players, settings) {
    const timeLimitMinutes = Number(settings.timeLimitMinutes ?? 10);
    const bonusEntryChance = Number(settings.bonusEntryChance ?? 85);
    if (!Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1 || timeLimitMinutes > 30) {
      throw new Error("Parkour Warrior's time limit must be between 1 and 30 minutes.");
    }
    if (!Number.isInteger(bonusEntryChance) || bonusEntryChance < 0 || bonusEntryChance > 100) {
      throw new Error("Bonus path entry chance must be between 0% and 100%.");
    }

    const timeLimit = timeLimitMinutes * 60_000;
    const finaleOvertimeLimit = timeLimit + 60_000;
    const bonusPaths = [
      { difficulty: "Very Easy", successPercent: 98 },
      { difficulty: "Easy", successPercent: 92 },
      { difficulty: "Medium", successPercent: 82 },
      { difficulty: "Medium", successPercent: 82 },
      { difficulty: "Hard", successPercent: 65 },
    ];
    const mainZoneSuccess = [96, 93, 90, 87, 84];
    const finalePaths = [
      { name: "Easy", parts: 3, successPercent: 97, multiplier: 0.15 },
      { name: "Medium", parts: 2, successPercent: 87, multiplier: 0.35 },
      { name: "Hard", parts: 2, successPercent: 70, multiplier: 0.8 },
    ];
    const bonusCoinSchedule = {
      bronze: [0, 5, 15, 25, 40, 60],
      silver: [0, 10, 25, 45, 70, 100],
      gold: [0, 15, 30, 55, 90, 140],
    };
    const runs = new Map(players.map((player) => [player.id, {
      elapsed: 0,
      coins: 0,
      medals: { bronze: 0, silver: 0, gold: 0 },
      mainParts: 0,
      totalFailures: 0,
      timedOut: false,
      finalPath: null,
      finalParts: 0,
      finalFailed: false,
      overtimeUsed: false,
    }]));
    const eventRounds = [];

    function attemptObstacle(run, successPercent, maximumFailures = Infinity, awardCoins = true, attemptTimeLimit = timeLimit) {
      let failures = 0;
      const attempts = [];
      while (!run.timedOut && failures <= maximumFailures) {
        const duration = 8_000 + Math.floor(Math.random() * 10_001);
        if (run.elapsed + duration > attemptTimeLimit) {
          const remaining = attemptTimeLimit - run.elapsed;
          run.elapsed = attemptTimeLimit;
          run.timedOut = true;
          attempts.push({ outcome: "time", duration: remaining });
          break;
        }
        run.elapsed += duration;
        const cleared = Math.random() * 100 < successPercent;
        attempts.push({ outcome: cleared ? "cleared" : "failed", duration });
        if (cleared) {
          if (awardCoins) run.coins += 2;
          return { cleared: true, attempts, failures };
        }
        failures += 1;
        run.totalFailures += 1;
      }
      return { cleared: false, attempts, failures };
    }

    function pushStage(stage, number, label, participants, extra = {}) {
      eventRounds.push({ stage, number, label, participants, ...extra });
    }

    function runMainZone(zone) {
      const participants = players.map((player) => {
        const run = runs.get(player.id);
        const record = {
          id: player.id,
          name: player.username ?? player.name,
          completedParts: 0,
          obstacles: [],
          elapsed: run.elapsed,
          coins: run.coins,
          timedOut: run.timedOut,
        };
        if (run.timedOut) {
          record.status = "Time expired";
          return record;
        }
        record.status = "Zone cleared";
        for (let obstacle = 1; obstacle <= 3; obstacle += 1) {
          const outcome = attemptObstacle(run, mainZoneSuccess[zone - 1]);
          record.obstacles.push({ obstacle, ...outcome });
          if (!outcome.cleared) {
            record.status = "Time expired";
            break;
          }
          record.completedParts += 1;
          run.mainParts += 1;
        }
        record.elapsed = run.elapsed;
        record.coins = run.coins;
        record.timedOut = run.timedOut;
        record.coinsEarned = record.completedParts * 2;
        return record;
      });
      pushStage("main", zone, `Main Zone ${zone}`, participants, {
        successPercent: mainZoneSuccess[zone - 1],
      });
    }

    for (let index = 0; index < bonusPaths.length; index += 1) {
      const path = bonusPaths[index];
      const participants = players.map((player) => {
        const run = runs.get(player.id);
        const record = {
          id: player.id,
          name: player.username ?? player.name,
          difficulty: path.difficulty,
          entered: false,
          completedParts: 0,
          medalsAwarded: [],
          obstacles: [],
          elapsed: run.elapsed,
          coins: run.coins,
          timedOut: run.timedOut,
        };
        if (run.timedOut) return record;
        if (Math.random() * 100 >= bonusEntryChance) {
          record.status = "Skipped bonus path";
          return record;
        }
        record.entered = true;
        record.status = "Completed bonus path";
        const medalForPart = ["bronze", "silver", "gold"];
        for (let obstacle = 1; obstacle <= 3; obstacle += 1) {
          const outcome = attemptObstacle(run, path.successPercent, 2, false);
          record.obstacles.push({ obstacle, ...outcome });
          if (outcome.cleared) {
            record.completedParts += 1;
            const medal = medalForPart[obstacle - 1];
            run.medals[medal] += 1;
            record.medalsAwarded.push(medal);
            continue;
          }
          if (run.timedOut) {
            record.status = "Time expired on bonus path";
          } else {
            record.status = "Teleported back after three failed attempts";
            record.teleported = true;
          }
          break;
        }
        record.elapsed = run.elapsed;
        record.coins = run.coins;
        record.timedOut = run.timedOut;
        return record;
      });
      pushStage("bonus", index + 1, `Bonus Path ${index + 1} · ${path.difficulty}`, participants, {
        difficulty: path.difficulty,
      });
      runMainZone(index + 1);
    }

    const finalRecordsById = new Map(players.map((player) => [player.id, []]));
    for (const player of players) {
      const run = runs.get(player.id);
      const finalRecords = finalRecordsById.get(player.id);
      if (run.timedOut || run.mainParts !== 15) {
        finalRecords.push({
          id: player.id,
          name: player.username ?? player.name,
          path: null,
          part: null,
          completedParts: 0,
          elapsed: run.elapsed,
          coins: run.coins,
          timedOut: run.timedOut,
          status: "Did not reach finale",
        });
        continue;
      }

      let path = randomOrder(finalePaths)[0];
      run.finalPath = path;
      while (!run.timedOut && !run.finalFailed && path) {
        let restartOnEasierPath = false;
        for (let part = 1; part <= path.parts; part += 1) {
          const outcome = attemptObstacle(run, path.successPercent, 0, false, finaleOvertimeLimit);
          run.overtimeUsed = run.elapsed > timeLimit;
          const record = {
            id: player.id,
            name: player.username ?? player.name,
            path: path.name,
            part,
            attempt: finalRecords.length + 1,
            completedParts: run.finalParts,
            obstacle: { obstacle: part, ...outcome },
            elapsed: run.elapsed,
            coins: run.coins,
            timedOut: run.timedOut,
            overtime: run.elapsed > timeLimit,
          };
          if (outcome.cleared) {
            run.finalParts += 1;
            record.completedParts = run.finalParts;
            record.pathComplete = run.finalParts === path.parts;
            record.status = record.pathComplete ? "Finale complete · multiplier qualified" : "Part cleared · no coins";
            finalRecords.push(record);
            if (record.pathComplete) break;
            continue;
          }

          const easierPaths = finalePaths.slice(0, finalePaths.indexOf(path));
          const downgradeAllowed = !run.timedOut && run.elapsed < timeLimit - 30_000;
          if (downgradeAllowed && easierPaths.length) {
            const easierPath = randomOrder(easierPaths)[0];
            record.downgradedTo = easierPath.name;
            record.status = `Failed · teleported to ${easierPath.name} and restarted`;
            run.finalPath = easierPath;
            run.finalParts = 0;
            path = easierPath;
            restartOnEasierPath = true;
          } else {
            run.finalFailed = true;
            record.status = run.timedOut
              ? "Overtime limit reached · incomplete"
              : run.elapsed > timeLimit
                ? "Overtime failure · incomplete"
                : run.elapsed >= timeLimit - 30_000
                  ? "Failed in final 30 seconds · incomplete"
                  : "Easiest finale path failed · incomplete";
          }
          finalRecords.push(record);
          break;
        }
        if (!restartOnEasierPath) break;
      }
    }

    const finalAttemptCount = Math.max(0, ...[...finalRecordsById.values()].map((records) => records.length));
    for (let attempt = 0; attempt < finalAttemptCount; attempt += 1) {
      const participants = players.flatMap((player) => {
        const record = finalRecordsById.get(player.id)[attempt];
        return record ? [record] : [];
      });
      pushStage("final", attempt + 1, `Finale · Attempt ${attempt + 1}`, participants);
    }

    const formatTime = (milliseconds) => `${(milliseconds / 1000).toFixed(2)}s`;
    const results = players.map((player) => {
      const run = runs.get(player.id);
      const medalBonus = Object.entries(bonusCoinSchedule)
        .reduce((sum, [medal, schedule]) => sum + schedule[run.medals[medal]], 0);
      const multiplierQualified = Boolean(run.finalPath && run.finalParts === run.finalPath.parts);
      const multiplier = multiplierQualified ? 1 + run.finalPath.multiplier : 1;
      const coins = Math.round((run.coins + medalBonus) * multiplier);
      const finaleStatus = run.finalPath
        ? multiplierQualified ? `${run.finalPath.name} finale complete` : `${run.finalPath.name} finale incomplete · no multiplier`
        : "No finale multiplier";
      return {
        id: player.id,
        name: player.username ?? player.name,
        points: coins,
        detail: `${coins} coins · ${run.coins} main-course coins + ${medalBonus} medal-conversion coins · ${multiplier.toFixed(2)}× · ${finaleStatus}${run.overtimeUsed ? " · overtime used" : run.timedOut ? " · time expired" : ` · ${formatTime(run.elapsed)}`}`,
        eventTiebreakScore: [-run.elapsed],
        eventTiebreakLabels: ["Faster course time"],
        eventTiebreakDisplay: [formatTime(run.elapsed)],
        parkour: {
          elapsed: run.elapsed,
          timedOut: run.timedOut,
          coins: run.coins,
          medalBonus,
          medals: run.medals,
          multiplier,
          multiplierQualified,
          finalPath: run.finalPath?.name ?? null,
          finalParts: run.finalParts,
          finalFailed: run.finalFailed,
          overtimeUsed: run.overtimeUsed,
          mainParts: run.mainParts,
          totalFailures: run.totalFailures,
        },
      };
    });
    results.eventRounds = eventRounds;
    return results;
  }

  async function scoreEvent(players, mechanic, settings, dependencies) {
    if (mechanic === "random-ranking") return randomRanking(players);
    if (mechanic === "atomic-fusion") return atomicFusion(players, settings, dependencies.scoreboardOrder);
    if (mechanic === "country-choosing") {
      return countryChoosing(players, settings, dependencies.loadCountryData, dependencies.scoreboardOrder);
    }
    if (mechanic === "bottom-drop") return bottomDrop(players, settings);
    if (mechanic === "bingo") return bingo(players, settings);
    if (mechanic === "eurovision") return eurovision(players, settings);
    if (mechanic === "parkour-rush") return parkourRush(players, settings);
    return window.RV_ADDITIONAL_EVENTS.scoreEvent(players, mechanic, settings, {
      ...dependencies,
      randomOrder,
    });
  }

  window.RV_EVENT_ENGINE = {
    eurovisionBallot,
    eurovisionPoints,
    eurovisionVector,
    randomOrder,
    rankResults,
    scoreEvent,
    setBingoEndCall,
  };
})();
