import {MOD, VERSION, OWNER, OBSERVER, pageData, cardPosition, clamp} from "./utils.js";

const latestActivity = new Map();
const MAX_HISTORY = 100;
const SNAPSHOT_MS = 15 * 60 * 1000;
const MAX_SNAPSHOTS = 12;
const docFlag = d => d?.getFlag(MOD, "entry") ?? null;

export const DBStore = {
  listBoards() {
    return game.journal.contents.filter(j => j.getFlag(MOD, "board")?.kind === "board"
      && j.testUserPermission(game.user, "OBSERVER")).sort((a, b) => a.name.localeCompare(b.name));
  },
  board(id) {
    const doc = game.journal.get(id);
    return doc?.getFlag(MOD, "board")?.kind === "board" && doc.testUserPermission(game.user, "OBSERVER") ? doc : null;
  },
  canEdit(board) { return !!board?.testUserPermission(game.user, "OWNER"); },
  canCreate() { return foundry.documents.JournalEntry.canUserCreate(game.user); },
  entries(board, kind, archived = false) {
    return board.pages.contents.filter(p => {
      const data = docFlag(p);
      return data?.kind === kind && (archived === null || !!data.archived === archived);
    });
  },
  cards(board, archived = false) { return this.entries(board, "card", archived); },
  links(board) { return this.entries(board, "link").filter(p => {
    const e = docFlag(p);
    const visibleIds = new Set(this.cards(board).map(c => c.id));
    return visibleIds.has(e.from) && visibleIds.has(e.to);
  }); },
  entry(page) { return docFlag(page); },
  async createBoard({name, description = "", theme = "classic", template = "empty", access = "private", selected = {}}) {
    if (!this.canCreate()) throw new Error("У пользователя нет права создавать журналы. GM должен включить разрешение Create Journal Entries.");
    const defaultLevel = {private: 0, view: 2, shared: 3, custom: 0}[access] ?? 0;
    const ownership = { default: defaultLevel, [game.user.id]: OWNER };
    for (const [userId, value] of Object.entries(selected)) ownership[userId] = clamp(value, 0, 3);
    const doc = await foundry.documents.JournalEntry.create({
      name: name.trim().slice(0, 100), ownership,
      flags: { [MOD]: { board: {
        kind: "board", schemaVersion: VERSION, description: String(description).slice(0, 1500),
        theme, template, createdBy: game.user.id, createdAt: Date.now()
      }, history: [] } }
    });
    if (template !== "empty") await this.seedTemplate(doc, template);
    return doc;
  },
  async seedTemplate(board, template) {
    const headings = {
      case: [["Подозреваемые", 140, 130], ["Улики", 520, 130], ["Локации", 900, 130]],
      characters: [["Персонажи", 150, 130], ["Отношения", 540, 130], ["Вопросы", 930, 130]],
      timeline: [["Ранние события", 120, 130], ["Ключевые события", 490, 130], ["Последствия", 860, 130]]
    }[template] ?? [];
    if (headings.length) await board.createEmbeddedDocuments("JournalEntryPage", headings.map(([title,x,y]) =>
      pageData("card", title, {type:"note", description:"", notes:"", image:"", sourceUuid:null,
        x,y,width:240,height:170,rotation:0,tags:[],status:"unverified",archived:false,
        revision:1,createdBy:game.user.id,updatedAt:Date.now()})));
  },
  async createCard(board, input = {}) {
    if (!this.canEdit(board)) throw new Error("Недостаточно прав для изменения доски.");
    const p = cardPosition(this.cards(board).length);
    const data = {
      type: input.type || "note", description: String(input.description ?? "").slice(0, 10000),
      notes: String(input.notes ?? "").slice(0, 10000), image: String(input.image ?? "").slice(0, 2048),
      sourceUuid: input.sourceUuid || null,
      x: Number(input.x ?? p.x), y: Number(input.y ?? p.y), width: clamp(input.width ?? 230, 160, 620),
      height: clamp(input.height ?? 230, 130, 740), rotation: clamp(input.rotation ?? 0, -30, 30),
      tags: Array.isArray(input.tags) ? input.tags.slice(0, 12).map(x => String(x).slice(0,40)) : [],
      status: "unverified", archived: false, revision: 1,
      createdBy: game.user.id, updatedAt: Date.now()
    };
    const [page] = await board.createEmbeddedDocuments("JournalEntryPage", [pageData("card", input.title || "Новая улика", data)]);
    this.activity(board, "add", page.name);
    return page;
  },
  async updateCard(page, patch = {}) {
    const board = page.parent;
    if (!this.canEdit(board)) throw new Error("Недостаточно прав.");
    const old = docFlag(page);
    if (!old || old.kind !== "card") throw new Error("Карточка не найдена.");
    const {title, ...fields} = patch;
    const entry = {...old, ...fields, revision: (old.revision || 0) + 1, updatedAt: Date.now()};
    await page.update({ ...(title !== undefined ? {name: String(title).slice(0,100)} : {}), [`flags.${MOD}.entry`]: entry });
    return page;
  },
  async createLink(board, from, to, label = "Связано", color = "#ad392f") {
    if (!this.canEdit(board)) throw new Error("Нет прав на редактирование.");
    if (from === to) throw new Error("Нельзя соединить карточку саму с собой.");
    if (!board.pages.get(from) || !board.pages.get(to)) throw new Error("Не удалось найти карточку.");
    const [page] = await board.createEmbeddedDocuments("JournalEntryPage", [pageData("link", label, {
      from, to, label: String(label).slice(0, 100), color, createdBy: game.user.id,
      createdAt: Date.now(), archived:false, revision:1
    })]);
    this.activity(board, "connect", label);
    return page;
  },
  async deleteLink(page) {
    if (!this.canEdit(page.parent)) throw new Error("Нет прав.");
    await page.update({[`flags.${MOD}.entry.archived`]:true});
    this.activity(page.parent, "disconnect", page.name);
  },
  async archiveCard(page) {
    await this.updateCard(page, {archived:true});
    this.activity(page.parent, "archive", page.name);
  },
  async restoreCard(page) {
    await this.updateCard(page, {archived:false});
    this.activity(page.parent, "restore", page.name);
  },
  activity(board, action, detail) {
    // Deliberately best-effort. This client-side journal is not an atomic audit log.
    const previous = latestActivity.get(board.id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (!this.canEdit(board)) return;
      const history = Array.isArray(board.getFlag(MOD,"history")) ? [...board.getFlag(MOD,"history")] : [];
      history.push({at:Date.now(),userId:game.user.id,action,detail:String(detail).slice(0,120)});
      await board.setFlag(MOD,"history", history.slice(-MAX_HISTORY));
      await this.maybeSnapshot(board);
    }).catch(error => console.warn(`${MOD} | Activity log unavailable`, error));
    latestActivity.set(board.id, next);
  },
  async maybeSnapshot(board) {
    const existing = this.entries(board,"snapshot",null).sort((a,b) => (docFlag(a).at??0)-(docFlag(b).at??0));
    const now = Date.now();
    if (existing.length && now - (docFlag(existing.at(-1)).at||0) < SNAPSHOT_MS) return;
    const state = this.exportData(board, {includeHistory:false});
    await board.createEmbeddedDocuments("JournalEntryPage", [pageData("snapshot", `Снимок ${new Date(now).toLocaleString()}`, {at:now, state})]);
    if (existing.length >= MAX_SNAPSHOTS) {
      await board.deleteEmbeddedDocuments("JournalEntryPage", existing.slice(0, existing.length - MAX_SNAPSHOTS + 1).map(x => x.id));
    }
  },
  exportData(board, {includeHistory = true} = {}) {
    // Export only the user's accessible board. Personal notes live in a different journal.
    return {
      format:"detective-board",schemaVersion:VERSION,name:board.name,
      metadata:board.getFlag(MOD,"board"),
      cards:this.cards(board).map(p=>({id:p.id,title:p.name,...docFlag(p)})),
      links:this.links(board).map(p=>({id:p.id,...docFlag(p)})),
      ...(includeHistory ? {history:board.getFlag(MOD,"history")??[]} : {})
    };
  },
  async importData(payload) {
    if (!payload || payload.format !== "detective-board" || payload.schemaVersion !== VERSION) {
      throw new Error("Неизвестный или несовместимый формат доски.");
    }
    const doc = await this.createBoard({name:`${String(payload.name||"Импорт").slice(0,80)} (импорт)`,access:"private"});
    const ids = new Map();
    for (const c of (Array.isArray(payload.cards) ? payload.cards.slice(0,1000) : [])) {
      const page = await this.createCard(doc, {
        type:["note","actor","item","journal","image","hypothesis"].includes(c.type)?c.type:"note",
        title:String(c.title||"Карточка").slice(0,100),description:String(c.description||""),
        notes:String(c.notes||""),image:String(c.image||""),
        // External UUIDs are intentionally not trusted when importing into another world.
        sourceUuid:null,x:clamp(c.x,-10000,10000),y:clamp(c.y,-10000,10000),
        width:c.width,height:c.height,rotation:c.rotation,tags:c.tags
      });
      if (c.id) ids.set(c.id,page.id);
    }
    for (const l of (Array.isArray(payload.links) ? payload.links.slice(0,3000) : [])) {
      const from=ids.get(l.from),to=ids.get(l.to);
      if (from && to && from!==to) await this.createLink(doc,from,to,String(l.label||"Связано"));
    }
    return doc;
  },
  getPersonalDoc(board, authorId = game.user.id) {
    return game.journal.contents.find(j => {
      const p=j.getFlag(MOD,"personal");
      return p?.boardId===board.id && p.ownerId===authorId && j.testUserPermission(game.user,"OBSERVER");
    })??null;
  },
  async personalDoc(board) {
    const existing=this.getPersonalDoc(board);
    if (existing) return existing;
    if (!this.canCreate()) throw new Error("Для личных заметок нужны права на создание журналов.");
    return await foundry.documents.JournalEntry.create({
      name:`Личные заметки: ${board.name} (${game.user.name})`,
      ownership:{default:0,[game.user.id]:OWNER},
      flags:{[MOD]:{personal:{boardId:board.id,ownerId:game.user.id,schemaVersion:VERSION}}}
    });
  },
  getPersonalNote(board,cardId, authorId=game.user.id) {
    const doc=this.getPersonalDoc(board,authorId);
    return doc?.pages.contents.find(p=>docFlag(p)?.kind==="private-note"&&docFlag(p)?.cardId===cardId)??null;
  },
  async savePersonalNote(board,cardId,text) {
    const doc=await this.personalDoc(board);
    const page=this.getPersonalNote(board,cardId);
    if (page) await page.update({[`flags.${MOD}.entry.text`]:String(text).slice(0,10000)});
    else await doc.createEmbeddedDocuments("JournalEntryPage", [pageData("private-note","Личная заметка",{cardId,text:String(text).slice(0,10000),authorId:game.user.id})]);
  }
};
