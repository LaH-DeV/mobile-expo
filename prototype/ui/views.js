"use strict";

window.SignalHuntViews = (() => {
  const game = window.SignalHuntGame;
  const hunts = window.SignalHuntHunts;
  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  const icon = (name) =>
    `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
  const button = (label, action, options = {}) =>
    `<button class="button ${options.secondary ? "secondary" : "primary"} ${options.full === false ? "" : "full"}" data-action="${action}" ${options.data ?? ""}>${options.icon ? icon(options.icon) : ""}${escapeHtml(label)}</button>`;
  const notice = (message, type = "") =>
    `<div class="notice ${type}" role="status">${icon("info")}<p>${escapeHtml(message)}</p></div>`;

  function render(screen, { state, conditions, locationError }) {
    const text = (key) => window.SignalHuntUI.copy[state.locale][key] ?? key;
    const currentRun = () =>
      state.runs.find((run) => run.id === state.activeRunId);
    const huntFor = (run) =>
      game.getHunt(run?.huntId ?? state.huntId) ?? hunts[0];
    const checkpointFor = game.getCheckpoint;
    const runStep = game.getStep;
    const questionResolved = game.isQuestionResolved;
    const stepResolved = game.isStepResolved;
    const isFinalCheckpoint = game.isFinalCheckpoint;
    const formatCoordinates = (position) =>
      position.map((coordinate) => coordinate.toFixed(4)).join(", ");

    function landmark() {
      return `<div class="landmark" role="img" aria-label="${state.locale === "pl" ? "Szkic fikcyjnego pawilonu z trzema kolumnami" : "Sketch of a fictional pavilion with three columns"}"><svg viewBox="0 0 260 120" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M24 104h212M57 96h146M64 87h132M69 45h122L130 14 69 45ZM72 50h116M79 53v29m11-29v29m35-29v29m11-29v29m35-29v29m11-29v29M76 83h17m29 0h17m29 0h17M56 104V96m148 8V96" stroke="currentColor" stroke-width="2"/><circle cx="130" cy="34" r="4" stroke="currentColor"/><path d="M34 99V70m-9 10 9-12 9 12m179 19V65m-10 11 10-14 10 14" stroke="currentColor" stroke-width="1.5"/></svg></div>`;
    }

    function meta(hunt) {
      return `<div class="meta">
    <span>${icon("route")}${hunt.estimatedDistanceKm} km</span>
    <span>${icon("clock")}${hunt.estimatedDurationMinutes} ${text("minutes")}</span>
    <span>${text(hunt.difficulty)}</span>
  </div>`;
    }

    function exploreScreen() {
      const active = currentRun();
      const mapView = state.discoveryView === "map";
      return `<p class="eyebrow">Signal Hunt / ${text("explore")}</p><h1>${text("nearby")}</h1><p class="muted">${text("exploreIntro")}</p>
    ${active?.status === "active" ? button(text("resume"), "go", { secondary: true, icon: "route", data: 'data-screen="checkpoint"' }) : ""}
    <label class="search-field">${icon("search")}<input id="hunt-search" type="search" placeholder="${text("search")}" aria-label="${text("search")}" value="${escapeHtml(state.discoverySearch)}"></label>
    <div class="discovery-toolbar"><span id="result-count" class="muted small" aria-live="polite">${hunts.length} / ${hunts.length}</span><div class="segmented view-control" role="group" aria-label="${text("discoveryView")}">${["map", "list"].map((view) => `<button data-action="discovery-view" data-view="${view}" aria-pressed="${state.discoveryView === view}">${icon(view)}${text(view)}</button>`).join("")}</div></div>
    ${mapView ? `<div id="trail-map" class="trail-map discovery-map" data-map="discovery"></div>${mapCaption()}` : `<div class="section-heading"><h2>${text("available")}</h2></div>`}
    <div id="hunt-results">${hunts.map((hunt, index) => huntRow(hunt, index, mapView)).join("")}</div>
    <p id="search-empty" class="muted" hidden>${text("emptySearch")}</p>`;
    }

    function huntRow(hunt, index, mapView) {
      const title = escapeHtml(hunt.title[state.locale]);
      const tag = `<span class="tag">${text(hunt.physical ? "qr" : "digital")}</span>`;
      const summary = `<h2>${title}</h2>${meta(hunt)}`;
      return `<button class="hunt-row ${mapView ? "map-result" : ""}"
    data-action="details" data-hunt="${hunt.id}"
    data-search="${escapeHtml(hunt.title[state.locale].toLocaleLowerCase(state.locale))}">
    ${
      mapView
        ? `
      <span class="trail-number">${String(index + 1).padStart(2, "0")}</span>
      <div class="trail-summary">${tag}${summary}</div>${icon("arrow-right")}
    `
        : `
      <div class="row-top">${tag}
        <span class="trail-art" aria-hidden="true">${hunt.physical ? huntIllustration(hunt) : icon("clock")}</span>
        ${icon("arrow-right")}
      </div>
      ${summary}<p>PL / EN · ${hunt.checkpoints.length} ${text("checkpoints")}</p>
    `
    }
  </button>`;
    }

    function huntIllustration(hunt) {
      return hunt.illustration === "pavilion" ? landmark() : icon("map-pin");
    }

    function mapCaption() {
      return `<div class="map-caption"><span>${icon("map-pin")}${text("demoArea")}</span><button class="icon-button" data-action="map-recenter" title="${text("recenter")}" aria-label="${text("recenter")}">${icon("navigation")}</button></div>`;
    }

    function detailsScreen() {
      const hunt = huntFor();
      return `<div id="trail-map" class="trail-map" data-map="start"></div>${mapCaption()}<p class="eyebrow">${text(hunt.physical ? "qr" : "digital")}</p><h1>${escapeHtml(hunt.title[state.locale])}</h1><p class="muted">${escapeHtml(hunt.story[state.locale])}</p>${meta(hunt)}
    <dl class="detail-list"><div><dt>${text("distance")}</dt><dd>${hunt.estimatedDistanceKm} km / ${hunt.estimatedDurationMinutes} ${text("minutes")}</dd></div><div><dt>${text("terrain")}</dt><dd>${escapeHtml(hunt.terrain[state.locale])}</dd></div></dl>
    <p class="muted small" style="margin-top:12px">${escapeHtml(hunt.startDescription[state.locale])}<br>${text("startCoordinates")}: ${formatCoordinates(hunt.checkpoints[0].position)}</p>${notice(text("needConnection"))}${hunt.physical ? `<p class="muted">${text("needCamera")}</p>` : ""}${button(text("start"), "start", { icon: "arrow-right" })}`;
    }

    function languageControl() {
      return `<div class="segmented" role="group" aria-label="${text("language")}"><button data-action="locale" data-locale="pl" aria-pressed="${state.locale === "pl"}">Polski</button><button data-action="locale" data-locale="en" aria-pressed="${state.locale === "en"}">English</button></div>`;
    }

    function stepTrack(run) {
      const checkpoints = huntFor(run).checkpoints;
      return `<div class="step-track" aria-label="${text("progress")}">${checkpoints.map((checkpoint, index) => `<span class="${index < run.checkpointIndex ? "done" : index === run.checkpointIndex ? "current" : ""}"></span>`).join("")}</div><p class="eyebrow">${text("checkpoint")} ${run.checkpointIndex + 1} ${text("of")} ${checkpoints.length}</p>`;
    }

    function checkpointScreen() {
      const run = currentRun();
      if (!run || run.status !== "active") return noRunScreen();
      const checkpoint = checkpointFor(run);
      const step = runStep(run);
      const error = locationError();
      const distance = conditions.location === "far" ? "280" : "18";
      return `${stepTrack(run)}<h1>${escapeHtml(checkpoint.title[state.locale])}</h1><p class="muted">${escapeHtml(huntFor(run).title[state.locale])}</p>
    <div id="trail-map" class="trail-map checkpoint-map" data-map="checkpoint"></div>${mapCaption()}
    <div class="distance-panel"><div><div class="distance">${conditions.location === "near" || conditions.location === "far" ? `${distance}<small>m</small>` : "--"}</div><p class="muted small" style="margin:9px 0 0">${text("straightLine")}</p></div><div class="bearing">${icon(conditions.location === "denied" ? "info" : "navigation")}<span>${conditions.location === "denied" ? "--" : "NE / 42°"}</span></div></div>
    <p class="muted small">${text("coordinates")}<br>${formatCoordinates(checkpoint.position)}</p>${button(text("navigate"), "navigate", { secondary: true, icon: "navigation" })}
    ${error ? notice(error, "warning") : notice(step.unlocked ? text("reached") : text("gpsReady"))}
    ${button(text(step.unlocked ? (isFinalCheckpoint(run) ? "overview" : "viewQuestions") : "unlock"), step.unlocked ? "open-questions" : "unlock", { icon: step.unlocked ? "arrow-right" : "map-pin" })}
    <button class="text-button" data-action="pause">${text("pause")}</button>`;
    }

    function questionsScreen() {
      const run = currentRun();
      if (!run || run.status !== "active" || !runStep(run).unlocked)
        return noRunScreen();
      const checkpoint = checkpointFor(run);
      state.questionIndex = Math.min(
        state.questionIndex,
        checkpoint.questions.length - 1,
      );
      const question = checkpoint.questions[state.questionIndex];
      const answerState = runStep(run).answers[state.questionIndex];
      const contentLocale = state.locale;
      const resolved = questionResolved(answerState);
      const allResolved = stepResolved(runStep(run));
      return `${stepTrack(run)}<p class="muted small">${text("question")} ${state.questionIndex + 1} ${text("of")} ${checkpoint.questions.length} / ${contentLocale.toUpperCase()}</p><h1>${escapeHtml(question.prompt[contentLocale])}</h1>
    <div class="question-progress">${runStep(run)
      .answers.map(
        (answer, index) =>
          `<span class="${questionResolved(answer) ? "resolved" : ""}">${index + 1} / ${text(questionResolved(answer) ? "resolved" : "pending")}</span>`,
      )
      .join("")}</div>
    ${resolved ? notice(text(answerState.resolution === "assisted" ? "assisted" : "correct")) : `<form id="answer-form"><label class="field-label" for="answer-value">${text("answer")}</label>${question.type === "choice" ? `<div class="choice-list">${question.options.map((option) => `<label class="choice"><input type="radio" name="answer" value="${option.id}" ${answerState.draft === option.id ? "checked" : ""}><span>${option[contentLocale]}</span></label>`).join("")}</div>` : `<input id="answer-value" class="answer-input" name="answer" autocomplete="off" inputmode="${question.type === "numeric" ? "decimal" : "text"}" value="${escapeHtml(answerState.draft)}">`}<button class="button primary full" type="submit">${icon("check")}${text("submit")}</button></form>`}
    ${answerState.resolution === "assisted" ? `<p class="muted">${escapeHtml(question.explanation[contentLocale])}</p>` : ""}
    ${
      answerState.hints
        ? `<div class="hint"><strong>${text("hintTitle")}</strong>${question.hints[
            contentLocale
          ]
            .slice(0, answerState.hints)
            .map((hint) => `<p>${escapeHtml(hint)}</p>`)
            .join("")}</div>`
        : ""
    }
    ${!resolved ? `<div class="app-section">${answerState.hints < question.hints[contentLocale].length ? button(text("hint"), "hint", { secondary: true, icon: "info" }) : `<p class="muted small">${text("noHints")}</p>`}<button class="text-button" data-action="reveal">${text("reveal")}</button></div>` : ""}
    ${allResolved ? button(text(isFinalCheckpoint(run) ? "overview" : "nextStop"), "continue", { icon: "arrow-right" }) : checkpoint.questions.length > 1 ? button(text("nextQuestion"), "next-question", { secondary: true, icon: "arrow-right" }) : ""}`;
    }

    function finaleScreen() {
      const run = currentRun();
      if (
        !run ||
        run.status !== "active" ||
        !isFinalCheckpoint(run) ||
        !runStep(run).unlocked
      )
        return noRunScreen();
      const questionsDone = stepResolved(runStep(run));
      return `${stepTrack(run)}<h1>${text("final")}</h1><p class="muted">${text("finalIntro")}</p>${huntIllustration(huntFor(run))}
    ${conditionRow(text("finalQuestions"), questionsDone ? text("resolved") : `${text("questionSet")}: ${checkpointFor(run).questions.length}`, questionsDone, "1")}
    ${huntFor(run).physical ? conditionRow(text("qrCondition"), text(run.qrVerified ? "qrDone" : "qrPending"), run.qrVerified, "2") : ""}
    <div class="app-section">${button(text("viewQuestions"), "questions", { secondary: questionsDone, icon: "eye" })}${huntFor(run).physical && !run.qrVerified ? button(text("scan"), "scanner", { secondary: !questionsDone, icon: "scan" }) : ""}</div>`;
    }

    function conditionRow(title, description, done, number) {
      return `<div class="condition"><span class="condition-dot ${done ? "complete" : ""}">${done ? icon("check") : number}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div></div>`;
    }

    function scannerScreen() {
      const run = currentRun();
      if (
        !run ||
        run.status !== "active" ||
        !huntFor(run).physical ||
        !isFinalCheckpoint(run) ||
        !runStep(run).unlocked
      )
        return noRunScreen();
      if (conditions.camera === "denied")
        return `<p class="eyebrow">${text("qrCondition")}</p><h1>${text("scanner")}</h1>${notice(text("cameraDenied"), "warning")}${button(text("openSettings"), "device-settings", { icon: "settings" })}${button(text("retry"), "refresh", { secondary: true, icon: "refresh" })}`;
      return `<p class="eyebrow">${text("qrCondition")}</p><h1>${text("scanner")}</h1><p class="muted">${text("scanIntro")}</p><div class="scanner" role="img" aria-label="Simulated camera frame"><div class="scan-outline">${icon("scan")}</div></div>${button(text("scanValid"), "scan-valid", { icon: "scan" })}${button(text("scanWrong"), "scan-wrong", { secondary: true })}<p class="muted small" style="margin-top:18px">${text("qrPending")}</p>`;
    }

    function completionScreen() {
      const run = currentRun();
      if (!run || run.status !== "completed") return noRunScreen();
      const answers = run.steps.flatMap((step) => step.answers);
      const hunt = huntFor(run);
      const summary = [
        [
          "checkpoints",
          `${hunt.checkpoints.length} / ${hunt.checkpoints.length}`,
        ],
        [
          "hintsUsed",
          answers.reduce((total, answer) => total + answer.hints, 0),
        ],
        [
          "assistedCount",
          answers.filter((answer) => answer.resolution === "assisted").length,
        ],
        ["scanStatus", text(hunt.physical ? "qrDone" : "notNeeded")],
      ];
      return `<div class="success-mark">${icon("check")}</div>
    <p class="eyebrow">${text("completed")}</p><h1>${text("complete")}</h1>
    <p class="muted">${text("completeIntro")}</p>
    <div class="app-section"><h2>${escapeHtml(hunt.title[state.locale])}</h2>
      <dl class="detail-list">${summary
        .map(
          ([label, value]) => `
        <div><dt>${text(label)}</dt><dd>${escapeHtml(value)}</dd></div>
      `,
        )
        .join("")}</dl>
    </div>
    ${button(text("runs"), "go", { icon: "route", data: 'data-screen="runs"' })}
    ${button(text("replay"), "replay", { secondary: true, icon: "refresh", data: `data-hunt="${run.huntId}"` })}`;
    }

    function runRow(run) {
      const hunt = huntFor(run);
      const terminal = ["completed", "abandoned"].includes(run.status);
      const completedDate = run.completedAt
        ? ` / ${new Intl.DateTimeFormat(state.locale).format(new Date(run.completedAt))}`
        : "";
      const primaryAction = button(
        text(terminal ? "replay" : "resume"),
        terminal ? "replay" : "resume",
        {
          secondary: true,
          full: false,
          data: terminal ? `data-hunt="${hunt.id}"` : `data-run="${run.id}"`,
        },
      );
      return `<div class="run-row">
    <span class="tag">${text(run.status)}</span><h2>${escapeHtml(hunt.title[state.locale])}</h2>
    <p class="muted small">${text("checkpoint")} ${run.checkpointIndex + 1} ${text("of")} ${hunt.checkpoints.length}${completedDate}</p>
    <div class="run-actions">${primaryAction}
      ${!terminal ? `<button class="text-button" data-action="abandon" data-run="${run.id}">${text("abandon")}</button>` : ""}
    </div>
  </div>`;
    }

    function runsScreen() {
      if (!state.runs.length) return noRunScreen();
      const unfinished = state.runs.filter((run) =>
        ["active", "suspended"].includes(run.status),
      );
      const history = state.runs.filter((run) =>
        ["completed", "abandoned"].includes(run.status),
      );
      return `<p class="eyebrow">Signal Hunt / ${text("runs")}</p><h1>${text("runs")}</h1>${unfinished.length ? `<div class="app-section"><div class="section-heading"><h2>${text("inProgress")}</h2><span>${unfinished.length}</span></div>${unfinished.map(runRow).join("")}</div>` : ""}${history.length ? `<div class="app-section"><div class="section-heading"><h2>${text("history")}</h2><span>${history.length}</span></div>${history.map(runRow).join("")}</div>` : ""}`;
    }

    function noRunScreen() {
      return `<div class="empty-state">${icon("route")}<h1>${text("noRuns")}</h1><p class="muted">${text("noRunsIntro")}</p>${button(text("findHunt"), "go", { icon: "arrow-right", data: 'data-screen="explore"' })}</div>`;
    }

    function settingsScreen() {
      return `<p class="eyebrow">Signal Hunt / ${text("settings")}</p><h1>${text("settings")}</h1><div class="app-section"><h2>${text("appearance")}</h2><div class="segmented appearance-control" role="group" aria-label="${text("appearance")}">${["light", "dark", "system"].map((mode) => `<button data-action="appearance" data-mode="${mode}" aria-pressed="${state.appearance === mode}">${text(mode)}</button>`).join("")}</div></div><div class="app-section"><h2>${text("language")}</h2>${languageControl()}</div><div class="app-section"><h2>${text("privacy")}</h2><p class="muted">${text("privacyBody")}</p><button class="button danger full" data-action="delete">${text("reset")}</button></div>`;
    }

    const screens = {
      explore: exploreScreen,
      details: detailsScreen,
      checkpoint: checkpointScreen,
      questions: questionsScreen,
      finale: finaleScreen,
      scanner: scannerScreen,
      completion: completionScreen,
      runs: runsScreen,
      settings: settingsScreen,
    };
    return (screens[screen] ?? screens.explore)();
  }

  return { render, escapeHtml, icon, notice };
})();
