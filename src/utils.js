export const MOD = "detective-board";
export const VERSION = 1;
export const OWNER = 3;
export const OBSERVER = 2;
export const DRAG_TYPES = ["Actor","Item","JournalEntry","JournalEntryPage","Scene"];
export function draggedDocumentUUID(data) {
  if (!DRAG_TYPES.includes(data?.type)) return null;
  return (typeof data.uuid === "string" && data.uuid) || (data.id ? `${data.type}.${data.id}` : null);
}
export function showWindowCloseX(app) {
  const close = app.window?.close;
  if (!close) return;
  // Foundry's header icons may be unavailable with some custom themes.
  // Keep only one explicit close button in our application windows.
  close.textContent = "×";
  close.classList.add("db-close-x");
  close.setAttribute("aria-label","Закрыть");
  close.title = "Закрыть";
  for (const button of app.window?.header?.querySelectorAll("button") || []) {
    if (button !== close) button.style.display = "none";
  }
}

// Keep long Foundry dialogs within the available screen size.
export function boardDialogPosition(viewportWidth = 1024, viewportHeight = 768) {
  return {
    width: Math.max(160, Math.min(540, Math.floor(viewportWidth) - 32)),
    height: Math.max(160, Math.min(640, Math.floor(viewportHeight) - 64))
  };
}

export function boardWindowPosition(width, height, viewportWidth = 1024, viewportHeight = 768) {
  return {
    width: Math.max(160, Math.min(width, Math.floor(viewportWidth) - 32)),
    height: Math.max(160, Math.min(height, Math.floor(viewportHeight) - 64))
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
// Pointer deltas are projected onto a rotated card's local axes.
export function cardResizeDimensions(width,height,deltaX,deltaY,rotation=0) {
  const angle=(Number(rotation)||0)*Math.PI/180;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  return {
    width:Math.round(clamp(Number(width)+(Number(deltaX)||0)*cos+(Number(deltaY)||0)*sin,160,620)),
    height:Math.round(clamp(Number(height)-(Number(deltaX)||0)*sin+(Number(deltaY)||0)*cos,130,740))
  };
}
// Positions of the real red pins, including rotated evidence cards.
export function cardPinPosition(card) {
  const width=clamp(card.width,160,620),height=clamp(card.height,130,740);
  const angle=clamp(card.rotation||0,-30,30)*Math.PI/180;
  const radius=height/2+1;
  return {
    x:(Number(card.x)||0)+width/2+radius*Math.sin(angle),
    y:(Number(card.y)||0)+height/2-radius*Math.cos(angle)
  };
}
export function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
export function own(object, prop) { return Object.prototype.hasOwnProperty.call(object, prop); }
export function notifyError(error) {
  console.error(`${MOD} |`, error);
  ui.notifications.error(`${game.i18n.localize("DB.Error")}: ${error.message ?? error}`);
}
export function t(key) { return game.i18n.localize(`DB.${key}`); }
export function ask(config) {
  const html = typeof config?.content === "string" ? config.content : "";
  const isLongForm = html.includes("<textarea") || html.includes("db-permission-list")
    || html.includes("db-other-note") || html.length > 700 || html.includes("db-history");
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const bounds=boardDialogPosition(viewportWidth,viewportHeight);
  return foundry.applications.api.DialogV2.prompt({
    ...config,
    rejectClose:false,
    classes:[...new Set(["db-board-form-dialog", ...(config.classes || [])])],
    window:{resizable:true, ...(config.window || {})},
    position:{...bounds,height:isLongForm?bounds.height:Math.min(320,bounds.height),...(config.position || {})},
    render:(event,dialog)=>{showWindowCloseX(dialog);config.render?.(event,dialog);}
  });
}
export function confirm(content, title = t("Confirm")) {
  const viewportWidth=typeof window==="undefined"?1024:window.innerWidth;
  const viewportHeight=typeof window==="undefined"?768:window.innerHeight;
  const bounds=boardDialogPosition(viewportWidth,viewportHeight);
  return foundry.applications.api.DialogV2.confirm({
    classes:["db-board-form-dialog"],
    window:{title,resizable:true},content,rejectClose:false,
    position:{width:Math.min(480,bounds.width),height:Math.min(250,bounds.height)},
    render:(_event,dialog)=>showWindowCloseX(dialog)
  });
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
