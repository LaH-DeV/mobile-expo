"use strict";

(() => {
  const storageKey = "signal-hunt-local-sketch-v1";
  const app = document.querySelector("#app");
  const dialog = document.querySelector("#confirmation-dialog");
  const conditions = {
    connection: "online",
    location: "near",
    camera: "allowed",
  };
  let pendingConfirmation = null;
  let toastTimer;
  let visibleMap = null;

  const { copy, screenNotes } = window.SignalHuntUI;
  const hunts = window.SignalHuntHunts;
  const game = window.SignalHuntGame;
  const views = window.SignalHuntViews;
  const { escapeHtml, icon, notice } = views;
  const freshState = game.createState;

  function loadState() {
    try {
      return game.loadState(localStorage.getItem(storageKey));
    } catch {}
    return freshState();
  }

  let state = loadState();
  const systemAppearance = window.matchMedia("(prefers-color-scheme: dark)");

  function applyAppearance() {
    document.documentElement.dataset.theme =
      state.appearance === "system"
        ? systemAppearance.matches
          ? "dark"
          : "light"
        : state.appearance;
    visibleMap?.setTheme(document.documentElement.dataset.theme);
  }

  systemAppearance.addEventListener("change", applyAppearance);

  const text = (key) => copy[state.locale][key] ?? key;
  const currentRun = () =>
    state.runs.find((run) => run.id === state.activeRunId);
  const huntFor = (run) =>
    game.getHunt(run?.huntId ?? state.huntId) ?? hunts[0];
  const checkpointFor = game.getCheckpoint;
  const runStep = game.getStep;
  const questionResolved = game.isQuestionResolved;
  const stepResolved = game.isStepResolved;
  const isFinalCheckpoint = game.isFinalCheckpoint;
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {}
  }

  function toast(message) {
    clearTimeout(toastTimer);
    const element = document.querySelector("#toast");
    element.textContent = message;
    element.classList.add("visible");
    toastTimer = setTimeout(() => element.classList.remove("visible"), 4500);
  }

  function confirmAction(title, description, label, callback) {
    document.querySelector("#dialog-title").textContent = title;
    document.querySelector("#dialog-description").textContent = description;
    document.querySelector("#dialog-cancel").textContent = text("cancel");
    document.querySelector("#dialog-confirm").textContent = label;
    pendingConfirmation = callback;
    dialog.showModal();
  }

  function requireConnection() {
    if (conditions.connection === "online") return true;
    state.feedback = text("offlineAction");
    render();
    return false;
  }

  function locationError() {
    return {
      far: text("gpsFar"),
      inaccurate: text("gpsInaccurate"),
      denied: text("gpsDenied"),
    }[conditions.location];
  }

  function createRun(huntId, finalePreview = false) {
    return game.startRun(state, huntId, finalePreview);
  }

  function completeIfReady(run) {
    return game.completeIfReady(state, run);
  }

  function render() {
    visibleMap?.remove();
    visibleMap = null;
    applyAppearance();
    if (!screenNotes[state.screen]) state.screen = "explore";
    const root = ["explore", "runs", "settings"].includes(state.screen);
    const backTarget = {
      details: "explore",
      checkpoint: "runs",
      questions: isFinalCheckpoint(currentRun()) ? "finale" : "checkpoint",
      finale: "checkpoint",
      scanner: "finale",
      completion: "runs",
    }[state.screen];
    const title = {
      details: "details",
      checkpoint: "checkpoint",
      questions: "questionSet",
      finale: "final",
      scanner: "scanner",
      completion: "summary",
    }[state.screen];
    app.lang = state.locale;
    app.innerHTML = `<header class="app-header">${root ? `<div class="app-brand">${icon("compass")}Signal Hunt</div>` : `<button class="icon-button" data-action="go" data-screen="${backTarget}" aria-label="${text("back")}" title="${text("back")}">${icon("arrow-left")}</button><span class="header-title">${text(title)}</span>`}<span class="header-locale">${state.locale.toUpperCase()}</span></header>${conditions.connection === "offline" ? `<div class="offline-banner" role="status">${text("offline")}</div>` : ""}<main class="app-content" id="screen-content">${views.render(state.screen, { state, conditions, locationError })}${state.feedback ? notice(state.feedback, "warning") : ""}</main>${
      root
        ? `<nav class="tab-bar" aria-label="${state.locale === "pl" ? "Nawigacja główna" : "Main navigation"}">${[
            ["explore", "compass"],
            ["runs", "route"],
            ["settings", "settings"],
          ]
            .map(
              ([screen, glyph]) =>
                `<button data-action="go" data-screen="${screen}" ${state.screen === screen ? 'aria-current="page"' : ""}>${icon(glyph)}${text(screen)}</button>`,
            )
            .join("")}</nav>`
        : ""
    }`;
    mountScreenMap();
    if (state.screen === "explore") filterDiscovery();
    const notes = screenNotes[state.screen];
    document.querySelector("#screen-caption").textContent = notes[0];
    document.querySelector("#context-title").textContent = notes[1];
    document.querySelector("#context-description").textContent = notes[2];
    document.querySelector("#context-checks").innerHTML = notes[3]
      .map((note) => `<li>${escapeHtml(note)}</li>`)
      .join("");
    persist();
  }

  function mountScreenMap() {
    visibleMap?.remove();
    visibleMap = null;
    const container = document.querySelector("#trail-map");
    if (!container) return;
    try {
      const run = currentRun();
      const discovery = container.dataset.map === "discovery";
      const checkpoint = container.dataset.map === "checkpoint" && run;
      const markers = discovery
        ? hunts
            .filter((hunt) =>
              hunt.title[state.locale]
                .toLocaleLowerCase(state.locale)
                .includes(
                  state.discoverySearch.trim().toLocaleLowerCase(state.locale),
                ),
            )
            .map((hunt) => ({
              id: hunt.id,
              position: hunt.checkpoints[0].position,
              number: hunts.indexOf(hunt) + 1,
              title: hunt.title[state.locale],
            }))
        : [
            {
              id: checkpoint ? run.id : state.huntId,
              position: checkpoint
                ? checkpointFor(run).position
                : huntFor().checkpoints[0].position,
              number: checkpoint ? run.checkpointIndex + 1 : 1,
              title: checkpoint
                ? checkpointFor(run).title[state.locale]
                : huntFor().startDescription[state.locale],
              current: Boolean(checkpoint),
            },
          ];
      visibleMap = window.SignalHuntMap?.mount(container, {
        markers,
        locale: state.locale,
        theme: document.documentElement.dataset.theme,
        onSelect: discovery
          ? (huntId) => {
              state.huntId = huntId;
              state.screen = "details";
              render();
            }
          : null,
      });
      if (!visibleMap && !container.textContent)
        throw new Error("Map assets unavailable");
    } catch {
      container.textContent = text("mapUnavailable");
    }
  }

  function filterDiscovery() {
    const search = state.discoverySearch.trim().toLocaleLowerCase(state.locale);
    const rows = [...document.querySelectorAll("[data-search]")];
    rows.forEach((row) => {
      row.hidden = !row.dataset.search.includes(search);
    });
    const count = rows.filter((row) => !row.hidden).length;
    document.querySelector("#search-empty").hidden = count > 0;
    document.querySelector("#result-count").textContent =
      `${count} / ${hunts.length}`;
  }

  function answerQuestion() {
    if (!requireConnection()) return;
    const run = currentRun();
    if (!run || run.status !== "active" || !runStep(run).unlocked) return;
    const question = checkpointFor(run).questions[state.questionIndex];
    const answerState = runStep(run).answers[state.questionIndex];
    if (questionResolved(answerState)) return;
    const result = game.gradeAnswer(question, answerState.draft, state.locale);
    if (result !== "correct") state.feedback = text(result);
    else {
      answerState.resolution = "correct";
      state.feedback = "";
      completeIfReady(run);
    }
    render();
  }

  function onlineAction(handler) {
    return (control, run) => {
      if (!requireConnection()) return false;
      return handler(control, run);
    };
  }

  function activeRunAction(handler, { unlocked = false } = {}) {
    return onlineAction((control, run) => {
      if (
        !run ||
        run.status !== "active" ||
        (unlocked && !runStep(run).unlocked)
      )
        return false;
      return handler(control, run);
    });
  }

  function openQuestions(run, overview = true) {
    if (!run || run.status !== "active" || !runStep(run).unlocked) return false;
    state.questionIndex = 0;
    state.screen = overview && isFinalCheckpoint(run) ? "finale" : "questions";
  }

  function canScan(run) {
    return (
      run?.status === "active" &&
      huntFor(run).physical &&
      isFinalCheckpoint(run) &&
      runStep(run).unlocked
    );
  }

  const actions = {
    "map-recenter": () => {
      visibleMap?.recenter();
      return false;
    },
    "discovery-view": (control) => {
      state.discoveryView = control.dataset.view;
    },
    go: (control) => {
      state.screen = control.dataset.screen;
    },
    details: (control) => {
      state.huntId = control.dataset.hunt;
      state.screen = "details";
    },
    locale: (control) => {
      state.locale = control.dataset.locale;
    },
    appearance: (control) => {
      state.appearance = control.dataset.mode;
    },
    start: onlineAction(() => {
      createRun(state.huntId);
    }),
    replay: onlineAction((control) => {
      state.huntId = control.dataset.hunt;
      state.screen = "details";
    }),
    resume: onlineAction((control) =>
      game.resumeRun(state, control.dataset.run),
    ),
    unlock: activeRunAction((control, run) => {
      const error = locationError();
      if (error) state.feedback = error;
      else {
        runStep(run).unlocked = true;
        openQuestions(run);
      }
    }),
    "open-questions": (control, run) => openQuestions(run),
    questions: (control, run) => openQuestions(run, false),
    "next-question": (control, run) => {
      if (!run || run.status !== "active" || !runStep(run).unlocked)
        return false;
      state.questionIndex =
        (state.questionIndex + 1) % checkpointFor(run).questions.length;
    },
    continue: activeRunAction(
      (control, run) => {
        if (!stepResolved(runStep(run))) return false;
        if (isFinalCheckpoint(run)) {
          completeIfReady(run);
          if (run.status !== "completed") state.screen = "finale";
        } else {
          run.checkpointIndex += 1;
          state.questionIndex = 0;
          state.screen = "checkpoint";
        }
      },
      { unlocked: true },
    ),
    hint: activeRunAction(
      (control, run) => {
        const answer = runStep(run).answers[state.questionIndex];
        const question = checkpointFor(run).questions[state.questionIndex];
        if (questionResolved(answer)) return false;
        answer.hints = Math.min(
          answer.hints + 1,
          question.hints[state.locale].length,
        );
      },
      { unlocked: true },
    ),
    reveal: activeRunAction(
      (control, run) => {
        const answer = runStep(run).answers[state.questionIndex];
        if (questionResolved(answer)) return false;
        confirmAction(
          text("revealTitle"),
          text("revealDescription"),
          text("revealConfirm"),
          () => {
            if (
              !requireConnection() ||
              currentRun() !== run ||
              run.status !== "active"
            )
              return;
            answer.resolution = "assisted";
            completeIfReady(run);
            render();
          },
        );
        return false;
      },
      { unlocked: true },
    ),
    scanner: (control, run) => {
      if (!canScan(run)) return false;
      state.screen = "scanner";
    },
    "scan-wrong": activeRunAction(
      (control, run) => {
        if (!canScan(run) || conditions.camera === "denied") return false;
        state.feedback = text("wrongCode");
      },
      { unlocked: true },
    ),
    "scan-valid": activeRunAction(
      (control, run) => {
        if (!canScan(run) || conditions.camera === "denied") return false;
        const error = locationError();
        if (error) state.feedback = error;
        else {
          run.qrVerified = true;
          completeIfReady(run);
          if (run.status !== "completed") state.screen = "finale";
        }
      },
      { unlocked: true },
    ),
    pause: activeRunAction((control, run) => {
      run.status = "suspended";
      state.activeRunId = null;
      state.screen = "runs";
      toast(text("pausedToast"));
    }),
    abandon: (control) => {
      const target = state.runs.find(
        (candidate) => candidate.id === control.dataset.run,
      );
      if (!target || !["active", "suspended"].includes(target.status))
        return false;
      confirmAction(
        text("abandonTitle"),
        text("abandonDescription"),
        text("abandon"),
        () => {
          if (!requireConnection() || !target) return;
          target.status = "abandoned";
          if (state.activeRunId === target.id) state.activeRunId = null;
          state.screen = "runs";
          render();
        },
      );
      return false;
    },
    delete: () => {
      confirmAction(
        text("deleteTitle"),
        text("deleteDescription"),
        text("deleteConfirm"),
        () => {
          if (!requireConnection()) return;
          const { locale, appearance } = state;
          state = freshState();
          state.locale = locale;
          state.appearance = appearance;
          state.screen = "settings";
          render();
        },
      );
      return false;
    },
    "preview-finale": () => {
      createRun(hunts[0].id, true);
      toast(text("demoLoaded"));
    },
    navigate: () => {
      toast(text("simulationNavigation"));
      return false;
    },
    "device-settings": () => {
      toast(text("simulationSettings"));
      return false;
    },
    refresh: () => {},
    reset: () => {
      state = freshState();
      Object.assign(conditions, {
        connection: "online",
        location: "near",
        camera: "allowed",
      });
      syncControls();
    },
  };

  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-action]");
    const action = control?.dataset.action;
    if (!Object.hasOwn(actions, action)) return;
    state.feedback = "";
    if (actions[action](control, currentRun()) === false) return;
    render();
    if (action === "appearance") {
      document
        .querySelector(
          `[data-action="appearance"][data-mode="${state.appearance}"]`,
        )
        .focus({ preventScroll: true });
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id === "hunt-search") {
      state.discoverySearch = event.target.value;
      filterDiscovery();
      mountScreenMap();
      return;
    }
    if (event.target.name === "answer") {
      const run = currentRun();
      if (run && runStep(run).unlocked) {
        runStep(run).answers[state.questionIndex].draft = event.target.value;
        persist();
      }
    }
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "answer-form") return;
    event.preventDefault();
    answerQuestion();
  });

  document
    .querySelector("#dialog-cancel")
    .addEventListener("click", () => dialog.close());
  document.querySelector("#dialog-confirm").addEventListener("click", () => {
    const callback = pendingConfirmation;
    dialog.close();
    pendingConfirmation = null;
    callback?.();
  });
  dialog.addEventListener("close", () => {
    pendingConfirmation = null;
  });

  function syncControls() {
    Object.entries(conditions).forEach(([name, value]) => {
      document.querySelector(`#scenario-${name}`).value = value;
    });
  }

  Object.keys(conditions).forEach((name) => {
    document
      .querySelector(`#scenario-${name}`)
      .addEventListener("change", (event) => {
        conditions[name] = event.target.value;
        state.feedback = "";
        render();
      });
  });

  render();
})();
