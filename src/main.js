import {MOD, notifyError} from "./utils.js";
import {openManager} from "./manager.js";
import {activeEditors} from "./editor.js";
import {DBStore} from "./store.js";

function launch() { return openManager(); }
function rerenderEditors(boardId) {
  for(const app of activeEditors) if(app.boardId===boardId) app.updateFromFoundry();
}
function addJournalButton(_app, html) {
  const root=html instanceof HTMLElement ? html : html?.[0];
  if(!root?.querySelector) return;
  if(root.querySelector(".db-open-directory")) return;
  const target=root.querySelector(".action-buttons") || root.querySelector(".directory-header") || root.querySelector("header");
  if(!target) return;
  const button=document.createElement("button");
  button.type="button";button.className="db-open-directory";
  button.innerHTML='<i class="fa-solid fa-thumbtack"></i> Detective Board';
  button.title="Открыть детективные доски";
  button.addEventListener("click",launch);
  target.append(button);
}

Hooks.once("init", () => {
  Hooks.on("getSceneControlButtons", controls => {
    const group=controls.notes || controls.tokens;
    if(!group?.tools) return;
    group.tools.detectiveBoard={
      name:"detectiveBoard",title:"Detective Board",icon:"fa-solid fa-thumbtack",
      order:Object.keys(group.tools).length + 1,button:true,visible:true,
      onChange:launch
    };
  });
  Hooks.on("renderJournalDirectory", addJournalButton);
});

Hooks.once("ready", () => {
  if(game.user.isGM) DBStore.ensureStorageFolder({migrate:true})
    .catch(err=>console.warn(`${MOD} | Cannot initialize journal folder`,err));
  const mod=game.modules.get(MOD);
  if(mod) mod.api={open:launch,version:"0.1.0"};
  Hooks.on("createJournalEntryPage",page=>{
    if(page.parent?.getFlag(MOD,"board")?.kind==="board")rerenderEditors(page.parent.id);
  });
  Hooks.on("updateJournalEntryPage",page=>{
    if(page.parent?.getFlag(MOD,"board")?.kind==="board")rerenderEditors(page.parent.id);
  });
  Hooks.on("deleteJournalEntryPage",page=>{
    if(page.parent?.getFlag(MOD,"board")?.kind==="board")rerenderEditors(page.parent.id);
  });
  Hooks.on("updateJournalEntry",doc=>{
    if(doc.getFlag(MOD,"board")?.kind==="board")rerenderEditors(doc.id);
  });
  console.info(`${MOD} | Initialized. Open: game.modules.get("${MOD}").api.open()`);
});
