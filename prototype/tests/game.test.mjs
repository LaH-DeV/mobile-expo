import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

function setup(transform = () => {}) {
  const context = { window: {}, crypto: { randomUUID } };
  runInNewContext(
    readFileSync(new URL("../config/hunts.js", import.meta.url), "utf8"),
    context,
  );
  transform(context.window.SignalHuntHunts);
  runInNewContext(
    readFileSync(new URL("../game.js", import.meta.url), "utf8"),
    context,
  );
  runInNewContext(
    readFileSync(new URL("../ui/copy.js", import.meta.url), "utf8"),
    context,
  );
  runInNewContext(
    readFileSync(new URL("../ui/views.js", import.meta.url), "utf8"),
    context,
  );
  return {
    game: context.window.SignalHuntGame,
    hunts: context.window.SignalHuntHunts,
    views: context.window.SignalHuntViews,
  };
}

test("published fixtures have complete bilingual content and stable question IDs", () => {
  const { game, hunts } = setup();
  assert.equal(hunts.length, 2);
  assert.equal(game.validateHunts(hunts), undefined);
  assert.equal(hunts[0].checkpoints[2].questions[1].id, "pavilion.symbol");
  assert.equal(hunts[1].checkpoints[0].position[0], 52.2307);
});

test("configuration errors identify the field to repair", () => {
  assert.throws(
    () =>
      setup((hunts) => {
        delete hunts[0].checkpoints[0].questions[0].prompt.pl;
      }),
    /gate.date.prompt.pl/,
  );
  assert.throws(
    () =>
      setup((hunts) => {
        hunts[0].checkpoints[0].position = [100, 21];
      }),
    /gate.position/,
  );
  assert.throws(
    () =>
      setup((hunts) => {
        hunts[0].checkpoints[2].questions[1].accepted.en = ["missing"];
      }),
    /pavilion.symbol.accepted.en/,
  );
  assert.throws(
    () =>
      setup((hunts) => {
        hunts[0].checkpoints[0].questions[0].hints.pl = [];
      }),
    /gate.date.hints/,
  );
});

test("one-stop and four-stop hunts need no controller changes", () => {
  for (const count of [1, 4]) {
    const { game, hunts } = setup((items) => {
      const hunt = items[0];
      hunt.checkpoints = Array.from({ length: count }, (_, index) => ({
        ...hunt.checkpoints[0],
        id: `stop-${index}`,
        questions: [
          { ...hunt.checkpoints[0].questions[0], id: `stop-${index}.date` },
        ],
      }));
    });
    const state = game.createState();
    const run = game.startRun(state, hunts[0].id, true);
    assert.equal(run.steps.length, count);
    assert.equal(run.checkpointIndex, count - 1);
    assert.equal(game.isFinalCheckpoint(run), true);
    assert.equal(game.getStep(run).answers.length, 1);
    assert.equal(game.getStep(run).answers[0].resolution, null);
  }
});

test("starting and resuming suspend the previous active run without losing drafts", () => {
  const { game, hunts } = setup();
  const state = game.createState();
  const first = game.startRun(state, hunts[0].id);
  first.steps[0].answers[0].draft = "192";
  const second = game.startRun(state, hunts[1].id);
  assert.equal(first.status, "suspended");
  assert.equal(game.resumeRun(state, first.id), true);
  assert.equal(second.status, "suspended");
  assert.equal(first.steps[0].answers[0].draft, "192");
  assert.equal(state.runs.filter((run) => run.status === "active").length, 1);
});

test("physical finale requires questions and QR, in either order", () => {
  for (const qrFirst of [true, false]) {
    const { game, hunts } = setup();
    const state = game.createState();
    const run = game.startRun(state, hunts[0].id, true);
    const resolve = () =>
      game.getStep(run).answers.forEach((answer) => {
        answer.resolution = "assisted";
      });
    if (qrFirst) run.qrVerified = true;
    else resolve();
    assert.equal(game.completeIfReady(state, run), false);
    if (qrFirst) resolve();
    else run.qrVerified = true;
    assert.equal(game.completeIfReady(state, run), true);
    assert.equal(state.screen, "completion");
    assert.equal(run.status, "completed");
    assert.equal(game.completeIfReady(state, run), false);
  }
});

test("digital finale completes without QR and suspended runs cannot complete", () => {
  const { game, hunts } = setup();
  const state = game.createState();
  const run = game.startRun(state, hunts[1].id, true);
  game.getStep(run).answers.forEach((answer) => {
    answer.resolution = "correct";
  });
  run.status = "suspended";
  assert.equal(game.completeIfReady(state, run), false);
  run.status = "active";
  assert.equal(game.completeIfReady(state, run), true);
  assert.equal(run.qrVerified, false);
});

