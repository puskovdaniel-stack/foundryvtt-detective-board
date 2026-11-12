import assert from 'node:assert/strict';
import {escapeHTML, safeImage, cardPosition, boardDialogPosition, draggedDocumentUUID, ask, showWindowCloseX} from '../src/utils.js';
let next=0;
const clone = x=>structuredClone(x);
function mergeDotted(target, patch) {
  for(const [key,val] of Object.entries(patch)) {
    const parts=key.split('.');let cur=target;
    for(const p of parts.slice(0,-1)) cur=cur[p]??={};
    cur[parts.at(-1)]=clone(val);
  }
}
class Page {
  constructor(data,parent) {this.id=`page${++next}`;this.parent=parent;this.name=data.name;this.flags=clone(data.flags||{});}
  getFlag(scope,key) {return this.flags[scope]?.[key];}
  async update(patch) {mergeDotted(this,patch);return this;}
}
class Folder {
  static canUserCreate() {return true;}
  static async create(d) {const f=new Folder(d);game.folders.contents.push(f);return f;}
  constructor(d) {this.id=`folder${++next}`;this.name=d.name;this.type=d.type;this.flags=clone(d.flags||{});}
  getFlag(scope,key) {return this.flags[scope]?.[key];}
}
class Journal {
  static canUserCreate() {return true;}
  static async create(data) {
    const j=new Journal(data);
    globalThis.game.journal.contents.push(j);
    return j;
  }
  constructor(data) {
    this.id=`journal${++next}`;this.name=data.name;this.ownership=clone(data.ownership||{});
    this.flags=clone(data.flags||{});this.folder=data.folder??null;this._pages=[];
    this.pages={contents:this._pages,get:id=>this._pages.find(p=>p.id===id)};
  }
  getFlag(scope,key) {return this.flags[scope]?.[key];}
  testUserPermission(user,level) {return user.isGM || (this.ownership[user.id]??this.ownership.default??0)>=({OWNER:3,OBSERVER:2}[level]||0);}
  async createEmbeddedDocuments(_type,pages) {const items=pages.map(x=>new Page(x,this));this._pages.push(...items);return items;}
  async deleteEmbeddedDocuments(_type,ids) {for(let i=this._pages.length-1;i>=0;i--)if(ids.includes(this._pages[i].id))this._pages.splice(i,1);return [];}
  async update(patch) {mergeDotted(this,patch);return this;}
  async setFlag(scope,key,value){(this.flags[scope]??={})[key]=clone(value);return this;}
}
globalThis.foundry={documents:{JournalEntry:Journal,Folder}};
globalThis.game={user:{id:'u1',name:'Player',isGM:false},journal:{contents:[],get(id){return this.contents.find(x=>x.id===id);}},folders:{contents:[]},users:{contents:[{id:'u1',name:'Player',isGM:false},{id:'u2',name:'Second',isGM:false} ],get(id){return this.contents.find(x=>x.id===id);}}};
assert.equal(escapeHTML('<a "test">'), '&lt;a &quot;test&quot;&gt;');
assert.equal(safeImage('javascript:alert(1)'), '');
assert.deepEqual(cardPosition(4), {x:170,y:390});
assert.equal(draggedDocumentUUID({type:"Scene",id:"abc"}),"Scene.abc");
assert.equal(draggedDocumentUUID({type:"Scene",uuid:"Scene.xy"}),"Scene.xy");
assert.equal(draggedDocumentUUID({type:"Macro",id:"abc"}),null);
// Regression: long evidence dialogs must use bounded dimensions and a scrollable class.
let observedDialog;
globalThis.window={innerWidth:720,innerHeight:520};
foundry.applications={api:{DialogV2:{prompt:async options=>{observedDialog=options;return null;}}}};
await ask({window:{title:"Новая улика"},content:'<div class="db-dialog"><textarea name="description"></textarea></div>'});
assert.equal(observedDialog.position.width,540);
assert.equal(observedDialog.position.height,456);
assert.ok(observedDialog.classes.includes("db-board-form-dialog"));
assert.equal(observedDialog.window.resizable,true);
await ask({content:"<p>Короткое окно</p>"});
assert.equal(observedDialog.position,undefined);
// Regression: one close control, without a second square/minimize button.
const close={classList:{add(value){this[value]=true;}},setAttribute(name,value){this[name]=value;}};
const duplicate={style:{}};
showWindowCloseX({window:{close,header:{querySelectorAll:()=>[duplicate,close]}}});
assert.equal(close.textContent,"×");
assert.equal(duplicate.style.display,"none");
assert.deepEqual(boardDialogPosition(1920,1080), {width:540,height:640});
assert.deepEqual(boardDialogPosition(800,600), {width:540,height:536});
assert.deepEqual(boardDialogPosition(360,450), {width:328,height:386});
const {DBStore}=await import('../src/store.js');
const board=await DBStore.createBoard({name:'Case One',access:'shared',template:'case'});
assert.equal(DBStore.listBoards().length,1);
assert.equal(game.folders.contents.length,1);
assert.equal(board.folder,game.folders.contents[0].id);
assert.equal(DBStore.cards(board).length,3);
assert.ok(board.testUserPermission(game.users.get('u2'),'OWNER'));
const alice=await DBStore.createCard(board,{title:'Alice',type:'actor',description:'Missing witness',x:320,y:290,tags:['suspect']});
const bob=await DBStore.createCard(board,{title:'Bob',type:'item',x:690,y:320});
await DBStore.updateCard(alice,{title:'Alice Updated',notes:'Last spotted',x:333});
assert.equal(alice.name,'Alice Updated');
assert.equal(DBStore.entry(alice).revision,2);
const wire=await DBStore.createLink(board,alice.id,bob.id,'Seen together');
assert.equal(DBStore.links(board).length,1);
await DBStore.archiveCard(alice);
assert.equal(DBStore.links(board).length,0);
assert.equal(DBStore.cards(board,true).length,1);
await DBStore.restoreCard(alice);
assert.equal(DBStore.links(board).length,1);
await DBStore.savePersonalNote(board,alice.id,'Only me');
const personal=DBStore.getPersonalDoc(board);
assert.equal(personal.ownership.default,0);
assert.equal(personal.folder,board.folder);
assert.equal(DBStore.entry(DBStore.getPersonalNote(board,alice.id)).text,'Only me');
const exportPayload=DBStore.exportData(board);
assert.equal(exportPayload.links.length,1);
assert.equal(exportPayload.cards.length,5);
assert.ok(!JSON.stringify(exportPayload).includes('Only me'));
const imported=await DBStore.importData(exportPayload);
assert.equal(DBStore.cards(imported).length,5);
assert.equal(DBStore.links(imported).length,1);
assert.equal(imported.folder,board.folder);
const legacy=await Journal.create({name:"Legacy board",ownership:{default:3},flags:{"detective-board":{board:{kind:"board"}}}});
game.user.isGM=true;
await DBStore.ensureStorageFolder({migrate:true});
assert.equal(legacy.folder,board.folder);
assert.ok(DBStore.cards(imported).every(p=>!DBStore.entry(p).sourceUuid));
console.log('SMOKE OK - boards, access, templates, CRUD, links, archive, notes, export/import');
