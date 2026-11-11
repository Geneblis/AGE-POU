import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { state, editorSnapshot, applySnapshot, recordHistory, resetHistory, stepHistory, observeHistory, historyAvailability } from "../scripts/models/editor-state.js";

test("models não dependem da página e todos os imports MVC resolvem", async () => {
  const scripts = new URL("../scripts/", import.meta.url);
  for (const folder of ["models", "views", "controllers", "export"]) {
    for (const name of await readdir(new URL(`${folder}/`, scripts))) {
      const file = new URL(`${folder}/${name}`, scripts);
      const source = await readFile(file, "utf8");
      if (folder === "models") {
        assert.doesNotMatch(source, /\b(?:document|window)\b|from ["'][^"']*(?:views|controllers)\//, name);
      }
      for (const [, path] of source.matchAll(/from "(\.[^"]+)"/g)) {
        await readFile(new URL(path, file));
      }
    }
  }
});

test("histórico notifica a interface e restaura entradas sem precisar do DOM", () => {
  const original = editorSnapshot();
  let notifications = 0;
  observeHistory(() => notifications++);
  try {
    resetHistory();
    const before = editorSnapshot();
    state.endYear = 2030;
    recordHistory(before);
    assert.deepEqual(historyAvailability(), { canUndo: true, canRedo: false });
    applySnapshot(stepHistory("undo"));
    assert.equal(state.endYear, before.endYear);
    assert.deepEqual(historyAvailability(), { canUndo: false, canRedo: true });
    applySnapshot(stepHistory("redo"));
    assert.equal(state.endYear, 2030);
    assert.equal(notifications, 2);
  } finally {
    applySnapshot(original);
    observeHistory(() => {});
    resetHistory();
  }
});