test("Settings language controls text matching; choice answers use stable IDs", () => {
  const { game, hunts } = setup();
  const question = hunts[0].checkpoints[1].questions[0];
  assert.equal(game.gradeAnswer(question, " COPPER ", "en"), "correct");
  assert.equal(game.gradeAnswer(question, "copper", "pl"), "wrong");
  assert.equal(game.gradeAnswer(question, " MIEDZIANY ", "pl"), "correct");
  assert.equal(game.gradeAnswer(question, " ", "pl"), "invalid");
  const choice = hunts[0].checkpoints[2].questions[1];
  assert.equal(game.gradeAnswer(choice, "bird", "pl"), "correct");
  assert.equal(game.gradeAnswer(choice, "", "en"), "choose");
});

test("legacy saved runs retain IDs, drafts, progress and hints, without pinned languages", () => {
  const { game, hunts } = setup();
  const state = game.createState();
  const run = game.startRun(state, hunts[0].id);
  run.locale = "pl";
  run.steps[0].unlocked = true;
  run.steps[0].answers[0].draft = "192";
  run.steps[0].answers[0].hints = 1;
  state.contentLocale = "pl";
  const restored = game.loadState(JSON.stringify(state));
  assert.equal(restored.runs[0].id, run.id);
  assert.equal(
    JSON.stringify(restored.runs[0].steps),
    JSON.stringify(run.steps),
  );
  assert.equal(restored.activeRunId, run.id);
  assert.equal(restored.locale, "en");
  assert.equal("locale" in restored.runs[0], false);
  assert.equal("contentLocale" in restored, false);
});

test("corrupt runs do not discard other saved progress; unavailable storage starts safely", () => {
  const { game, hunts } = setup();
  const state = game.createState();
  const run = game.startRun(state, hunts[0].id);
  state.runs.push({ id: "broken", huntId: "removed-hunt" });
  const restored = game.loadState(JSON.stringify(state));
  assert.equal(restored.runs.length, 1);
  assert.equal(restored.runs[0].id, run.id);
  assert.equal(game.loadState("not json").runs.length, 0);
  assert.equal(game.loadState(null).runs.length, 0);
});

test("views derive route counts, final question counts and metadata from configuration", () => {
  for (const count of [1, 4]) {
    const { game, hunts, views } = setup((items) => {
      const hunt = items[0];
      hunt.estimatedDistanceKm = 1.7;
      hunt.estimatedDurationMinutes = 42;
      hunt.checkpoints = Array.from({ length: count }, (_, index) => ({
        ...hunt.checkpoints[0],
        id: `stop-${index}`,
        questions: [
          { ...hunt.checkpoints[0].questions[0], id: `stop-${index}.date` },
        ],
      }));
    });
    const state = game.createState();
    state.discoveryView = "list";
    const context = {
      state,
      conditions: { location: "near", camera: "allowed" },
      locationError: () => null,
    };
    assert.match(
      views.render("explore", context),
      new RegExp(`PL / EN · ${count} checkpoints`),
    );
    assert.match(views.render("details", context), /1.7 km/);
    assert.match(views.render("details", context), /42 min/);
    const run = game.startRun(state, hunts[0].id, true);
    assert.match(
      views.render("checkpoint", context),
      new RegExp(`${count} of ${count}`),
    );
    assert.match(views.render("finale", context), /Selected questions: 1/);
    assert.match(
      views.render("runs", context),
      new RegExp(`${count} of ${count}`),
    );
    run.qrVerified = true;
    game.getStep(run).answers[0].resolution = "correct";
    game.completeIfReady(state, run);
    assert.match(
      views.render("completion", context),
      new RegExp(`${count} / ${count}`),
    );
  }
});

test("every screen renders in both languages and authored text is escaped", () => {
  const { game, hunts, views } = setup();
  const state = game.createState();
  const run = game.startRun(state, hunts[0].id, true);
  const context = {
    state,
    conditions: { location: "near", camera: "allowed" },
    locationError: () => null,
  };
  for (const locale of ["en", "pl"]) {
    state.locale = locale;
    for (const screen of [
      "explore",
      "details",
      "checkpoint",
      "questions",
      "finale",
      "scanner",
      "runs",
      "settings",
    ]) {
      assert(views.render(screen, context).length > 0, `${screen} / ${locale}`);
    }
  }
  hunts[0].title.pl = "<script>not markup</script>";
  assert.match(
    views.render("details", context),
    /&lt;script&gt;not markup&lt;\/script&gt;/,
  );
  assert.equal(run.status, "active");
});
