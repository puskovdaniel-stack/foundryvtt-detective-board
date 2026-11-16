import assert from 'node:assert/strict';
import {escapeHTML, safeImage, cardPosition, boardDialogPosition, boardWindowPosition, draggedDocumentUUID, ask, confirm, showWindowCloseX, cardResizeDimensions, cardPinPosition} from '../src/utils.js';
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
assert.deepEqual(cardResizeDimensions(230,230,120,70,0),{width:350,height:300});
assert.deepEqual(cardResizeDimensions(230,230,1000,1000,0),{width:620,height:740});
assert.deepEqual(cardResizeDimensions(230,230,-1000,-1000,0),{width:160,height:130});
assert.deepEqual(cardResizeDimensions(230,230,0,100,90),{width:330,height:230});
assert.deepEqual(cardPinPosition({x:100,y:200,width:240,height:180,rotation:0}),{x:220,y:199});
assert.ok(cardPinPosition({x:100,y:200,width:240,height:180,rotation:30}).x>220);
assert.deepEqual(boardWindowPosition(1130,770,800,600),{width:768,height:536});
// Regression: ALL dialogs, not only long evidence forms, must fit a viewport.
let observedDialog;
globalThis.window={innerWidth:720,innerHeight:520};
foundry.applications={api:{DialogV2:{prompt:async options=>{observedDialog=options;return null;},confirm:async options=>{observedDialog=options;return false;}}}};
await ask({window:{title:"Новая улика"},content:'<div class="db-dialog"><textarea name="description"></textarea></div>'});
assert.equal(observedDialog.position.width,540);
assert.equal(observedDialog.position.height,456);
assert.ok(observedDialog.classes.includes("db-board-form-dialog"));
assert.equal(observedDialog.window.resizable,true);
await ask({content:'<div class="db-dialog"><label>Название<input name="label"></label></div>'});
assert.deepEqual(observedDialog.position,{width:540,height:320});
assert.ok(observedDialog.classes.includes("db-board-form-dialog"));
assert.equal(observedDialog.window.resizable,true);
const closeForDialog={classList:{add(){}},setAttribute(){}};
const duplicateForDialog={style:{}};
let renderedCallback=false;
await ask({content:'<div class="db-dialog"></div>',render:()=>{renderedCallback=true;}});
observedDialog.render(null,{window:{close:closeForDialog,header:{querySelectorAll:()=>[closeForDialog,duplicateForDialog]}}});
assert.ok(renderedCallback);
assert.equal(duplicateForDialog.style.display,'none');
await confirm("Удалить связь?","Удаление");
assert.ok(observedDialog.classes.includes("db-board-form-dialog"));
assert.equal(observedDialog.position.height,250);
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
// Restricted NPC Actor sheets stay private while their portraits are published as snapshots.
const npc={name:'Inspector Brown',img:'icons/npc/inspector-brown.webp',uuid:'Actor.inspector',
  testUserPermission:user=>user.id==='u1'};
game.actors={contents:[npc]};
globalThis.TextEditor={getDragEventData:()=>({type:'Actor',uuid:npc.uuid})};
globalThis.fromUuid=async()=>npc;
let statusMessage='';
globalThis.ui={notifications:{info:message=>{statusMessage=message;},warn:()=>{}}};
foundry.applications.api.ApplicationV2=class {};
const {BoardEditor}=await import('../src/editor.js');
const editorStub={writable:true,board,setSaving:()=>{},getCoords:()=>({x:450,y:500}),renderCanvas:()=>{}};
await BoardEditor.prototype.onDrop.call(editorStub,{preventDefault(){}});
const inspector=DBStore.cards(board).find(p=>p.name==='Inspector Brown');
assert.equal(DBStore.entry(inspector).image,npc.img);
assert.equal(DBStore.entry(inspector).sourceUuid,null);
assert.ok(statusMessage.includes('Портрет'));
// Old blank NPC cards can be repaired explicitly by a GM without exposing source UUIDs.
const oldNpc=await DBStore.createCard(board,{title:npc.name,type:'actor'});
const repaired=await DBStore.restoreActorPortraits(board);
assert.equal(repaired.restored,1);
assert.equal(DBStore.entry(oldNpc).image,npc.img);
assert.equal(DBStore.entry(oldNpc).sourceUuid,null);
// Pin-to-pin gesture starts a link, and only a distinct destination pin completes it.
const pin={};
const fromCard={dataset:{card:alice.id},classList:{add(){}},setPointerCapture(){},hasPointerCapture(){return true;},releasePointerCapture(){}};
const toCard={dataset:{card:bob.id}};
const viewport={};
const target={closest(selector){return selector==='.db-viewport'?viewport:selector==='.db-card'?fromCard:selector==='.db-pin'?pin:null;}};
let connected=null;
const gesture={writable:true,tool:'select',linkStart:null,linkStatus(){},drawPinPreview(){},
  pinAt(){return {closest:()=>toCard};},clearPinPreview(){},connect:async(from,to)=>{connected=[from,to];},
  element:{querySelector:()=>viewport},pendingUpdate:false};
BoardEditor.prototype.onPointerDown.call(gesture,{target,button:0,pointerId:77,clientX:50,clientY:60,preventDefault(){},stopPropagation(){}});
assert.equal(gesture.drag.type,'link');
await BoardEditor.prototype.onPointerUp.call(gesture,{pointerId:77,clientX:150,clientY:170,type:'pointerup'});
assert.deepEqual(connected,[alice.id,bob.id]);
console.log('SMOKE OK - boards, access, templates, CRUD, links, archive, notes, export/import');
