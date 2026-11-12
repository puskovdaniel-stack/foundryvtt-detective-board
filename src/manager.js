import {escapeHTML, ask, confirm, notifyError, usersHTML, readUserPermissions, MOD, downloadText, boardDialogPosition, showWindowCloseX} from "./utils.js";
import {DBStore} from "./store.js";
import {BoardEditor, activeEditors} from "./editor.js";

let managerInstance;
export function openManager() {
  if (!managerInstance) managerInstance = new BoardManager();
  managerInstance.render({force:true});
  return managerInstance;
}

export class BoardManager extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id:"detective-board-manager", classes:["db-app","db-manager-app"],
    window:{title:"Detective Board - Расследования",icon:"fa-solid fa-thumbtack",resizable:true},
    position:{width:850,height:665}
  };
  constructor(...args) { super(...args); this.filter=""; }
  async _renderHTML() {
    const root=document.createElement("section");root.className="db-manager";
    const cards=DBStore.listBoards().filter(b=>`${b.name} ${b.getFlag(MOD,"board")?.description||""}`.toLocaleLowerCase().includes(this.filter.toLocaleLowerCase()));
    root.innerHTML=`<header class="db-manager-head">
       <div><h2>Доски расследований</h2><p>Все доступные вам детективные доски этого мира.</p></div>
       <button class="db-primary" data-action="create"><i class="fa-solid fa-plus"></i> Новая доска</button>
      </header>
      <div class="db-manager-toolbar"><input class="db-search" type="search" placeholder="Поиск расследований" value="${escapeHTML(this.filter)}" data-role="search" />
        <button data-action="import" title="Импорт JSON"><i class="fa-solid fa-file-import"></i> Импорт</button>
        <input type="file" accept=".json,application/json" class="db-import-input" hidden /></div>
      <div class="db-board-grid">${cards.length ? cards.map(b=>{
        const meta=b.getFlag(MOD,"board")||{};
        const isOwner=DBStore.canEdit(b);
        const num=DBStore.cards(b).length;
        return `<article class="db-board-tile" data-board="${b.id}">
          <div class="db-board-thumb"><div class="db-thumb-paper p1"></div><div class="db-thumb-paper p2"></div><div class="db-thumb-paper p3"></div><span class="db-thumb-thread"></span></div>
          <div class="db-board-tile-body"><div class="db-board-title">${escapeHTML(b.name)}</div>
          <p>${escapeHTML(meta.description||"Без описания")}</p>
          <div class="db-board-foot"><span><i class="fa-solid fa-${isOwner?"pen-to-square":"eye"}"></i> ${isOwner?"Редактирование":"Просмотр"} · ${num} улик</span>
          <button data-action="options" data-id="${b.id}" title="Настройки"><i class="fa-solid fa-ellipsis"></i></button></div></div>
        </article>`;}).join("") : `<div class="db-empty"><i class="fa-solid fa-thumbtack"></i><h3>Досок пока нет</h3><p>Создайте первую доску или импортируйте JSON.</p></div>`}</div>
      <footer class="db-manager-footer">Detective Board v0.1.0 · Foundry VTT 13</footer>`;
    return root;
  }
  _replaceHTML(result, content) {
    content.replaceChildren(result);
    showWindowCloseX(this);
    result.querySelector('[data-role="search"]')?.addEventListener("input",e=>{
      this.filter=e.target.value;
      const tiles=result.querySelectorAll(".db-board-tile");
      for(const tile of tiles) {
        const b=DBStore.board(tile.dataset.board);
        tile.hidden=!`${b?.name||""} ${b?.getFlag(MOD,"board")?.description||""}`.toLowerCase().includes(this.filter.toLowerCase());
      }
    });
    result.addEventListener("click",e=>this.onClick(e));
    result.querySelector(".db-import-input")?.addEventListener("change",e=>this.onImport(e));
  }
  async onClick(event) {
    const button=event.target.closest("[data-action]");
    if(button) {
      try {
        if(button.dataset.action==="create") await this.createBoard();
        else if(button.dataset.action==="options") await this.manageBoard(button.dataset.id);
        else if(button.dataset.action==="import") this.element.querySelector(".db-import-input")?.click();
      } catch(error) {notifyError(error);}
      return;
    }
    const tile=event.target.closest("[data-board]");
    if(tile) this.openBoard(tile.dataset.board);
  }
  openBoard(boardId) {
    if(!DBStore.board(boardId)) return;
    const existing=[...activeEditors].find(app=>app.boardId===boardId && app.rendered);
    if(existing) {existing.bringToFront();return;}
    new BoardEditor(boardId).render({force:true});
  }
  async createBoard() {
    if(!DBStore.canCreate()) return ui.notifications.warn("GM должен разрешить вашему игроку создание Journal Entries.");
    const result=await ask({
      classes:["db-board-form-dialog"],
      position:boardDialogPosition(window.innerWidth,window.innerHeight),
      window:{title:"Новая детективная доска",resizable:true},
      content:`
      <div class="db-dialog"><label>Название<input name="title" required maxlength="100" value="Новое расследование"></label>
      <label>Описание<textarea name="description" rows="2" maxlength="1500"></textarea></label>
      <label>Доступ<select name="access"><option value="private">Личная (по умолчанию)</option><option value="shared">Общая - все владельцы</option><option value="view">Просмотр всем</option><option value="custom">Выборочный доступ</option></select></label>
      <label>Оформление<select name="theme"><option value="classic">Классическая пробковая доска (по умолчанию)</option><option value="dark">Тёмная доска</option></select></label>
      <label>Шаблон<select name="template"><option value="empty">Пустая доска (по умолчанию)</option><option value="case">Расследование</option><option value="characters">Связи персонажей</option><option value="timeline">Хронология</option></select></label>
      <details><summary>Индивидуальные права игроков</summary><div class="db-permission-list">${usersHTML()}</div><small>Индивидуальные права имеют приоритет над общим доступом. Создатель всегда OWNER.</small></details>
      </div>`,ok:{label:"Создать доску",callback:(_event,button)=>{
        const f=button.form;
        return {name:f.elements.title.value,description:f.elements.description.value,access:f.elements.access.value,
          theme:f.elements.theme.value,template:f.elements.template.value,selected:readUserPermissions(f)};
      }}});
    if(!result) return;
    if(!result.name?.trim()) throw new Error("Введите название доски.");
    // The default per-user selection of "none" must not override the selected public board preset.
    if(result.access!=="custom") result.selected=Object.fromEntries(Object.entries(result.selected).filter(([,level])=>level>0));
    const board=await DBStore.createBoard(result);
    await this.render({force:true});
    this.openBoard(board.id);
  }
  async manageBoard(boardId) {
    const board=DBStore.board(boardId);if(!board) return;
    if(!DBStore.canEdit(board)) return ui.notifications.info("У вас доступ только на просмотр.");
    const meta=board.getFlag(MOD,"board")||{};
    const res=await ask({
      classes:["db-board-form-dialog"],
      position:boardDialogPosition(window.innerWidth,window.innerHeight),
      window:{title:`Настройки: ${board.name}`,resizable:true},
      content:`
      <div class="db-dialog"><label>Название<input name="title" maxlength="100" value="${escapeHTML(board.name)}"></label>
      <label>Описание<textarea name="description" rows="2">${escapeHTML(meta.description||"")}</textarea></label>
      <label>Оформление<select name="theme"><option value="classic" ${meta.theme!=="dark"?"selected":""}>Классическая</option><option value="dark" ${meta.theme==="dark"?"selected":""}>Тёмная</option></select></label>
      <label>Права доступа по умолчанию<select name="defaultAccess"><option value="0" ${(board.ownership?.default||0)===0?"selected":""}>Закрыта</option><option value="2" ${(board.ownership?.default||0)===2?"selected":""}>Просмотр всем</option><option value="3" ${(board.ownership?.default||0)===3?"selected":""}>Редактирование всем</option></select></label>
      <details open><summary>Владельцы и наблюдатели</summary><div class="db-permission-list">${usersHTML(board.ownership)}</div></details>
      <label class="db-archive-option"><input type="checkbox" name="deleteBoard"> Удалить доску навсегда (вместе с карточками)</label>
      </div>`,ok:{label:"Сохранить",callback:(_event,button)=>{
        const f=button.form;return {title:f.elements.title.value,description:f.elements.description.value,theme:f.elements.theme.value,
          defaultAccess:Number(f.elements.defaultAccess.value),selected:readUserPermissions(f),deleteBoard:f.elements.deleteBoard.checked};
      }}});
    if(!res) return;
    if(res.deleteBoard) {
      if(await confirm(`Безвозвратно удалить доску «${escapeHTML(board.name)}» и все её карточки?`,"Удаление доски")) {
        await board.delete(); await this.render({force:true});
      }
      return;
    }
    if(!res.title?.trim()) throw new Error("Название пустое.");
    const ownership={default:res.defaultAccess,...res.selected,[game.user.id]:3};
    // Avoid accidentally stripping other named owners (e.g. inactive users).
    for(const [key,level] of Object.entries(board.ownership||{})) if(key!=="default" && !(key in ownership)) ownership[key]=level;
    await board.update({name:res.title.trim().slice(0,100),ownership,[`flags.${MOD}.board`]:{...meta,description:res.description,theme:res.theme}});
    await this.render({force:true});
  }
  async onImport(event) {
    const file=event.target.files?.[0];event.target.value="";
    if(!file) return;
    try {
      if(file.size>4_000_000) throw new Error("Слишком большой файл (максимум 4 МБ).");
      const data=JSON.parse(await file.text());
      const board=await DBStore.importData(data);
      await this.render({force:true});this.openBoard(board.id);
      ui.notifications.info("Доска импортирована. Связи с исходными документами необходимо назначить заново.");
    } catch(error) {notifyError(error);}
  }
}
