import {escapeHTML, safeImage, clamp, ask, confirm, notifyError, downloadText, MOD, draggedDocumentUUID, showWindowCloseX, cardResizeDimensions} from "./utils.js";
import {DBStore} from "./store.js";

export const activeEditors = new Set();
const possibleTypes = ["note","actor","item","journal","scene","image","hypothesis"];
const kindLabels = {note:"Записка",actor:"Персонаж",item:"Предмет",journal:"Журнал",scene:"Сцена",image:"Изображение",hypothesis:"Гипотеза"};

function validColor(color) { return /^#[0-9a-fA-F]{6}$/.test(String(color)) ? color : "#ad392f"; }
function numberAttr(n) { return Number.isFinite(+n) ? Number(n) : 0; }

// Image path can still be entered manually; a V13 FilePicker is optional.
function imageFieldHTML(path="",editable=true) {
  const src=safeImage(path);
  return `<label>Изображение (путь в Foundry или URL)</label>
    <div class="db-image-picker">
      <input type="text" name="image" value="${escapeHTML(path)}" placeholder="icons/svg/mystery-man.svg" ${editable?"":"disabled"}>
      ${editable?'<button type="button" data-db-pick-image title="Выбрать файл в Foundry"><i class="fa-solid fa-folder-open"></i> Выбрать</button>':""}
    </div>
    <img class="db-image-preview" alt="Предпросмотр изображения" ${src?`src="${src}"`:'hidden'}>`;
}
function bindImagePicker(_event,dialog) {
  const root=dialog.element;
  const input=root?.querySelector('input[name="image"]');
  const button=root?.querySelector("[data-db-pick-image]");
  const preview=root?.querySelector(".db-image-preview");
  if(!input)return;
  input.addEventListener("input",()=>{
    const src=safeImage(input.value);
    if(preview) {
      if(src) {preview.src=input.value.trim();preview.hidden=false;}
      else {preview.removeAttribute("src");preview.hidden=true;}
    }
  });
  button?.addEventListener("click",()=>{
    const Picker=foundry.applications.apps.FilePicker;
    new Picker({
      type:"image",current:input.value,
      callback:path=>{
        input.value=path;
        input.dispatchEvent(new Event("input",{bubbles:true}));
      }
    }).render({force:true});
  });
}

export class BoardEditor extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes:["db-app","db-editor-app"],
    window:{title:"Detective Board",icon:"fa-solid fa-thumbtack",resizable:true},
    position:{width:1130,height:770}
  };
  constructor(boardId) {
    super({id:`db-editor-${boardId}`});
    this.boardId=boardId;
    this.scale=0.85;this.offset={x:235,y:110};
    this.tool="select";this.linkStart=null;this.showLinks=true;
    this.search="";this.drag=null;this.pendingUpdate=false;this.selectedCardId=null;
    activeEditors.add(this);
  }
  get board() { return DBStore.board(this.boardId); }
  get writable() { return DBStore.canEdit(this.board); }
  async _renderHTML() {
    const root=document.createElement("div");root.className="db-editor";
    const board=this.board;
    if(!board) {root.innerHTML='<div class="db-empty">Доска недоступна или удалена.</div>';return root;}
    const theme=board.getFlag(MOD,"board")?.theme||"classic";
    root.innerHTML=`<div class="db-editor-head"><div class="db-heading">
      <button data-action="back" title="Все расследования"><i class="fa-solid fa-chevron-left"></i></button>
      <i class="fa-solid fa-thumbtack db-heading-pin"></i><strong>${escapeHTML(board.name)}</strong>
      <span class="db-role">${this.writable?"Редактирование":"Только просмотр"}</span></div>
      <div class="db-header-actions"><button data-action="export" title="Экспорт JSON"><i class="fa-solid fa-file-export"></i></button>
      <button data-action="history" title="История"><i class="fa-solid fa-clock-rotate-left"></i></button>
      <button data-action="trash" title="Корзина"><i class="fa-solid fa-trash-arrow-up"></i></button>
      <button data-action="settings" title="Настройки доски"><i class="fa-solid fa-gear"></i></button></div></div>
      <div class="db-editor-main"><nav class="db-toolbox">
      <button data-tool="select" class="${this.tool==="select"?"active":""}" title="Выделение и перемещение"><i class="fa-solid fa-arrow-pointer"></i></button>
      <button data-tool="pan" class="${this.tool==="pan"?"active":""}" title="Двигать полотно"><i class="fa-solid fa-hand"></i></button>
      <span class="db-tool-separator"></span>
      <button data-action="add" title="Новая карточка" ${this.writable?"":"disabled"}><i class="fa-solid fa-note-sticky"></i></button>
      <button data-tool="link" class="${this.tool==="link"?"active":""}" title="Соединить две карточки" ${this.writable?"":"disabled"}><i class="fa-solid fa-link"></i></button>
      <button data-action="toggle-links" class="${this.showLinks?"active":""}" title="Показать или скрыть связи"><i class="fa-solid fa-diagram-project"></i></button>
      <span class="db-tool-separator"></span>
      <button data-action="fit" title="Показать все"><i class="fa-solid fa-expand"></i></button>
      <button data-action="zoom-in" title="Приблизить"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
      <button data-action="zoom-out" title="Отдалить"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
      </nav>
      <div class="db-viewport ${theme==="dark"?"db-cork-dark":"db-cork-classic"}" tabindex="0" aria-label="Полотно детективной доски">
        <div class="db-world"><svg class="db-link-layer" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10000 10000" preserveAspectRatio="xMinYMin meet"></svg><div class="db-card-layer"></div></div>
        <div class="db-canvas-tip">${this.writable?"Перетащите Actor, Item, Journal или Scene сюда · Нажмите «нить» для соединения карточек":"Только просмотр · Масштабирование колесом мыши"}</div>
      </div>
      <aside class="db-inspector"><div class="db-inspector-title"><i class="fa-solid fa-magnifying-glass"></i> Поиск улик</div>
      <input type="search" data-role="card-search" placeholder="Название или тег" value="${escapeHTML(this.search)}" />
      <div class="db-inspector-content"><p><b>Карточки</b>: <span data-value="cards">0</span></p>
      <p><b>Связи</b>: <span data-value="links">0</span></p>
      <hr/><p class="db-tip">Дважды нажмите карточку для заметок и описания.</p>
      <p class="db-tip">Выберите карточку и нажмите Delete, чтобы отправить её в корзину.</p>
      <p class="db-tip">Колесо мыши - масштаб. Средняя кнопка - перемещение доски.</p>
      <p class="db-tip">Связи подписываются. Нажмите на подпись, чтобы изменить или удалить нить.</p>
      </div></aside></div>
      <div class="db-editor-footer"><div class="db-save-state" data-role="save"><i class="fa-solid fa-circle-check"></i> Сохранено</div>
      <span data-role="link-status"></span><span class="db-zoom-value" data-role="zoom">85%</span></div>`;
    return root;
  }
  _replaceHTML(result, content) {
    content.replaceChildren(result);
    showWindowCloseX(this);
    result.addEventListener("keydown",event=>this.onKeyDown(event));
    result.addEventListener("click",e=>this.onClick(e));
    result.addEventListener("dblclick",e=>this.onDoubleClick(e));
    result.addEventListener("pointerdown",e=>this.onPointerDown(e));
    result.addEventListener("pointermove",e=>this.onPointerMove(e));
    result.addEventListener("pointerup",e=>this.onPointerUp(e));
    result.addEventListener("pointercancel",e=>this.onPointerUp(e));
    result.querySelector(".db-viewport")?.addEventListener("wheel",e=>this.onWheel(e),{passive:false});
    result.querySelector(".db-viewport")?.addEventListener("dragover",e=>e.preventDefault());
    result.querySelector(".db-viewport")?.addEventListener("drop",e=>this.onDrop(e));
    result.querySelector('[data-role="card-search"]')?.addEventListener("input",e=>{this.search=e.target.value;this.renderCanvas();});
    this.renderCanvas();
  }
  updateFromFoundry() {
    if(!this.rendered) return;
    if(this.drag) this.pendingUpdate=true;
    else this.renderCanvas();
  }
  renderCanvas() {
    const root=this.element?.querySelector(".db-editor");const board=this.board;
    if(!root||!board) return;
    const cards=DBStore.cards(board).filter(p=>{
      const d=DBStore.entry(p),q=this.search.toLocaleLowerCase().trim();
      return !q||`${p.name} ${d.description||""} ${(d.tags||[]).join(" ")}`.toLocaleLowerCase().includes(q);
    });
    const visible=new Set(cards.map(c=>c.id));
    const links=DBStore.links(board).filter(p=>visible.has(DBStore.entry(p).from)&&visible.has(DBStore.entry(p).to));
    if(this.selectedCardId && !visible.has(this.selectedCardId)) this.selectedCardId=null;
    root.querySelector(".db-card-layer").innerHTML=cards.map(p=>this.cardHTML(p)).join("");
    root.querySelector(".db-link-layer").innerHTML=this.showLinks?links.map(p=>this.linkHTML(p)).join(""):"";
    root.querySelector('[data-value="cards"]').textContent=DBStore.cards(board).length;
    root.querySelector('[data-value="links"]').textContent=DBStore.links(board).length;
    this.applyViewport();
  }
  cardHTML(page) {
    const d=DBStore.entry(page),src=safeImage(d.image),type=possibleTypes.includes(d.type)?d.type:"note";
    const tags=(d.tags||[]).slice(0,3).map(v=>`<span class="db-tag">${escapeHTML(v)}</span>`).join("");
    return `<article class="db-card db-card-${type}${this.selectedCardId===page.id?" db-selected":""}" data-card="${page.id}" style="left:${numberAttr(d.x)}px;top:${numberAttr(d.y)}px;width:${clamp(d.width,160,620)}px;height:${clamp(d.height,130,740)}px;transform:rotate(${clamp(d.rotation,-30,30)}deg)">
      <span class="db-pin"></span><div class="db-card-head" title="Перетащить"><i class="fa-solid fa-${type==="actor"?"user-secret":type==="item"?"box":type==="image"?"image":type==="journal"?"book":type==="scene"?"map":type==="hypothesis"?"lightbulb":"note-sticky"}"></i>
       <strong>${escapeHTML(page.name)}</strong>${d.sourceUuid?`<button type="button" class="db-source-button" data-action="source" data-id="${page.id}" title="Открыть источник"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>`:""}</div>
      ${src?`<div class="db-card-image"><img src="${src}" alt="" loading="lazy" draggable="false"></div>`:""}
      <div class="db-card-description">${escapeHTML(d.description||"")}</div>
      <div class="db-card-bottom">${tags}<span class="db-card-noteicon" title="Заметки"><i class="fa-solid fa-comment"></i></span></div>
      ${this.writable?'<span class="db-resize-handle" title="Изменить размер карточки" aria-label="Изменить размер"></span>':""}
      </article>`;
  }
  linkHTML(page) {
    const d=DBStore.entry(page),board=this.board;
    const from=board.pages.get(d.from),to=board.pages.get(d.to);
    if(!from||!to) return "";
    const a=DBStore.entry(from),b=DBStore.entry(to);
    const ax=numberAttr(a.x)+clamp(a.width,160,620)/2, ay=numberAttr(a.y)+clamp(a.height,130,740)/2;
    const bx=numberAttr(b.x)+clamp(b.width,160,620)/2, by=numberAttr(b.y)+clamp(b.height,130,740)/2;
    const dx=bx-ax,dy=by-ay;
    const sag=Math.min(28,Math.hypot(dx,dy)*.08);
    const cx=(ax+bx)/2,cy=(ay+by)/2+sag;
    const color=validColor(d.color);
    return `<g class="db-wire" data-link="${page.id}"><path d="M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}" stroke="${color}" stroke-width="3" fill="none" class="db-wire-path"></path>
       <path d="M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}" stroke="transparent" stroke-width="20" fill="none" class="db-wire-hit"></path>
       <text x="${cx}" y="${cy-9}" text-anchor="middle" class="db-wire-label">${escapeHTML(d.label||page.name||"Связано")}</text>
       <circle cx="${ax}" cy="${ay}" r="6" fill="${color}" class="db-wire-pin"></circle><circle cx="${bx}" cy="${by}" r="6" fill="${color}" class="db-wire-pin"></circle></g>`;
  }
  applyViewport() {
    const root=this.element?.querySelector(".db-editor");if(!root)return;
    const world=root.querySelector(".db-world");
    if(world) world.style.transform=`translate(${this.offset.x}px,${this.offset.y}px) scale(${this.scale})`;
    const el=root.querySelector('[data-role="zoom"]');if(el)el.textContent=`${Math.round(this.scale*100)}%`;
  }
  getCoords(event) {
    const viewport=this.element.querySelector(".db-viewport"),rect=viewport.getBoundingClientRect();
    return {x:(event.clientX-rect.left-this.offset.x)/this.scale,y:(event.clientY-rect.top-this.offset.y)/this.scale};
  }
  setSaving(state) {
    const el=this.element?.querySelector('[data-role="save"]');
    if(el) el.innerHTML=state==="saving"?'<i class="fa-solid fa-rotate fa-spin"></i> Сохранение...':
      state==="error"?'<i class="fa-solid fa-triangle-exclamation"></i> Ошибка сохранения':
      '<i class="fa-solid fa-circle-check"></i> Сохранено';
  }
  async onClick(event) {
    const root=this.element;
    const tool=event.target.closest("[data-tool]");
    if(tool) {
      if(tool.disabled) return;
      this.tool=tool.dataset.tool;
      this.linkStart=null;
      root.querySelectorAll("[data-tool]").forEach(b=>b.classList.toggle("active",b.dataset.tool===this.tool));
      this.linkStatus();return;
    }
    const btn=event.target.closest("[data-action]");
    if(btn) {
      try {
        switch(btn.dataset.action) {
          case "back": {const {openManager}=await import("./manager.js");openManager();this.close();break;}
          case "source":await this.openSource(btn.dataset.id);break;
          case "add":await this.addCard();break;
          case "toggle-links":this.showLinks=!this.showLinks;btn.classList.toggle("active",this.showLinks);this.renderCanvas();break;
          case "zoom-in":this.setZoom(this.scale*1.22);break;
          case "zoom-out":this.setZoom(this.scale/1.22);break;
          case "fit":this.fit();break;
          case "export":this.exportBoard();break;
          case "history":await this.historyDialog();break;
          case "trash":await this.trashDialog();break;
          case "settings":await this.settingsDialog();break;
        }
      } catch(error) {notifyError(error);}
      return;
    }
    const link=event.target.closest("[data-link]");
    if(link) {try{await this.editLink(link.dataset.link);}catch(error){notifyError(error);}return;}
    const card=event.target.closest("[data-card]");
    if(card && this.tool==="select") {
      this.selectedCardId=card.dataset.card;
      root.querySelectorAll(".db-card").forEach(c=>c.classList.toggle("db-selected",c.dataset.card===this.selectedCardId));
      root.querySelector(".db-viewport")?.focus({preventScroll:true});
      return;
    }
    if(!card && this.tool==="select" && event.target.closest(".db-viewport")) {
      this.selectedCardId=null;
      root.querySelectorAll(".db-card").forEach(c=>c.classList.remove("db-selected"));
    }
    if(card && this.tool==="link" && this.writable) {
      const cardId=card.dataset.card;
      if(!this.linkStart) this.linkStart=cardId;
      else if(this.linkStart!==cardId) {
        const start=this.linkStart;this.linkStart=null;
        try {await this.connect(start,cardId);}catch(error){notifyError(error);}
      } else this.linkStart=null;
      this.linkStatus();
    }
  }
  async onKeyDown(event) {
    if(!["Delete","Backspace"].includes(event.key) || !this.selectedCardId || !this.writable) return;
    if(event.target.closest("input,textarea,select,button,[contenteditable='true']")) return;
    event.preventDefault();
    event.stopPropagation();
    if(this.drag) return;
    const page=this.board?.pages.get(this.selectedCardId);
    if(!page || DBStore.entry(page)?.kind!=="card") return;
    this.selectedCardId=null;
    this.setSaving("saving");
    try {
      await DBStore.archiveCard(page);
      this.setSaving("saved");
      this.renderCanvas();
    } catch(error) {
      this.selectedCardId=page.id;
      this.setSaving("error");
      notifyError(error);
    }
  }
  linkStatus() {
    const el=this.element.querySelector('[data-role="link-status"]');
    if(el) el.textContent=this.linkStart?"Выберите вторую карточку...":this.tool==="link"?"Режим нитей: выберите две карточки":"";
  }
  async onDoubleClick(event) {
    const card=event.target.closest("[data-card]");
    if(card) {
      event.preventDefault();
      try {await this.editCard(card.dataset.card);} catch(error) {notifyError(error);}
    }
  }
  onPointerDown(event) {
    const viewport=event.target.closest(".db-viewport");if(!viewport) return;
    const card=event.target.closest(".db-card");
    const isPan=event.button===1||this.tool==="pan";
    if(card && event.button===0 && this.tool==="select" && this.writable && event.target.closest(".db-resize-handle")) {
      const page=this.board?.pages.get(card.dataset.card),d=DBStore.entry(page);
      if(!page||!d)return;
      event.preventDefault();event.stopPropagation();
      this.selectedCardId=page.id;
      viewport.focus({preventScroll:true});
      this.element.querySelectorAll(".db-card").forEach(c=>c.classList.toggle("db-selected",c.dataset.card===page.id));
      this.drag={
        type:"resize",id:page.id,pointerId:event.pointerId,
        clientX:event.clientX,clientY:event.clientY,
        width:d.width,height:d.height,rotation:d.rotation||0,changed:false,target:card
      };
      card.setPointerCapture(event.pointerId);
      card.classList.add("db-resizing");
      return;
    }
    if(isPan || (!card && !event.target.closest(".db-wire") && event.button===0)) {
      event.preventDefault();this.drag={type:"pan",pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY,origin:{...this.offset}};
      viewport.setPointerCapture(event.pointerId);return;
    }
    if(this.tool!=="select"||event.button!==0||!this.writable||!card||!event.target.closest(".db-card-head")||event.target.closest("button")) return;
    const page=this.board.pages.get(card.dataset.card),d=DBStore.entry(page);
    if(!page||!d) return;
    event.preventDefault();
    this.selectedCardId=page.id;
    viewport.focus({preventScroll:true});
    this.element.querySelectorAll(".db-card").forEach(c=>c.classList.toggle("db-selected",c.dataset.card===page.id));
    this.drag={type:"card",id:page.id,pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY,x:d.x,y:d.y,changed:false,target:card};
    card.setPointerCapture(event.pointerId);
    card.classList.add("db-dragging");
  }
  onPointerMove(event) {
    if(!this.drag||event.pointerId!==this.drag.pointerId)return;
    if(this.drag.type==="pan") {
      this.offset.x=this.drag.origin.x+event.clientX-this.drag.clientX;
      this.offset.y=this.drag.origin.y+event.clientY-this.drag.clientY;
      this.applyViewport();return;
    }
    if(this.drag.type==="resize") {
      const size=cardResizeDimensions(this.drag.width,this.drag.height,
        (event.clientX-this.drag.clientX)/this.scale,
        (event.clientY-this.drag.clientY)/this.scale,this.drag.rotation);
      const card=this.element.querySelector(`[data-card="${this.drag.id}"]`);
      if(card){card.style.width=`${size.width}px`;card.style.height=`${size.height}px`;}
      this.drag.last=size;
      this.drag.changed=size.width!==this.drag.width||size.height!==this.drag.height;
      const page=this.board.pages.get(this.drag.id),original=DBStore.entry(page);
      if(original)this.drawPreviewLinks(this.drag.id,{...original,...size});
      return;
    }
    const x=this.drag.x+(event.clientX-this.drag.clientX)/this.scale;
    const y=this.drag.y+(event.clientY-this.drag.clientY)/this.scale;
    const card=this.element.querySelector(`[data-card="${this.drag.id}"]`);
    if(card) {card.style.left=`${x}px`;card.style.top=`${y}px`;}
    this.drag.last={x,y};this.drag.changed=true;
    // Only the visual SVG wires need updating during the drag.
    const saved=this.board.pages.get(this.drag.id),entry=DBStore.entry(saved);
    if(saved&&entry){this.drag.original=entry;this.drag.preview={...entry,x,y};this.drawPreviewLinks(this.drag.id,this.drag.preview);}
  }
  drawPreviewLinks(cardId,data) {
    const root=this.element?.querySelector(".db-editor");if(!root||!this.showLinks)return;
    const cards=DBStore.cards(this.board);
    const map=new Map(cards.map(c=>[c.id,{...DBStore.entry(c)}]));map.set(cardId,data);
    const links=DBStore.links(this.board).filter(p=>{
      const d=DBStore.entry(p);return d.from===cardId||d.to===cardId;
    });
    for(const page of links) {
      const d=DBStore.entry(page),a=map.get(d.from),b=map.get(d.to);
      if(!a||!b)continue;
      const ax=a.x+a.width/2,ay=a.y+a.height/2,bx=b.x+b.width/2,by=b.y+b.height/2;
      const cx=(ax+bx)/2,cy=(ay+by)/2+Math.min(28,Math.hypot(bx-ax,by-ay)*.08);
      const line=root.querySelector(`.db-wire[data-link="${page.id}"]`);
      line?.querySelectorAll("path").forEach(path=>path.setAttribute("d",`M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`));
      const text=line?.querySelector("text");if(text){text.setAttribute("x",cx);text.setAttribute("y",cy-9);}
      const circles=line?.querySelectorAll("circle");
      if(circles?.length===2) {circles[0].setAttribute("cx",ax);circles[0].setAttribute("cy",ay);circles[1].setAttribute("cx",bx);circles[1].setAttribute("cy",by);}
    }
  }
  async onPointerUp(event) {
    const drag=this.drag;if(!drag||event.pointerId!==drag.pointerId)return;
    this.drag=null;
    const viewport=this.element?.querySelector(".db-viewport");
    const captured=drag.target??viewport;
    if(captured?.hasPointerCapture(event.pointerId))captured.releasePointerCapture(event.pointerId);
    if((drag.type==="card"||drag.type==="resize") && drag.changed && drag.last) {
      const page=this.board?.pages.get(drag.id);
      if(page) {
        this.setSaving("saving");
        try {
          const patch=drag.type==="resize"
            ? {width:drag.last.width,height:drag.last.height}
            : {x:Math.round(drag.last.x),y:Math.round(drag.last.y)};
          await DBStore.updateCard(page,patch);
          DBStore.activity(this.board,drag.type==="resize"?"resize":"move",page.name);
          this.setSaving("saved");
        }
        catch(error){this.setSaving("error");notifyError(error);}
      }
    }
    if(this.pendingUpdate||drag.changed){this.pendingUpdate=false;this.renderCanvas();}
  }
  onWheel(event) {
    event.preventDefault();
    const rect=this.element.querySelector(".db-viewport").getBoundingClientRect();
    this.setZoom(this.scale*(event.deltaY>0?.9:1.1),{x:event.clientX-rect.left,y:event.clientY-rect.top});
  }
  setZoom(next,at=null) {
    const viewport=this.element?.querySelector(".db-viewport");if(!viewport)return;
    at??={x:viewport.clientWidth/2,y:viewport.clientHeight/2};
    const old=this.scale;this.scale=clamp(next,.25,2.5);
    this.offset.x=at.x-(at.x-this.offset.x)*(this.scale/old);
    this.offset.y=at.y-(at.y-this.offset.y)*(this.scale/old);
    this.applyViewport();
  }
  fit() {
    const cards=DBStore.cards(this.board).map(x=>DBStore.entry(x));
    if(!cards.length){this.scale=.85;this.offset={x:235,y:110};this.applyViewport();return;}
    const minX=Math.min(...cards.map(x=>x.x)),minY=Math.min(...cards.map(x=>x.y));
    const maxX=Math.max(...cards.map(x=>x.x+x.width)),maxY=Math.max(...cards.map(x=>x.y+x.height));
    const port=this.element.querySelector(".db-viewport");
    this.scale=clamp(Math.min((port.clientWidth-90)/(maxX-minX),(port.clientHeight-90)/(maxY-minY)),.25,1.2);
    this.offset={x:(port.clientWidth-(maxX-minX)*this.scale)/2-minX*this.scale,
      y:(port.clientHeight-(maxY-minY)*this.scale)/2-minY*this.scale};
    this.applyViewport();
  }
  async onDrop(event) {
    event.preventDefault();if(!this.writable)return;
    try {
      const data=TextEditor.getDragEventData(event);
      const uuid=draggedDocumentUUID(data);
      if(!uuid) return;
      const doc=await fromUuid(uuid);
      if(!doc||!doc.testUserPermission(game.user,"OBSERVER"))return ui.notifications.warn("Нет доступа к исходному документу.");
      const board=this.board;
      // Do not expose a source UUID which some board viewers cannot read.
      const visibleUsers=game.users.contents.filter(u=>!u.isGM&&board.testUserPermission(u,"OBSERVER"));
      const allCanRead=visibleUsers.every(u=>doc.testUserPermission(u,"OBSERVER"));
      const img=doc.thumb||doc.img||doc.background?.src||doc.src||"";
      const pos=this.getCoords(event);
      this.setSaving("saving");
      await DBStore.createCard(board,{title:doc.name,type:data.type.startsWith("Journal")?"journal":data.type.toLowerCase(),
        image:allCanRead?img:"",sourceUuid:allCanRead?doc.uuid:null,
        description:allCanRead?"":"Публичное описание заполните вручную.",x:pos.x,y:pos.y});
      this.setSaving("saved");this.renderCanvas();
      if(!allCanRead) ui.notifications.info("У части игроков нет доступа к источнику. Создана публичная карточка без секретной ссылки и изображения.");
    }catch(error){this.setSaving("error");notifyError(error);}
  }
  async addCard() {
    if(!this.writable)return;
    const result=await ask({window:{title:"Новая улика"},content:`<div class="db-dialog">
      <label>Тип<select name="type">${possibleTypes.map(k=>`<option value="${k}">${kindLabels[k]}</option>`).join("")}</select></label>
      <label>Название<input name="title" maxlength="100" value="Новая улика" required></label>
      <label>Описание<textarea name="description" rows="4"></textarea></label>
      ${imageFieldHTML("")}
      <label>Теги (через запятую)<input name="tags" placeholder="подозреваемый, свидетель"></label>
      </div>`,render:bindImagePicker,ok:{label:"Добавить",callback:(_e,b)=>({type:b.form.elements.type.value,title:b.form.elements.title.value,
        description:b.form.elements.description.value,image:b.form.elements.image.value,
        tags:b.form.elements.tags.value.split(",").map(x=>x.trim()).filter(Boolean)})}});
    if(!result)return;
    const p=this.element.querySelector(".db-viewport");
    this.setSaving("saving");
    await DBStore.createCard(this.board,{...result,x:(p.clientWidth/2-this.offset.x)/this.scale-120,y:(p.clientHeight/2-this.offset.y)/this.scale-90});
    this.setSaving("saved");this.renderCanvas();
  }
  async editCard(cardId) {
    const board=this.board,page=board?.pages.get(cardId),entry=DBStore.entry(page);
    if(!entry||entry.kind!=="card")return;
    const editable=this.writable;
    const privateNote=DBStore.getPersonalNote(board,cardId);
    const personalText=DBStore.entry(privateNote)?.text||"";
    const otherNotes=game.user.isGM?game.journal.contents.filter(j=>j.getFlag(MOD,"personal")?.boardId===board.id && j.getFlag(MOD,"personal")?.ownerId!==game.user.id)
      .map(j=>{const p=j.pages.contents.find(p=>DBStore.entry(p)?.kind==="private-note"&&DBStore.entry(p)?.cardId===cardId);
        return p?`<div class="db-other-note"><strong>${escapeHTML(game.users.get(j.getFlag(MOD,"personal")?.ownerId)?.name||"Игрок")}</strong><p>${escapeHTML(DBStore.entry(p).text)}</p></div>`:"";}).join(""):"";
    const disable=editable?"":"disabled";
    const result=await ask({window:{title:`Карточка: ${page.name}`},content:`<div class="db-dialog">
      <label>Название<input name="title" value="${escapeHTML(page.name)}" maxlength="100" ${disable}></label>
      <label>Тип<select name="type" ${disable}>${possibleTypes.map(k=>`<option value="${k}" ${entry.type===k?"selected":""}>${kindLabels[k]}</option>`).join("")}</select></label>
      <label>Краткое описание<textarea name="description" rows="4" ${disable}>${escapeHTML(entry.description||"")}</textarea></label>
      ${imageFieldHTML(entry.image||"",editable)}
      <label>Общие заметки<textarea name="notes" rows="4" ${disable}>${escapeHTML(entry.notes||"")}</textarea></label>
      <label>Теги через запятую<input name="tags" value="${escapeHTML((entry.tags||[]).join(", "))}" ${disable}></label>
      <label>Мои личные заметки<textarea name="personal" rows="3" ${DBStore.canCreate()||DBStore.getPersonalDoc(board)?"":"disabled"}>${escapeHTML(personalText)}</textarea></label>
      ${editable?'<label class="db-archive-option"><input name="archive" type="checkbox"> Переместить карточку в корзину</label>':""}
      ${otherNotes?`<details><summary>Личные заметки других участников (GM)</summary>${otherNotes}</details>`:""}
      ${entry.sourceUuid?`<div class="db-source">Источник: <code>${escapeHTML(entry.sourceUuid)}</code></div>`:""}
      ${!editable?"<p class=\"db-info\">Доска доступна только для просмотра. Можно менять только личные заметки.</p>":""}
      </div>`,render:bindImagePicker,ok:{label:"Сохранить",callback:(_e,b)=>({title:b.form.elements.title.value,type:b.form.elements.type.value,
        description:b.form.elements.description.value,notes:b.form.elements.notes.value,
        image:b.form.elements.image.value,tags:b.form.elements.tags.value.split(",").map(v=>v.trim()).filter(Boolean),
        personal:b.form.elements.personal.value,archive:editable?!!b.form.elements.archive.checked:false})}});
    if(!result)return;
    this.setSaving("saving");
    try {
      if(editable) {
        // In v0.1 editing the same text from two clients uses last write wins.
        await DBStore.updateCard(page,{title:result.title,type:result.type,description:result.description,
          image:result.image,notes:result.notes,tags:result.tags});
        DBStore.activity(board,"edit",page.name);
        if(result.archive) await DBStore.archiveCard(page);
      }
      if(result.personal!==personalText) await DBStore.savePersonalNote(board,cardId,result.personal);
      this.setSaving("saved");this.renderCanvas();
    }catch(error){this.setSaving("error");throw error;}
  }
  async openSource(cardId) {
    const page=this.board?.pages.get(cardId), uuid=DBStore.entry(page)?.sourceUuid;
    if(!uuid) return;
    const doc=await fromUuid(uuid);
    if(!doc || !doc.testUserPermission(game.user,"OBSERVER")) {
      return ui.notifications.warn("Оригинал удалён или закрыт для вас.");
    }
    await doc.sheet?.render({force:true});
  }
  async connect(from,to) {
    if(!this.writable)return;
    const result=await ask({window:{title:"Новая нить"},content:`<div class="db-dialog">
      <label>Описание связи<input name="label" value="Связано" maxlength="100"></label>
      <label>Цвет<select name="color"><option value="#ad392f">Красный - подозрение</option><option value="#427d57">Зелёный - подтверждено</option><option value="#b38c34">Жёлтый - вопрос</option><option value="#5a6577">Серый - нейтрально</option></select></label>
      </div>`,ok:{label:"Соединить",callback:(_e,b)=>({label:b.form.elements.label.value,color:b.form.elements.color.value})}});
    if(!result)return;
    this.setSaving("saving");await DBStore.createLink(this.board,from,to,result.label,result.color);
    this.setSaving("saved");this.renderCanvas();
  }
  async editLink(linkId) {
    const board=this.board,page=board?.pages.get(linkId),e=DBStore.entry(page);
    if(!e||e.kind!=="link")return;
    if(!this.writable)return ui.notifications.info(e.label);
    const result=await ask({window:{title:"Настройки нити"},content:`<div class="db-dialog"><label>Подпись<input name="label" maxlength="100" value="${escapeHTML(e.label||"")}"></label>
      <label>Цвет<input name="color" type="color" value="${validColor(e.color)}"></label>
      <label class="db-link-remove"><input type="checkbox" name="remove"> Удалить эту нить</label></div>`,
      ok:{label:"Сохранить",callback:(_ev,b)=>({label:b.form.elements.label.value,color:b.form.elements.color.value,
        remove:b.form.elements.remove.checked})}});
    if(!result)return;
    if(result.remove) {
      if(await confirm("Удалить эту связь?", "Удаление нити")) {
        await DBStore.deleteLink(page);this.renderCanvas();
      }
      return;
    }
    await page.update({name:result.label,[`flags.${MOD}.entry`]:{...e,label:result.label,color:validColor(result.color),revision:(e.revision||0)+1}});
    DBStore.activity(board,"edit-link",result.label);
    this.renderCanvas();
  }
  exportBoard() {
    const board=this.board;if(!board)return;
    const payload=DBStore.exportData(board);
    const safeName=board.name.replace(/[^\p{L}\p{N}_-]/gu,"_").slice(0,50);
    downloadText(`${safeName||"detective-board"}.json`,JSON.stringify(payload,null,2));
    ui.notifications.info("JSON экспортирован без личных заметок и секретных документов.");
  }
  async historyDialog() {
    const list=(this.board?.getFlag(MOD,"history")||[]).slice().reverse().slice(0,100);
    await ask({window:{title:"История действий"},content:`<div class="db-history">${list.length?list.map(e=>`<div><strong>${escapeHTML(game.users.get(e.userId)?.name||"Участник")}</strong> · ${escapeHTML(e.action)}: ${escapeHTML(e.detail)} <small>${new Date(e.at).toLocaleString()}</small></div>`).join(""):"История пуста"}</div>`,ok:{label:"Закрыть"}});
  }
  async trashDialog() {
    const pages=DBStore.cards(this.board,true);
    if(!pages.length)return ui.notifications.info("Корзина пуста.");
    if(!this.writable)return ui.notifications.warn("У вас только просмотр.");
    const result=await ask({window:{title:"Корзина доски"},content:`<div class="db-dialog"><label>Выберите карточку для восстановления<select name="pageId">${pages.map(p=>`<option value="${p.id}">${escapeHTML(p.name)}</option>`).join("")}</select></label></div>`,ok:{label:"Восстановить",callback:(_e,b)=>b.form.elements.pageId.value}});
    if(!result)return;
    const page=this.board.pages.get(result);if(!page)return;
    await DBStore.restoreCard(page);this.renderCanvas();
  }
  async settingsDialog() {
    if(!this.writable)return ui.notifications.info("У вас только просмотр.");
    const board=this.board,meta=board.getFlag(MOD,"board");
    const result=await ask({window:{title:"Настройки доски"},content:`<div class="db-dialog">
      <label>Название<input name="title" value="${escapeHTML(board.name)}" maxlength="100"></label>
      <label>Оформление<select name="theme"><option value="classic" ${meta.theme!=="dark"?"selected":""}>Классическая доска</option><option value="dark" ${meta.theme==="dark"?"selected":""}>Тёмная доска</option></select></label></div>`,ok:{label:"Сохранить",callback:(_e,b)=>({title:b.form.elements.title.value,theme:b.form.elements.theme.value})}});
    if(!result)return;
    await board.update({name:result.title,[`flags.${MOD}.board`]:{...meta,theme:result.theme}});
    await this.render({force:true});
  }
  async _preClose(options) {
    activeEditors.delete(this);
    return super._preClose(options);
  }
}
