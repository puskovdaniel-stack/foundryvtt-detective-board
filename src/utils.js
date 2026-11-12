export const MOD = "detective-board";
export const VERSION = 1;
export const OWNER = 3;
export const OBSERVER = 2;

// Keep long Foundry dialogs within the available screen size.
export function boardDialogPosition(viewportWidth = 1024, viewportHeight = 768) {
  return {
    width: Math.max(160, Math.min(540, Math.floor(viewportWidth) - 32)),
    height: Math.max(160, Math.min(640, Math.floor(viewportHeight) - 64))
  };
}

export function escapeHTML(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}
export function safeImage(value = "") {
  const s = String(value ?? "").trim();
  if (!s || /^(?:javascript|data|blob|file):/i.test(s)) return "";
  return /^(https?:\/\/|\/|\.\.?\/|[a-zA-Z0-9_\-]+\/)/.test(s) ? escapeHTML(s) : "";
}
export function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
export function own(object, prop) { return Object.prototype.hasOwnProperty.call(object, prop); }
export function notifyError(error) {
  console.error(`${MOD} |`, error);
  ui.notifications.error(`${game.i18n.localize("DB.Error")}: ${error.message ?? error}`);
}
export function t(key) { return game.i18n.localize(`DB.${key}`); }
export function ask(config) {
  return foundry.applications.api.DialogV2.prompt({ rejectClose: false, ...config });
}
export function confirm(content, title = t("Confirm")) {
  return foundry.applications.api.DialogV2.confirm({ window: { title }, content, rejectClose: false });
}
export function downloadText(filename, text, type = "application/json") {
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export function usersHTML(current = {}) {
  return game.users.contents.filter(u => !u.isGM).map(u => {
    const level = Number(current[u.id] ?? current.default ?? 0);
    return `<label class="db-permission"><span>${escapeHTML(u.name)}</span>
      <select name="permission-${escapeHTML(u.id)}">
        <option value="0" ${level === 0 ? "selected" : ""}>Нет доступа</option>
        <option value="2" ${level === 2 ? "selected" : ""}>Просмотр</option>
        <option value="3" ${level === 3 ? "selected" : ""}>Совладелец</option>
      </select></label>`;
  }).join("");
}
export function readUserPermissions(form) {
  const out = {};
  for (const u of game.users.contents.filter(u => !u.isGM)) {
    const select = form.elements.namedItem(`permission-${u.id}`);
    if (select) out[u.id] = Number(select.value);
  }
  return out;
}
export function entryFlag(kind, rest = {}) {
  return { [MOD]: { entry: { kind, schemaVersion: VERSION, ...rest } } };
}
export function pageData(kind, name, rest = {}) {
  return { name: String(name).slice(0, 100), type: "text", text: { content: "" }, flags: entryFlag(kind, rest) };
}
export function cardPosition(index = 0) {
  return { x: 170 + (index % 4) * 270, y: 160 + Math.floor(index / 4) * 230 };
}
