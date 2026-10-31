"use strict";

(() => {
  const locales = ["en", "pl"];
  const hunts = window.SignalHuntHunts;

  function requireField(condition, path, description) {
    if (!condition)
      throw new Error(`Hunt configuration: ${path} ${description}`);
  }

  function requireText(value, path) {
    locales.forEach((locale) => {
      requireField(
        typeof value?.[locale] === "string" && value[locale].trim().length > 0,
        `${path}.${locale}`,
        "must be non-empty text",
      );
    });
  }

  function requireUniqueIds(items, path) {
    requireField(
      Array.isArray(items) && items.length > 0,
      path,
      "must be a non-empty array",
    );
    const ids = new Set();
    items.forEach((item, index) => {
      requireField(
        typeof item?.id === "string" &&
          /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(item.id),
        `${path}[${index}].id`,
        "must use lowercase letters, digits, dots or hyphens",
      );
      requireField(
        !ids.has(item.id),
        `${path}[${index}].id`,
        `duplicates ${item.id}`,
      );
      ids.add(item.id);
    });
  }

  function validateHunts(items) {
    requireUniqueIds(items, "hunts");
    items.forEach((hunt) => {
      const path = `hunts.${hunt.id}`;
      ["title", "story", "terrain", "startDescription"].forEach((key) =>
        requireText(hunt[key], `${path}.${key}`),
      );
      requireField(
        typeof hunt.physical === "boolean",
        `${path}.physical`,
        "must be true or false",
      );
      ["estimatedDistanceKm", "estimatedDurationMinutes"].forEach((key) => {
        requireField(
          Number.isFinite(hunt[key]) && hunt[key] > 0,
          `${path}.${key}`,
          "must be a positive number",
        );
      });
      requireField(
        ["easy", "moderate", "hard"].includes(hunt.difficulty),
        `${path}.difficulty`,
        "must be easy, moderate or hard",
      );
      requireUniqueIds(hunt.checkpoints, `${path}.checkpoints`);
      const questionIds = new Set();
      hunt.checkpoints.forEach((checkpoint) => {
        const checkpointPath = `${path}.checkpoints.${checkpoint.id}`;
        requireText(checkpoint.title, `${checkpointPath}.title`);
        requireField(
          Array.isArray(checkpoint.position) &&
            checkpoint.position.length === 2 &&
            Number.isFinite(checkpoint.position[0]) &&
            Math.abs(checkpoint.position[0]) <= 90 &&
            Number.isFinite(checkpoint.position[1]) &&
            Math.abs(checkpoint.position[1]) <= 180,
          `${checkpointPath}.position`,
          "must be [latitude, longitude] in degrees",
        );
        requireUniqueIds(checkpoint.questions, `${checkpointPath}.questions`);
        checkpoint.questions.forEach((question) => {
          const questionPath = `${checkpointPath}.questions.${question.id}`;
          requireField(
            !questionIds.has(question.id),
            `${questionPath}.id`,
            "must be unique within this hunt",
          );
          questionIds.add(question.id);
          requireField(
            ["numeric", "text", "choice"].includes(question.type),
            `${questionPath}.type`,
            "must be numeric, text or choice",
          );
          requireText(question.prompt, `${questionPath}.prompt`);
          requireText(question.explanation, `${questionPath}.explanation`);
          if (question.type === "choice") {
            requireUniqueIds(question.options, `${questionPath}.options`);
            question.options.forEach((option) =>
              requireText(option, `${questionPath}.options.${option.id}`),
            );
          }
          locales.forEach((locale) => {
            const accepted = question.accepted?.[locale];
            const hints = question.hints?.[locale];
            requireField(
              Array.isArray(accepted) &&
                accepted.length > 0 &&
                accepted.every(
                  (answer) =>
                    typeof answer === "string" &&
                    answer.trim().length > 0 &&
                    (question.type === "choice"
                      ? question.options.some((option) => option.id === answer)
                      : normalizeAnswer(answer, locale) === answer),
                ),
              `${questionPath}.accepted.${locale}`,
              "must contain normalized answer strings (or valid choice IDs)",
            );
            requireField(
              Array.isArray(hints) &&
                hints.every(
                  (hint) => typeof hint === "string" && hint.trim().length > 0,
                ),
              `${questionPath}.hints.${locale}`,
              "must be an array of hint texts (an empty array is allowed)",
            );
          });
          requireField(
            question.hints.en.length === question.hints.pl.length,
            `${questionPath}.hints`,
            "must have the same number of hints in both languages",
          );
        });
      });
    });
  }

  function getHunt(huntId) {
    return hunts.find((hunt) => hunt.id === huntId);
  }

  const getCheckpoint = (run) =>
    getHunt(run.huntId).checkpoints[run.checkpointIndex];
  const getStep = (run) => run.steps[run.checkpointIndex];
  const isFinalCheckpoint = (run) =>
    Boolean(run) &&
    run.checkpointIndex === getHunt(run.huntId).checkpoints.length - 1;
  const isQuestionResolved = (answer) => Boolean(answer?.resolution);
  const isStepResolved = (step) => step.answers.every(isQuestionResolved);

  function createState() {
    return {
      locale: "en",
      appearance: "system",
      discoveryView: "map",
      discoverySearch: "",
      screen: "explore",
      huntId: hunts[0].id,
      activeRunId: null,
      runs: [],
      questionIndex: 0,
      feedback: "",
    };
  }

  function validRun(run) {
    const hunt = getHunt(run?.huntId);
    return (
      Boolean(hunt) &&
      typeof run.id === "string" &&
      ["active", "suspended", "completed", "abandoned"].includes(run.status) &&
      typeof run.qrVerified === "boolean" &&
      Number.isInteger(run.checkpointIndex) &&
      run.checkpointIndex >= 0 &&
      run.checkpointIndex < hunt.checkpoints.length &&
      (!run.completedAt || Number.isFinite(Date.parse(run.completedAt))) &&
      Array.isArray(run.steps) &&
      run.steps.length === hunt.checkpoints.length &&
      run.steps.every(
        (step, index) =>
          typeof step?.unlocked === "boolean" &&
          Array.isArray(step.answers) &&
          step.answers.length === hunt.checkpoints[index].questions.length &&
          step.answers.every(
            (answer, questionIndex) =>
              typeof answer?.draft === "string" &&
              [null, "correct", "assisted"].includes(answer.resolution) &&
              Number.isInteger(answer.hints) &&
              answer.hints >= 0 &&
              answer.hints <=
                hunt.checkpoints[index].questions[questionIndex].hints.en
                  .length,
          ),
      )
    );
  }

  function loadState(serialized) {
    try {
      const saved = JSON.parse(serialized);
      if (
        !saved ||
        !locales.includes(saved.locale) ||
        !Array.isArray(saved.runs)
      )
        return createState();
      const runs = saved.runs.filter(validRun).map((run) => {
        const { locale, ...restored } = run;
        return restored;
      });
      const active = runs.find(
        (run) => run.id === saved.activeRunId && run.status === "active",
      );
      runs.forEach((run) => {
        if (run.status === "active" && run !== active) run.status = "suspended";
      });
      return {
        ...createState(),
        locale: saved.locale,
        appearance: ["light", "dark", "system"].includes(saved.appearance)
          ? saved.appearance
          : "system",
        discoveryView: saved.discoveryView === "list" ? "list" : "map",
        huntId: getHunt(saved.huntId)?.id ?? hunts[0].id,
        activeRunId: active?.id ?? null,
        runs,
      };
    } catch {
      return createState();
    }
  }

  function startRun(state, huntId, finalePreview = false) {
    const hunt = getHunt(huntId);
    if (!hunt) return null;
    const active = state.runs.find((run) => run.id === state.activeRunId);
    if (active?.status === "active") active.status = "suspended";
    const finalIndex = hunt.checkpoints.length - 1;
    const run = {
      id: crypto.randomUUID ? crypto.randomUUID() : `run-${Date.now()}`,
      huntId,
      status: "active",
      checkpointIndex: finalePreview ? finalIndex : 0,
      qrVerified: false,
      steps: hunt.checkpoints.map((checkpoint, index) => ({
        unlocked: finalePreview,
        answers: checkpoint.questions.map(() => ({
          draft: "",
          resolution: finalePreview && index < finalIndex ? "correct" : null,
          hints: 0,
        })),
      })),
    };
    state.runs.unshift(run);
    state.activeRunId = run.id;
    state.screen = finalePreview ? "finale" : "checkpoint";
    state.questionIndex = 0;
    state.feedback = "";
    return run;
  }

  function resumeRun(state, runId) {
    const selected = state.runs.find((run) => run.id === runId);
    if (!selected || !["active", "suspended"].includes(selected.status))
      return false;
    state.runs.forEach((run) => {
      if (run.status === "active") run.status = "suspended";
    });
    selected.status = "active";
    state.activeRunId = selected.id;
    state.screen = "checkpoint";
    state.questionIndex = 0;
    return true;
  }

  function completeIfReady(state, run) {
    if (
      run.status !== "active" ||
      !isFinalCheckpoint(run) ||
      !getStep(run).unlocked ||
      !isStepResolved(getStep(run)) ||
      (getHunt(run.huntId).physical && !run.qrVerified)
    )
      return false;
    run.status = "completed";
    run.completedAt = new Date().toISOString();
    state.screen = "completion";
    return true;
  }

  function normalizeAnswer(answer, locale) {
    return answer
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase(locale);
  }

  function gradeAnswer(question, draft, locale) {
    const submitted = normalizeAnswer(draft, locale);
    if (!submitted) return question.type === "choice" ? "choose" : "invalid";
    return question.accepted[locale].includes(submitted) ? "correct" : "wrong";
  }

  validateHunts(hunts);
  window.SignalHuntGame = {
    validateHunts,
    getHunt,
    getCheckpoint,
    getStep,
    isFinalCheckpoint,
    isQuestionResolved,
    isStepResolved,
    createState,
    loadState,
    startRun,
    resumeRun,
    completeIfReady,
    gradeAnswer,
  };
})();
